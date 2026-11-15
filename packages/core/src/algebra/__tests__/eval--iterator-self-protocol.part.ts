/**
 * Bug 314 回归：迭代器对象的 `@@iterator` 必须**返回自身**（迭代器协议）。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 *   new Set([1,2])[Symbol.iterator]()[Symbol.iterator]() === it → true
 *   new Map([[1,2]])[Symbol.iterator]()[Symbol.iterator]() === it → true
 *   [1,2][Symbol.iterator]()[Symbol.iterator]() === it → true
 *   "ab"[Symbol.iterator]()[Symbol.iterator]() === it → true
 *   两个**不同**迭代器对象互比 → false（不是「所有迭代器都相等」）
 *
 * 修前：引擎的迭代器对象**没有自协议**——
 * - Set / Map 迭代器：`it[Symbol.iterator]` 取不到 ⇒ 调用**确定抛
 *   TypeError** ⇒ 返回值折 never（自信的错值）；
 * - 数组 / 字符串迭代器：给出**错的 "diff"**（原生是 same / true）。
 *
 * 口径说明（**别被报告的措辞带偏**）：报告里的 "same" / "diff" 是
 * 「同一性」的措辞，**原生值是布尔** true / false——本文件按**原生布尔**
 * 断言（引擎当前也给精确 true）。
 *
 * 取证（原生 oracle）：
 *   node -e 'const s=new Set([1,2])[Symbol.iterator](),
 *     m=new Map([[1,2]])[Symbol.iterator](),
 *     a=[1,2][Symbol.iterator](), t="ab"[Symbol.iterator]();
 *     console.log(s[Symbol.iterator]()===s, m[Symbol.iterator]()===m,
 *       a[Symbol.iterator]()===a, t[Symbol.iterator]()===t)'
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 314 — 迭代器对象的 @@iterator 返回自身", () => {
  it("Set 迭代器：it[Symbol.iterator]() === it → true（修前：确定抛 TypeError）", () => {
    const r = call(
      wrap(`const it = new Set([1,2])[Symbol.iterator](); return it[Symbol.iterator]() === it;`),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
  });

  it("Map 迭代器：it[Symbol.iterator]() === it → true（修前：确定抛 TypeError）", () => {
    const r = call(
      wrap(`const it = new Map([[1,2]])[Symbol.iterator](); return it[Symbol.iterator]() === it;`),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("数组迭代器：it[Symbol.iterator]() === it → true（修前：错的 \"diff\"）", () => {
    const r = call(
      wrap(`const it = [1,2][Symbol.iterator](); return it[Symbol.iterator]() === it;`),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("字符串迭代器：it[Symbol.iterator]() === it → true（修前：错的 \"diff\"）", () => {
    const r = call(
      wrap(`const it = "ab"[Symbol.iterator](); return it[Symbol.iterator]() === it;`),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });
});

describe("Bug 314 — 负控制（自协议 ≠ 「所有迭代器都相等」）", () => {
  it("两个不同集合迭代器互比 → false（原生同款）", () => {
    const r = call(
      wrap(
        `const a = new Set([1,2])[Symbol.iterator](); const b = new Set([1,2])[Symbol.iterator](); return a === b;`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("迭代器本身与源集合互比 → 不是精确 true（原生 false；引擎给保守 boolean 域）", () => {
    // 原生：`it === s` → false（迭代器与集合是不同对象）。引擎当前给**保守
    // boolean 域**（说不死）⇒ 只钉「不得说死 true」。
    const r = call(
      wrap(`const s = new Set([1,2]); const it = s[Symbol.iterator](); return it === s;`),
      "f",
    );
    const lit = litValue(r.result);
    expect(lit.ok === true ? lit.value : undefined).not.toBe(true);
  });
});
