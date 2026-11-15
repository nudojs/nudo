/**
 * BUG-095 —— guard 面的数组检查用 `Array.prototype.every` ⇒ 规范规定它**跳过
 * 不存在的下标（洞）** ⇒ 稀疏数组的洞位从不被检查 ⇒ guard 放行 `[1,,3]`，
 * 而 zod / standard 按位读到 `undefined` ⇒ 拒绝 ⇒ 三面接受集相反。
 *
 * 根因：`denote.ts` 的 `case "arr"` 用 `${v}.every(...)`（同文件 tuple 分支
 * 已用 `i in v` 正确处理洞，arr 分支漏了）。
 *
 * 本钉：洞位必须被当作 `undefined` 检查（与 standard 面同口径）。
 */
import { describe, it, expect } from "vitest";
import { abs, gt, lit, v, type Abs } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";

const positiveNum = (): Abs =>
  abs(
    { k: "prim", type: "number" },
    v("item"),
    gt(v("item"), lit(0)),
    "path",
  );

const arrOf = (element: Abs): Abs => abs({ k: "arr", element }, undefined, undefined, "exact");

const runner = (g: string): ((data: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (data: unknown) => boolean;

describe("BUG-095 — guard 的数组检查不跳过稀疏洞", () => {
  it("运行时：接受 `[1,2,3]`，拒绝稀疏 `[1,,3]` 与 `[1,undefined,3]`", () => {
    const check = runner(denoteGuard(arrOf(positiveNum()), "data"));
    expect(check([1, 2, 3])).toBe(true);
    // 洞位按 `undefined` 检查（与 zod / standard 同口径）
    expect(check([1, , 3])).toBe(false);
    expect(check([1, undefined, 3])).toBe(false);
    expect(check([1, 0, 3])).toBe(false);
  });

  it("守卫仍要求数组本身（负控制）", () => {
    const g = denoteGuard(arrOf(positiveNum()), "data");
    const check = runner(g);
    expect(g).toContain("Array.isArray(data)");
    expect(check({ 0: 1, 1: 2, length: 2 })).toBe(false);
  });
});
