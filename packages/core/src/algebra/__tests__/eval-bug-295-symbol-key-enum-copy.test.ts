/**
 * Bug 295 回归：symbol 键（`[Symbol.X]`）在**复制面**不得退化成普通字符串键。
 *
 * ES 语义（node v26 实测）：
 * - `[Symbol.X]` 是 **symbol 键**，不是字符串键 `"@@X"`；引擎的槽表用
 *   `"@@X"` 作投影键 + `Slot.symbolKey` 标记表示它（Bug 73/117）。
 * - `Object.assign` / spread / **对象 rest** 复制的是**可枚举 symbol 键本身**
 *   （node 实测 rest 也拷 symbol ⇒ `rest[Symbol.toStringTag] === 2`）⇒
 *   复制后 `Object.keys/values/entries` / `JSON.stringify` **看不到**它，
 *   但 `t[Symbol.toStringTag]` **读得到**值。
 * - for-in / `Object.keys|values|entries` / `getOwnPropertyNames` /
 *   `getOwnPropertyDescriptors` / `JSON.stringify` **只枚举字符串键**。
 *
 * 修复前：`exec/class/assign.ts` 的 mergeObj 拷源槽时**丢掉 symbolKey 标记**
 * ⇒ `"@@X"` 投影槽退化成**普通字符串键** ⇒ 目标上的伪键进了
 * `Object.keys/values/entries` / `JSON.stringify` 面（原生看不到）。
 *
 * 修法（`exec/class/assign.ts`）：拷贝时**迁移源槽的 symbolKey 标记**。
 *
 * ⚠️ 本条只修**复制面**。其余枚举面（for-in / gOPD / Reflect.ownKeys /
 * `in`）的修复需改**本分片清单外**的文件（见报告越界诉求）：
 * `builtins/invariants.ts` 已**留好接口** `enumOwnStringKeys`（字符串键
 * 视图）+ `enumOwnKeys`（CopyDataProperties 视图，含 symbol 键）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { enumOwnKeys, enumOwnStringKeys } from "../builtins/invariants.ts";
import { num } from "../abs.ts";
import type { Abs } from "../abs.ts";
import { objOf } from "../objects.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 295 — Object.assign 复制 symbol 键时不退化成字符串键", () => {
  it("Object.keys(Object.assign({}, o))：只含字符串键 \"a\"（改前含伪键 \"@@toStringTag\"）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.keys(Object.assign({}, o)).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  });

  it("Object.values(Object.assign({}, o))：只含字符串键的值（改前含 2）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.values(Object.assign({}, o)).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "1" });
  });

  it("Object.entries(Object.assign({}, o))：只含字符串键的条目（改前含 \"@@toStringTag:2\"）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.entries(Object.assign({}, o)).map((e) => e.join(":")).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a:1" });
  });

  it("JSON.stringify(Object.assign({}, o))：不发布伪键（改前含 \"@@toStringTag\"）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return JSON.stringify(Object.assign({}, o));`,
        ),
      ),
    ).toEqual({ ok: true, value: '{"a":1}' });
  });

  it("Object.getOwnPropertyNames(Object.assign({}, o))：只含字符串键（改前含伪键）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.getOwnPropertyNames(Object.assign({}, o)).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  });

  it("Object.assign 仍**拷贝** symbol 键本身：t[Symbol.toStringTag] 读得到 2（原生同款）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const t = Object.assign({}, o); return String(t[Symbol.toStringTag]);`,
        ),
      ),
    ).toEqual({ ok: true, value: "2" });
  });
});

describe("Bug 295 — 负控制（复制面 / 枚举面的邻近形态不回归）", () => {
  it("源对象自身的字符串键枚举面不变：Object.keys/values/entries/JSON.stringify", () => {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.keys(o).join(",");`)),
    ).toEqual({ ok: true, value: "a" });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.values(o).join(",");`)),
    ).toEqual({ ok: true, value: "1" });
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.entries(o).map((e) => e.join(":")).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a:1" });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return JSON.stringify(o);`)),
    ).toEqual({ ok: true, value: '{"a":1}' });
  });

  it("spread / 对象 rest 仍**拷贝** symbol 键（原生同款：node 实测 rest 也拷）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const t = { ...o }; return String(t[Symbol.toStringTag]);`,
        ),
      ),
    ).toEqual({ ok: true, value: "2" });
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const { a, ...rest } = o; return String(rest[Symbol.toStringTag]);`,
        ),
      ),
    ).toEqual({ ok: true, value: "2" });
  });

  it("无 symbol 键的普通对象：assign / 枚举面照常", () => {
    expect(v(wrap(`return Object.keys(Object.assign({}, { a: 1, b: 2 })).join(",");`))).toEqual({
      ok: true,
      value: "a,b",
    });
    expect(v(wrap(`return Object.getOwnPropertyNames({ a: 1, b: 2 }).join(",");`))).toEqual({
      ok: true,
      value: "a,b",
    });
  });

  it("字面量字符串键 \"@@toStringTag\" 不是 symbol 键：照常枚举（不被误剔）", () => {
    expect(
      v(wrap(`const o = { "@@toStringTag": 7 }; return Object.keys(Object.assign({}, o)).join(",");`)),
    ).toEqual({ ok: true, value: "@@toStringTag" });
  });
});

describe("Bug 295 — 枚举视图两套口径（留接口：enumOwnKeys vs enumOwnStringKeys）", () => {
  const o = objOf({
    a: { value: num() },
    "@@toStringTag": { value: num(), symbolKey: true },
  });
  const slots = (o.shape as Extract<Abs["shape"], { k: "obj" }>).slots;

  it("enumOwnKeys = CopyDataProperties 视图（含 symbol 键——spread/assign 拷贝链要它）", () => {
    expect(enumOwnKeys(o, slots).sort()).toEqual(["@@toStringTag", "a"]);
  });

  it("enumOwnStringKeys = 字符串键视图（剔除 symbol 投影槽——for-in / keys 家族要它）", () => {
    expect(enumOwnStringKeys(o, slots)).toEqual(["a"]);
  });
});
