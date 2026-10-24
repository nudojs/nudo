/**
 * Bug 295 回归（分片：**枚举面接线**）——symbol 键（`[Symbol.X]`）不得出现在
 * **字符串键枚举面**。
 *
 * 本文件钉的是**主 agent 刚落地的枚举面接线**（for-in / keys 家族 / gOPD /
 * Reflect.ownKeys / `in`）；**复制面**（spread / Object.assign / 对象 rest）
 * 由同 bug 的另一分片 `eval-bug-295-symbol-key-enum-copy.test.ts` 钉——
 * 两套枚举口径必须分流（字符串键视图 vs CopyDataProperties 视图）。
 *
 * 原生依据（**node v26.10.0 实测**；本文件每条断言的期望值都先跑原生确认，
 * 不用印象值）：
 * - `Object.keys` / `Object.getOwnPropertyNames` / for-in / `JSON.stringify`
 *   只枚举**字符串**键 ⇒ `[Symbol.toStringTag]` 这类 symbol 键**看不到**。
 * - **Bug 1075 更正**：`Object.getOwnPropertyDescriptors` **不在**该清单里——
 *   原生 gOPDs 走 [[OwnPropertyKeys]]（**含** symbol 键：结果对象带**真
 *   symbol** 键 ⇒ `Reflect.ownKeys(gOPDs(o)).length === 2`、
 *   `Object.getOwnPropertySymbols(gOPDs(o)).length === 1`；而
 *   `Object.keys(gOPDs(o))` / `Object.getOwnPropertyNames(gOPDs(o))` 仍只有
 *   `"a"`——字符串键面不受影响）。本文件此前把 gOPDs 误列入「只枚举字符串
 *   键」清单并据此断言 ownKeys 长度 1 ⇒ 该断言钉的是**错行为**，已更正。
 * - `Reflect.ownKeys` 枚举**自有可枚举**键（字符串 + symbol）⇒ symbol 键**在**，
 *   且取回的是**真 symbol**（`typeof === "symbol"`，`=== Symbol.toStringTag`）。
 * - `"@@toStringTag" in o` 是**假**（原型链上没有这个字符串键）；
 *   `Symbol.toStringTag in o` 是**真**（symbol 键本身在）。
 *
 * 改前（改前 = HEAD，本 worktree 的枚举面接线落盘前；探针实测）：
 * - for-in 发布伪键 `"@@toStringTag"`（`"a,@@toStringTag"`）；
 * - `Object.getOwnPropertyDescriptors(o)` 含伪键（`"a,@@toStringTag"`）；
 * - `Reflect.ownKeys(o)[1]` 是**字符串**（`typeof` → `"string"`）；
 * - `"@@toStringTag" in o` 假真（原生为假）。
 *
 * 接线落点（主 agent 已落地；**本文件只钉行为，不改源码**）：
 * - `builtins/invariants.ts`：新增 `enumOwnStringKeys`（剔除 symbol 投影槽
 *   与 internal 私有槽）；`isNonEnumerable` 并查 brand 自身 / brand 内层 obj
 *   两套 flags 载体。
 * - `exec/runtime/containers/iterate.ts`：for-in 三处枚举改走字符串键视图。
 * - `builtins/object/methods.ts`：`getOwnPropertyDescriptors` 的 open/闭 obj
 *   两分支**保留** symbol 槽（Bug 1075：原生 gOPDs 含 symbol 键——symbol
 *   投影槽带 `symbolKey` 标记随结果对象走 ⇒ 字符串键面仍剔除它）；
 *   `classInstanceEnumEntries` 用剔除 symbol 的 `enumKeys`。
 * - `builtins/reflect.ts`：`Reflect.ownKeys` 把 symbol 槽还原成宿主**真 symbol**。
 * - `exec/runtime/members.ts`：`$in` 的 obj/brand 臂——symbol 键槽不被字符串
 *   键命中（原生 `"@@toStringTag" in o` === false）。
 * - `builtins/object/descriptor.ts` + `exec/class/assign.ts`：复制面携带
 *   `symbolKey` 标记（symbol 键不降级成字符串键）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../index.ts";
import { call } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 295 — 枚举面：symbol 键不进字符串键视图", () => {
  it("Object.keys({a:1, [Symbol.toStringTag]:2}) → [\"a\"]（symbol 键不进 keys）", () => {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.keys(o).join(",");`)),
    ).toEqual({ ok: true, value: "a" });
  });

  it("for-in {a:1, [Symbol.toStringTag]:2} → 只得 \"a\"（原生：[\"a\"]）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const r = []; for (const k in o) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  });

  it("Object.getOwnPropertyNames({a:1, [Symbol.toStringTag]:2}) → [\"a\"]", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.getOwnPropertyNames(o).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  });

  it("Object.getOwnPropertyDescriptors({a:1, [Symbol.toStringTag]:2}) → 字符串键面只有 a；自有键面含 symbol 键（Bug 1075）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.keys(Object.getOwnPropertyDescriptors(o)).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.getOwnPropertyNames(Object.getOwnPropertyDescriptors(o)).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
    // 原生：gOPDs 走 [[OwnPropertyKeys]]——**含** symbol 键 ⇒ 自有键面 2 条
    // （"a" + Symbol.toStringTag；字符串键段在前——ES2024 OrdinaryOwnPropertyKeys）
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(Object.getOwnPropertyDescriptors(o)).length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(Object.getOwnPropertyDescriptors(o))[0];`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  });

  it("Reflect.ownKeys({a:1, [Symbol.toStringTag]:2}) → 长度 2；[0] 是字符串 \"a\"；[1] typeof 是 \"symbol\"", () => {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(o).length;`)),
    ).toEqual({ ok: true, value: 2 });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(o)[0];`)),
    ).toEqual({ ok: true, value: "a" });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return typeof Reflect.ownKeys(o)[0];`)),
    ).toEqual({ ok: true, value: "string" });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return typeof Reflect.ownKeys(o)[1];`)),
    ).toEqual({ ok: true, value: "symbol" });
    // 原生：ownKeys[1] 是**真 symbol**（还原成 Symbol.toStringTag 本身）
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(o)[1] === Symbol.toStringTag;`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("\"@@toStringTag\" in o → false；Symbol.toStringTag in o → true（字符串键不误命中 symbol 槽）", () => {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return ("@@toStringTag" in o);`)),
    ).toEqual({ ok: true, value: false });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return (Symbol.toStringTag in o);`)),
    ).toEqual({ ok: true, value: true });
  });

  it("Object.assign(A.prototype, {a:1, [Symbol.toStringTag]:2}) → A.prototype 的 for-in **不含** \"@@toStringTag\"", () => {
    // 原生：for-in on A.prototype → ["a"]（symbol 键不降级成字符串键）
    expect(
      v(
        wrap(
          `class Bug295SymProto {}; Object.assign(Bug295SymProto.prototype, { a: 1, [Symbol.toStringTag]: 2 }); const r = []; for (const k in Bug295SymProto.prototype) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
    // 显式负断言：伪键 "@@toStringTag" 不在枚举面里
    expect(
      v(
        wrap(
          `class Bug295SymProto2 {}; Object.assign(Bug295SymProto2.prototype, { a: 1, [Symbol.toStringTag]: 2 }); const r = []; for (const k in Bug295SymProto2.prototype) r.push(k); return r.indexOf("@@toStringTag");`,
        ),
      ),
    ).toEqual({ ok: true, value: -1 });
    // 原生同款：symbol 键本身被**拷贝**到原型上（读得到 2）
    expect(
      v(
        wrap(
          `class Bug295SymProto3 {}; Object.assign(Bug295SymProto3.prototype, { a: 1, [Symbol.toStringTag]: 2 }); return String(Bug295SymProto3.prototype[Symbol.toStringTag]);`,
        ),
      ),
    ).toEqual({ ok: true, value: "2" });
  });

  it("JSON.stringify({a:1, [Symbol.toStringTag]:2}) → '{\"a\":1}'（symbol 键不进 JSON 面）", () => {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return JSON.stringify(o);`)),
    ).toEqual({ ok: true, value: '{"a":1}' });
  });
});

describe("Bug 295 — 负控制：过滤只剔字符串视图，不误伤真 symbol", () => {
  it("真 symbol 键仍被命中：o[Symbol.toStringTag] 读到 2 且 Symbol.toStringTag in o 为真", () => {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return String(o[Symbol.toStringTag]);`)),
    ).toEqual({ ok: true, value: "2" });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return (Symbol.toStringTag in o);`)),
    ).toEqual({ ok: true, value: true });
  });

  it("字面量字符串键 \"@@toStringTag\" 不是 symbol 键：照常枚举（不被误剔）", () => {
    // 原生：{ "@@toStringTag": 7 } 的字符串键照常进 Object.keys / for-in
    expect(
      v(wrap(`const o = { "@@toStringTag": 7 }; return Object.keys(o).join(",");`)),
    ).toEqual({ ok: true, value: "@@toStringTag" });
    expect(
      v(
        wrap(
          `const o = { "@@toStringTag": 7 }; const r = []; for (const k in o) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "@@toStringTag" });
  });

  it("无 symbol 键的普通对象：各枚举面照常（不回归）", () => {
    expect(v(wrap(`return Object.keys({ a: 1, b: 2 }).join(",");`))).toEqual({
      ok: true,
      value: "a,b",
    });
    expect(v(wrap(`return Object.getOwnPropertyNames({ a: 1, b: 2 }).join(",");`))).toEqual({
      ok: true,
      value: "a,b",
    });
    expect(
      v(
        wrap(
          `const r = []; for (const k in { a: 1, b: 2 }) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a,b" });
    expect(v(wrap(`return JSON.stringify({ a: 1, b: 2 });`))).toEqual({
      ok: true,
      value: '{"a":1,"b":2}',
    });
  });

  it("Reflect.ownKeys 仍是**字符串 + symbol** 双族视图（不是只剩字符串）", () => {
    // 原生：Reflect.ownKeys({a:1}) → ["a"]（只有字符串键时长度 1）
    expect(v(wrap(`return Reflect.ownKeys({ a: 1 }).length;`))).toEqual({
      ok: true,
      value: 1,
    });
    // 带 symbol 键时：ownKeys 的第 2 项是 **symbol 形**（不是 string 形）
    // ——格式化面把 symbol 印成 undefined，故按元素形状断言。
    const r = call(
      wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(o);`),
      "f",
    ).result;
    const shape = r.shape as {
      k: string;
      elements?: { shape?: { k?: string; type?: string } }[];
    };
    expect(shape.k).toBe("tuple");
    expect(shape.elements).toHaveLength(2);
    expect(shape.elements![0].shape).toMatchObject({ k: "prim", type: "string" });
    expect(shape.elements![1].shape).toMatchObject({ k: "prim", type: "symbol" });
    // 且第 2 项就是 Symbol.toStringTag 本体（真 symbol 被还原）
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(o)[1] === Symbol.toStringTag;`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
  });
});
