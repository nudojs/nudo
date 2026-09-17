import { describe, it, expect } from "vitest";
import { analyzeFile, clearBPathCache } from "@nudojs/service";
import { formatShape } from "@nudojs/core";
import { transpile, analyzeFn, generalizeFromAst, numLit, absToString } from "@nudojs/core";

describe("directive case args in branch bodies", () => {
  const source = `
/**
 * @nudo:case "A" (92) => "A"
 * @nudo:case "F" (50) => "F"
 */
export function gradeFor(score) {
  if (score >= 85) return "A";
  return "F";
}
`;

  it("transpile folds early-return if into return $fork", () => {
    const js = transpile(source);
    expect(js).toContain("return $fork(");
    expect(js).toMatch(/return \$fork\([\s\S]*\(\) => \$lit\("A"\)/);
  });

  it("B-path evaluateFunction returns A for score=92", () => {
    clearBPathCache();
    const result = analyzeFile("/tmp/nudo-branch-case.js", source);
    const a = result.functions
      .find((f) => f.name === "gradeFor")
      ?.cases.find((c) => c.name === "A");
    expect(a).toBeDefined();
    expect(formatShape(a!.abs)).toBe('"A"');
  });

  it("AST analyzeFn and generalize agree on early-return", () => {
    expect(absToString(analyzeFn(source, "gradeFor", [numLit(92)]))).toContain('"A"');
    const g = generalizeFromAst("gradeFor", source);
    expect(g?.display).toBeDefined();
    // symbolic: both branches join → string, not the fall-through-only "F"
    expect(g!.display).not.toMatch(/=>"F"/);
  });

  it("multi early-return folds nested forks", () => {
    const multi = `
export function grade(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  return "F";
}
`;
    expect(absToString(analyzeFn(multi, "grade", [numLit(85)]))).toContain('"B"');
  });
});
