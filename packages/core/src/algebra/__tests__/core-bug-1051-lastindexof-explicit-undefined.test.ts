/**
 * Bug 1051 — `Array.prototype.lastIndexOf(x, undefined)`：**fromIndex 缺省**
 * 与 **fromIndex 显式 undefined** 被混为一谈（`toIOI` 对两者都返回
 * undefined）⇒ 起始下标取 `len-1`（扫全表）而原生取 0（只扫第 0 位）。
 *
 * 原生规则（ES2023 Array.prototype.lastIndexOf）：
 * - `lastIndexOf(x)`（fromIndex 缺省）⇒ pos = len - 1；
 * - `lastIndexOf(x, undefined)`（fromIndex **在场**）⇒
 *   `ToIntegerOrInfinity(undefined) = 0` ⇒ pos = 0。
 *
 * 根修：fromIndex 取第三态（缺省 / 显式 undefined / 数值）——`toIOIArg`
 * （arr-methods.ts）在 `toIOI` 的数值判定之上只补「实参在不在」这一维。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";

const val = (body: string): unknown => {
  const r = call(`export function f() {\n${body}\n}`);
  return (r.result as { term?: { op?: string; value?: unknown } })?.term?.value;
};

describe("Bug 1051 · lastIndexOf 的 fromIndex 第三态", () => {
  it("lastIndexOf(2, undefined)：起始下标 0 ⇒ 扫不到 ⇒ -1（原生）", () => {
    expect(val(`return [1,2,3].lastIndexOf(2, undefined);`)).toBe(-1);
  });

  it("对照：lastIndexOf(2)（fromIndex 缺省）⇒ 起始 len-1 ⇒ 1（原生）", () => {
    expect(val(`return [1,2,3].lastIndexOf(2);`)).toBe(1);
  });

  it("对照：lastIndexOf(2, 0) ⇒ 起始 0 ⇒ -1（原生）", () => {
    expect(val(`return [1,2,3].lastIndexOf(2, 0);`)).toBe(-1);
  });

  it("对照：indexOf(2, undefined) ⇒ 起始 0（缺省与显式 undefined 同为 0）", () => {
    expect(val(`return [1,2,3].indexOf(2, undefined);`)).toBe(1);
    expect(val(`return [1,2,3].indexOf(2);`)).toBe(1);
  });
});
