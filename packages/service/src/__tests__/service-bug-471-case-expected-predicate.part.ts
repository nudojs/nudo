/**
 * Bug 471：`@nudo:case "t" (…) => number().gt(0)` 这类**带谓词**的期望
 * 恒判失败（假红）。
 *
 * 根因（analyzer-orchestrate-uncached-cases.ts）：期望侧用 `leqAbs` 判定，
 * 而 `leqAbs` 只做结构/蕴含判定（源无 pred ⇒ 目标有 pred ⇒ 不蕴含），
 * 不做**值级**判定 ⇒ `number().gt(0)` 与任何实数都不蕴含。
 *
 * 修法：期望判定补值级语义（core 的字面量域隶属判定 literalMeetsConstraint，
 * 约束锚点重锚到 SELF）；实际值已满足谓词时把谓词从「可比较期望」里摘掉，
 * 使下游（nudo test 报告面）的 `leqAbs` 判定同口径。
 *
 * 钉：满足谓词 → 不报 nudo:case-expected；违反谓词 → 仍报（负控制）；
 * 无谓词的期望（`number()`）→ 口径不变（负控制）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile } from "../analyzer.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

/** 找出 nudo:case-expected 诊断（期望不满足）。 */
function caseExpectedIssues(result: { diagnostics: readonly { code?: string }[] }): number {
  return result.diagnostics.filter((d) => d.code === "nudo:case-expected").length;
}

describe("Bug 471：带谓词的期望（number().gt(0)）按值判定，不再恒假红", () => {
  it("满足谓词：期望 number().gt(0)，实际 2 → 无 nudo:case-expected", () =>
    withTmpProject("nudo-b471-", (dir) => {
      const src = `/**
 * @nudo:case "t" (1) => number().gt(0)
 */
export function f(x) { return x + 1; }
`;
      const file = writeTmpFile(dir, "f.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const fn = result.functions.find((f) => f.name === "f");
      const c = fn!.cases.find((x) => x.name === "t");
      expect(c).toBeDefined();
      expect(c!.abs.shape.k).toBe("prim");
      expect(caseExpectedIssues(result)).toBe(0);
    }));

  it("负控制：违反谓词（期望 number().gt(5)，实际 2）→ 仍报 nudo:case-expected", () =>
    withTmpProject("nudo-b471b-", (dir) => {
      const src = `/**
 * @nudo:case "t" (1) => number().gt(5)
 */
export function f(x) { return x + 1; }
`;
      const file = writeTmpFile(dir, "f.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      expect(caseExpectedIssues(result)).toBe(1);
    }));

  it("负控制：无谓词的期望（number()）口径不变 → 无诊断", () =>
    withTmpProject("nudo-b471c-", (dir) => {
      const src = `/**
 * @nudo:case "t" (1) => number()
 */
export function f(x) { return x + 1; }
`;
      const file = writeTmpFile(dir, "f.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      expect(caseExpectedIssues(result)).toBe(0);
    }));

  it("负控制：类型不匹配的期望（string()）→ 仍报 nudo:case-expected", () =>
    withTmpProject("nudo-b471d-", (dir) => {
      const src = `/**
 * @nudo:case "t" (1) => string()
 */
export function f(x) { return x + 1; }
`;
      const file = writeTmpFile(dir, "f.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      expect(caseExpectedIssues(result)).toBe(1);
    }));
});
