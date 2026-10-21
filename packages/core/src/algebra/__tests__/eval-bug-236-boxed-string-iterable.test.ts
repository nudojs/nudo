/**
 * Bug 236 回归：**String 包装对象可迭代**（`new String("ab")` 展开得字符序列），
 * 而 Number / Boolean 包装对象**不可迭代**（原生定抛 TypeError）。
 *
 * ES 语义（ES5 §15.10.5 / ES2015+ 包装对象）：`String` 包装对象内部持有
 * [[StringData]]，其 `@@iterator` 继承自 `String.prototype[Symbol.iterator]`
 * ⇒ 展开得字符序列；`Number` / `Boolean` 包装对象**没有**可迭代协议 ⇒ 展开
 * 定抛 TypeError。
 *
 * 修复前：引擎把 String 包装对象建成**不可迭代**的品牌 ⇒ `[...new String("ab")]`
 * **假抛** TypeError（并且 L2 门禁 entry-may-throw 因此**假红**——
 * 原生这段代码不抛）。
 *
 * 负控制：原始字符串仍可迭代；Number 包装对象仍**定抛**（不得被本次修复
 * 一起放开）。
 */
import { describe, it, expect } from "vitest";
import { val, call, throwsError } from "./eval-helpers.ts";

describe("Bug 236：String 包装对象可迭代", () => {
  it("[...new String(\"ab\")] → [\"a\",\"b\"]（原生不抛）", () => {
    expect(val(`export function f() { return [...new String("ab")].join(","); }`)).toEqual({
      ok: true,
      value: "a,b",
    });
  });

  it("for-of 遍历 String 包装对象 → 字符序列", () => {
    expect(
      val(`export function f() { let k = ""; for (const c of new String("ab")) k += c; return k; }`),
    ).toEqual({ ok: true, value: "ab" });
  });

  it("String 包装对象展开：不记 TypeError（L2 门禁不再假红）", () => {
    const rec = call(`export function f() { return [...new String("ab")]; }`);
    expect(throwsError(rec.throws, "TypeError")).toBe(false);
  });

  it("负控制：[...new Number(1)] 仍定抛 TypeError（不得一起放开）", () => {
    const rec = call(`export function f() { return [...new Number(1)]; }`);
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("负控制：[...new Boolean(true)] 仍定抛 TypeError", () => {
    const rec = call(`export function f() { return [...new Boolean(true)]; }`);
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("负控制：原始字符串仍可迭代", () => {
    expect(val(`export function f() { return [..."ab"].join(","); }`)).toEqual({ ok: true, value: "a,b" });
  });

  it("负控制：原始 number 仍不可迭代", () => {
    const rec = call(`export function f() { return [...(1)]; }`);
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("负控制：Map / Set 包装对象仍按内建可迭代面展开", () => {
    expect(
      val(`export function f() { const a = [...new Map([[1,2]])]; return a.length + "|" + a[0].join(":"); }`),
    ).toEqual({ ok: true, value: "1|1:2" });
    expect(val(`export function f() { return [...new Set([1])].length; }`)).toEqual({
      ok: true,
      value: 1,
    });
  });
});
