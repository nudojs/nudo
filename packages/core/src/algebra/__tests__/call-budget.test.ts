import { describe, it, expect } from "vitest";
import { checkSource } from "../check.ts";
import {
  analyzeFn,
  evalProgramAbs,
  resetAbsCallBudget,
  MAX_CALL_DEPTH,
} from "../ast-eval.ts";
import { pTrue } from "../pred.ts";
import { num, unknown } from "../abs.ts";
import type { Abs } from "../abs.ts";

const FAC = `
function fac(n) {
  if (n <= 1) return 1;
  return n * fac(n - 1);
}
`;

const FIB = `
function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
`;

const MUTUAL = `
function isEven(n) {
  if (n === 0) return true;
  return isOdd(n - 1);
}
function isOdd(n) {
  if (n === 0) return false;
  return isEven(n - 1);
}
`;

describe("Abs call budget (recursion guard)", () => {
  it("analyzeFn on factorial does not stack-overflow", () => {
    resetAbsCallBudget();
    const r = analyzeFn(FAC, "fac", [num()], pTrue);
    expect(r).toBeDefined();
    expect(r.shape.k === "unknown" || r.shape.k === "prim" || r.shape.k === "never").toBe(true);
  });

  it("analyzeFn on fib does not stack-overflow", () => {
    resetAbsCallBudget();
    const r = analyzeFn(FIB, "fib", [num()], pTrue);
    expect(r).toBeDefined();
  });

  it("mutual recursion does not stack-overflow", () => {
    resetAbsCallBudget();
    const r = analyzeFn(MUTUAL, "isEven", [num()], pTrue);
    expect(r).toBeDefined();
  });

  it("evalProgramAbs with top-level recursive call does not stack-overflow", () => {
    resetAbsCallBudget();
    const { last } = evalProgramAbs(`
function count(n) {
  if (n <= 0) return 0;
  return 1 + count(n - 1);
}
const x = count(5);
`);
    expect(last).toBeDefined();
  });

  it("concrete base-case recursion still evaluates", () => {
    // 调用深度在 64 内：count(5) 应给出字面量结果而非 opaque
    resetAbsCallBudget();
    const lit5: Abs = {
      shape: { k: "prim", type: "number" },
      term: { op: "lit", value: 5 },
      conf: "exact",
    };
    const r = analyzeFn(
      `
function count(n) {
  if (n <= 0) return 0;
  return 1 + count(n - 1);
}
`,
      "count",
      [lit5],
      pTrue,
    );
    // 5 层展开应收敛为字面量 5（或至少 number）
    expect(r.shape.k === "prim" || r.shape.k === "never").toBe(true);
    if (r.term && r.term.op === "lit") {
      expect(r.term.value).toBe(5);
    }
  });

  it("checkSource completes on factorial with structured diagnostics", () => {
    const report = checkSource("/tmp/fac.js", FAC, pTrue, {});
    expect(report).toBeDefined();
    // 不得崩溃；递归截断记 warning
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain("nudo:recursion-truncated");
    expect(report.issues.every((i) => i.severity !== undefined)).toBe(true);
  });

  it("depth budget constant is aligned with TypeValue evaluator", () => {
    expect(MAX_CALL_DEPTH).toBe(64);
  });

  it("truncated result uses opaque conf, not partial-any", () => {
    resetAbsCallBudget();
    const r = analyzeFn(FAC, "fac", [num()], pTrue);
    // 截断后应为 unknown+opaque，或仍能算出的 prim；绝不能是 exact 的假结果
    if (r.shape.k === "unknown") {
      expect(r.conf === "opaque" || r.conf === "partial" || r.conf === "widened").toBe(true);
    }
  });
});
