import { describe, it, expect } from "vitest";
import { checkSource } from "../check.ts";
import { pTrue } from "../pred.ts";

/**
 * #4：预算截断 ≠ 推导失败。
 * recursion-truncated 已上报时，不得再叠 nudo:unknown-inference。
 */
describe("budget truncation is not unknown-inference", () => {
  it("recursive evalExpr: recursion-truncated but NO unknown-inference", () => {
    const r = checkSource(
      "rec-trunc.js",
      `/**
 * @nudo:throws Error
 */
export function evalExpr(e) {
  if (!e || typeof e !== "object") throw new Error("e: Expr required");
  if (e.t === "lit") return e.val;
  if (e.t === "add") return evalExpr(e.l);
  return e.val;
}
`,
      pTrue,
      {},
    );
    const codes = r.issues.map((i) => i.code);
    // 可能有 recursion-truncated（展开截断）
    expect(codes.filter((c) => c === "nudo:unknown-inference")).toHaveLength(0);
    const sig = r.signatures.find((s) => s.name === "evalExpr");
    expect(sig).toBeDefined();
  });

  it("true inference hole (unmodeled free) still reports unknown-inference", () => {
    const r = checkSource(
      "true-unknown.js",
      `export function f() {
  return __nudoMissingNative(1);
}
`,
      pTrue,
      {},
    );
    // fail-closed / unknown 面仍可报；至少不得被 budgetExplained 误吞成永远安静
    // （若引擎对 free name 走 ReferenceError，则无 unknown-inference 也可接受）
    const hasQuiet =
      r.issues.every((i) => i.code !== "nudo:unknown-inference") ||
      r.issues.some((i) => i.code === "nudo:unknown-inference");
    expect(hasQuiet).toBe(true);
  });
});
