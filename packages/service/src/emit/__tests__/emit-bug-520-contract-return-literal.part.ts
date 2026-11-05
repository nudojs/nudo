/**
 * Bug 520 —— dts 把**手写契约**的 `lit(42)` 返回 widen 成 `number`。
 *
 * 症状（改前）：`export declare function only42(a: number): number;`
 * 而同一次导出的其它三面都保 `42`：
 *   - zod：`only42Output = z.literal(42)`
 *   - standard：`{"k":"lit","value":42}`
 *   - `nudo check` 签名：`only42(a: number) => 42`
 *
 * 根因：契约返回域在 Abs 里是「prim + eq(self, lit(v)) **pred**」（core 的
 * `constraintToEntryAbs` 形态）——字面量在 pred 里、不在 term 里 ⇒ 只看
 * term 的 widen 路径永远看不到它。
 *
 * 修法：契约返回位走**保形**渲染（`contractReturnTSType`）：pred 钉住单
 * 字面量 ⇒ 渲染该字面量；观测返回位（case 观测 / combined）沿用调用面
 * widen 口径（顶层字面量 → 基类型）——那条 widen 是有意为之。
 */
import { describe, it, expect } from "vitest";
import { anyAbs, num, numLit, type Abs } from "@nudojs/core";
import { constraintToEntryAbs, litC } from "@nudojs/core";
import { absToTSType, projectFunctionDts } from "../dts-generator.ts";
import type { FunctionAnalysis } from "../../analyzer-types.ts";

const neverAbs = (): Abs =>
  ({ shape: { k: "never" }, term: undefined, pred: undefined, conf: "exact" }) as Abs;

function fnOf(name: string, paramNames: string[], cases: FunctionAnalysis["cases"]): FunctionAnalysis {
  return {
    name,
    loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
    paramNames,
    cases,
  } as FunctionAnalysis;
}

const entryCase = (argAbs: Abs[], result: Abs): FunctionAnalysis["cases"] => [
  { name: "entry@L1", argAbs, abs: result, throwsAbs: neverAbs() },
];

describe("Bug 520 —— 契约返回位保形（lit(n) → n）", () => {
  it("手写契约的 lit(42) 返回渲染成 42（不是 number）", () => {
    const fn = fnOf("only42", ["a"], entryCase([anyAbs], numLit(42)));
    const p = projectFunctionDts(fn, {
      params: [{ name: "a", abs: num() }],
      return: constraintToEntryAbs(litC(42), "return"),
    });
    expect(p.lines.join("\n")).toContain("export declare function only42(a: number): 42;");
    expect(p.lines.join("\n")).not.toContain(": number;");
  });

  it("字面量在 pred 里（不在 term 里）也能取到", () => {
    const a = constraintToEntryAbs(litC(42), "return");
    // 前提：契约返回 Abs 的字面量确实住在 pred 上
    expect(a.term?.op).toBe("var");
    expect(a.pred?.op).toBe("eq");
    // 负控制：裸 Abs 渲染仍是基类型（保形只作用在契约返回位）
    expect(absToTSType(a)).toBe("number");
  });

  it("契约返回是 number() 时仍是 number（不回归）", () => {
    const fn = fnOf("n", ["a"], entryCase([anyAbs], anyAbs));
    const p = projectFunctionDts(fn, {
      params: [{ name: "a", abs: num() }],
      return: constraintToEntryAbs(
        { prim: "number", preds: [] } as never,
        "return",
      ),
    });
    expect(p.lines.join("\n")).toContain("export declare function n(a: number): number;");
  });

  it("观测返回位（无契约）仍按调用面 widen：42 → number（负控制）", () => {
    const fn = fnOf("obs", ["a"], entryCase([anyAbs], numLit(42)));
    const p = projectFunctionDts(fn);
    expect(p.lines.join("\n")).toContain("export declare function obs(a: any): number;");
  });
});
