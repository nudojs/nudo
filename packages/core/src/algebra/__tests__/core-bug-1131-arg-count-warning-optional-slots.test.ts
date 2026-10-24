/**
 * Bug 1131（并发 review F25 / P2）—— 超参 warning 忽略**可选 / 默认槽位**。
 *
 * 现象：`f(a, b = 1)` 被 `f(1, 2)` 调用（2 个实参）⇒ 报
 * 「f takes 1 argument(s) but 2 were passed」——但 JS 里 `b` **吃下**第二个
 * 实参（`b === 2`）⇒ 合法调用 ⇒ 误报（假红）。
 *
 * 根因：`packages/core/src/algebra/diagnostics.ts` 的 `arityFace` 只回
 * `required`（**必填**实参位个数），超参判定直接拿它当上界
 * （`argCount > required`）⇒ 默认形参占的位被当成「不存在」。
 *
 * 修法：超参 warning 只在 `argCount > formals.length`（**非 rest** 的形参
 * 总数）时才发；少参 error 仍按 `required`（必填位）判。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkCallSite } from "../diagnostics.ts";
import { numLit } from "../abs.ts";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { pTrue } from "../pred.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";

/** 调一次调用点，返回 issue 码 + 消息 */
function callSite(src: string, callee: string, args: number[]) {
  const issues = checkCallSite(src, callee, args.map((n) => numLit(n)), { argCount: args.length });
  return issues.map((i) => ({ code: i.code, severity: i.severity, message: i.message }));
}

describe("Bug 1131 — 超参 warning 只按**非 rest 形参总数**判", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    takeRefineDiags();
    resetSidecarLoadFailureCache();
    takeInterfaceDiags();
    resetParseSourceCache();
    resetAbsCallBudget();
    resetEvalForkBudget();
  });

  it("默认形参吃下第 2 个实参 ⇒ 不报超参", () => {
    const src = `export function f(a, b = 1) { return a + b; }`;
    expect(callSite(src, "f", [1, 2])).toEqual([]);
  });

  it("真超参（形参位不够）⇒ 仍报 warning", () => {
    const src = `export function f(a, b) { return a + b; }`;
    const issues = callSite(src, "f", [1, 2, 3]);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("nudo:arg-count");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("takes 2 argument(s) but 3 were passed");
  });

  it("rest 形参吸收多余实参 ⇒ 不报超参", () => {
    const src = `export function f(a, ...rest) { return a; }`;
    expect(callSite(src, "f", [1, 2, 3, 4, 5])).toEqual([]);
  });

  it("少传必填位 ⇒ 仍是 error（口径不变）", () => {
    const src = `export function f(a, b = 1) { return a + b; }`;
    const issues = callSite(src, "f", []);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("expects 1 argument(s), got 0");
  });

  it("端到端：check 面上 f(1, 2) 不再误报（文档示例 cartTotal(items, couponPercent = 0) 同形）", () => {
    const r = checkSource(
      "/t/bug1131.js",
      `export function cartTotal(items, couponPercent = 0) {
  return items.length + couponPercent;
}
export function receipt(items, couponPercent = 0) {
  return cartTotal(items, couponPercent);
}
`,
      pTrue,
      { fromFile: "/t/bug1131.js" },
    );
    expect(r.issues.filter((i) => i.code === "nudo:arg-count")).toEqual([]);
  });
});
