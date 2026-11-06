/**
 * BUG-206 回归：实测 `never` 配期望 `never` 时 `never ⊑ never` 成立 ⇒
 * 断言必须可判 **ok**。
 *
 * 改前守卫无条件拒绝（`if (actual.shape.k === "never") return false;`）⇒ 报告
 * 印出两个相同的 `never` 却判 `[FAIL]`，诊断文案写成
 * 「expected never, got never」——报告 / 诊断 / 判定三者自相矛盾。
 *
 * ⚠ Bug 649 不得回归：实测 never + 期望**不是** never ⇒ 仍不得判 ok。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCaseArgExpr } from "@nudojs/parser";
import { numLit } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";
import { caseExpectedSatisfied } from "../analyzer-orchestrate-uncached-cases.ts";
import { neverAbs } from "../evaluator/call-record.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

const THROWING = `/**
 * @nudo:case "never" () => never
 */
export function boom() {
  throw new Error("x");
}
`;

describe("BUG-206 — never 期望 vs never 实测", () => {
  it("判定层：never 配 never ⇒ 满足（Bug 649 不回归：配 number() ⇒ 不满足）", () => {
    expect(caseExpectedSatisfied(neverAbs, parseCaseArgExpr("never"))).toBe(true);
    expect(caseExpectedSatisfied(neverAbs, parseCaseArgExpr("number()"))).toBe(false);
    expect(caseExpectedSatisfied(numLit(1), neverAbs)).toBe(false);
  });

  it("分析面：抛错函数 + `=> never` ⇒ 不再发 nudo:case-expected（报告与判定不再自相矛盾）", () => {
    const diags = withTmpProject("nudo-b206-", (dir) => {
      const file = writeTmpFile(dir, "f.js", THROWING);
      return analyzeFile(file, readFileSync(file, "utf-8"))!.diagnostics;
    });
    expect(diags.filter((d) => d.code === "nudo:case-expected")).toHaveLength(0);
  });

  it("分析面对照组：抛错函数 + `=> number()` ⇒ 仍报 nudo:case-expected（Bug 649 不回归）", () => {
    const src = THROWING.replace("=> never", "=> number()");
    const diags = withTmpProject("nudo-b206-neg-", (dir) => {
      const file = writeTmpFile(dir, "f.js", src);
      return analyzeFile(file, readFileSync(file, "utf-8"))!.diagnostics;
    });
    expect(diags.filter((d) => d.code === "nudo:case-expected")).toHaveLength(1);
  });
});
