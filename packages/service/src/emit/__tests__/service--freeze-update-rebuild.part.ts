/**
 * BUG-119：`nudo test --freeze=update` **静默删除**一条**仍然活着**的见证 ⇒
 * 不可恢复（add 模式又因「有手写 case ⇒ 整函数跳过」拒绝重建）⇒ 数据丢失 +
 * 事后 health 转绿（假绿）。
 *
 * 根因（两处，同一族）：
 * ① `stripGeneratedCaseDirectives` 无条件剥离 `call@` 指令 → 残留的手写 case
 *    让回写阶段按**函数级**「hand-written」整跳 ⇒ 生成态见证净损失；
 * ② `insertGeneratedCaseDirectives` 的「手写 ⇒ 整函数跳过」规则是**只增不改**
 *    的 add 模式规则，被 update 链的重建阶段沿用了。
 *
 * 契约：含手写 case 的块**不剥离**生成态见证（剥离 → 回写往返闭合）；
 * 重建阶段按**见证身份**逐条重建（手写 case 只挡**同名**）。
 */
import { describe, it, expect } from "vitest";
import { abs as makeAbs, type Abs } from "@nudojs/core";
// 字面量助手单源：core/internal 的 absLit（与 case-emitter.test.ts 同源）
import { absLit } from "@nudojs/core/internal";

/** 无信息的实参 / 结果 Abs（`conf="partial"`，与 case-emitter.test.ts 同款） */
function unknownAbs(): Abs {
  return makeAbs({ k: "unknown" }, undefined, undefined, "partial");
}
import type { AnalysisResult, FunctionAnalysis } from "@nudojs/service";
import { insertGeneratedCaseDirectives, stripGeneratedCaseDirectives } from "../case-emitter.ts";

const MIXED = `/**
 * @nudo:case "call@site.js:L2" (5, 6)
 * @nudo:case "mine" (3, 4) => 7
 */
export function add(a, b) { return a + b; }
`;

const HAND_WRITTEN_ONLY = `/**
 * @nudo:case "mine" (3, 4) => 7
 */
export function add(a, b) { return a + b; }
`;

function analysisOf(cases: Array<{ name: string; args: Abs[] }>): AnalysisResult {
  const fn: FunctionAnalysis = {
    name: "add",
    loc: { start: { line: 4, column: 0 }, end: { line: 4, column: 0 } },
    paramNames: ["a", "b"],
    cases: cases.map((c) => ({
      name: c.name,
      argAbs: c.args,
      abs: unknownAbs(),
      throwsAbs: unknownAbs(),
      source: "callsite",
    })),
  };
  return {
    functions: [fn],
    diagnostics: [],
    bindings: new Map(),
    nodeAbsMap: new Map(),
    caseHints: [],
  };
}

describe("BUG-119 — update 链不得净删除活着的生成态见证", () => {
  it("① strip 不剥离「含手写 case 的块」里的生成态见证（往返闭合）", () => {
    const { source, removed } = stripGeneratedCaseDirectives(MIXED);
    expect(source).toBe(MIXED);
    expect(removed).toEqual([]);
  });

  it("① 对照：块内**没有**手写 case ⇒ 照常剥离（update 仍能重同步）", () => {
    const only = `/**
 * @nudo:case "call@site.js:L2" (5, 6)
 */
export function add(a, b) { return a + b; }
`;
    const { source, removed } = stripGeneratedCaseDirectives(only);
    expect(removed).toEqual(["call@site.js:L2"]);
    expect(source).not.toContain("@nudo:case");
  });

  it("② rebuildGenerated：手写 case 只挡同名，不挡 call@ 见证的重建", () => {
    const out = insertGeneratedCaseDirectives(
      HAND_WRITTEN_ONLY,
      analysisOf([{ name: "call@site.js:L2", args: [absLit(5), absLit(6)] }]),
      { rebuildGenerated: true },
    );
    expect(out.skipped.some((s) => s.reason === "hand-written")).toBe(false);
    expect(out.written).toEqual([{ fn: "add", cases: ["call@site.js:L2"] }]);
    const text = out.source;
    expect(text).toContain('@nudo:case "call@site.js:L2" (5, 6)');
    expect(text).toContain('@nudo:case "mine" (3, 4) => 7');
  });

  it("② 对照：add 模式（默认）仍是「手写 ⇒ 整函数跳过」（不动用户手写块）", () => {
    const out = insertGeneratedCaseDirectives(
      HAND_WRITTEN_ONLY,
      analysisOf([{ name: "call@site.js:L2", args: [absLit(5), absLit(6)] }]),
    );
    expect(out.source).toBe(HAND_WRITTEN_ONLY);
    expect(out.skipped).toEqual([{ fn: "add", reason: "hand-written" }]);
  });

  it("② 手写 case 的载荷与新调用点相同不得顶掉该见证（载荷等价只判生成态之间）", () => {
    const out = insertGeneratedCaseDirectives(
      HAND_WRITTEN_ONLY,
      analysisOf([{ name: "call@site.js:L7", args: [absLit(3), absLit(4)] }]),
      { rebuildGenerated: true },
    );
    expect(out.written).toEqual([{ fn: "add", cases: ["call@site.js:L7"] }]);
  });
});
