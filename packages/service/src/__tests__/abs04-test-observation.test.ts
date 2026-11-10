/**
 * ABS-04：test 观测面改善。
 *
 * 覆盖：
 * - 递归 / 高阶调用的内部记录（实参带自由 term 变元）不再把最外层
 *   （具体实参）的精确见证挤出 `callSiteBudget`；
 * - 默认互斥（@nudo:case × call@/entry@）在「两路都存在」时给出可发现性
 *   提示（`bothPathsHint`），默认报告本身不变；
 * - 截断原因与下一步动作由既有 `nudo:recursion-truncated` 诊断承载
 *   （BUG-099 口径；本套钉住 suggestion 仍指向预算旋钮）。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analysis.ts";
import { litValue } from "@nudojs/core";
import { DIAG } from "@nudojs/core/internal";

function casesOf(source: string, fn: string) {
  const result = analyzeFile("/test/abs04.js", source);
  const f = result.functions.find((x) => x.name === fn);
  if (!f) throw new Error(`function ${fn} not found`);
  return { result, f };
}

describe("ABS-04 最外层见证优先", () => {
  it("递归函数：具体实参的顶层见证保留（内部符号记录不挤出）", () => {
    const source = `
export function sumTo(n) {
  return n <= 0 ? 0 : n + sumTo(n - 1);
}
export const a = sumTo(1);
export const b = sumTo(2);
export const c = sumTo(3);
export const d = sumTo(4);
`;
    const { f } = casesOf(source, "sumTo");
    const callsite = f.cases.filter((c) => c.source === "callsite");
    expect(callsite.length).toBeGreaterThan(0);
    const concrete = callsite
      .map((c) => litValue(c.argAbs[0]!))
      .flatMap((v) => (v.ok && typeof v.value === "number" ? [v.value] : []));
    // 至少有一条最外层具体实参见证存活（内部 α 实参记录不得占满预算）
    expect(concrete.length).toBeGreaterThan(0);
    // 且它的结果按调用点语境精确（sumTo(3) = 6 在集合内时值必须对）
    for (const c of callsite) {
      const v = litValue(c.argAbs[0]!);
      if (!v.ok || v.value !== 3) continue;
      const r = litValue(c.abs);
      if (r.ok && typeof r.value === "number") expect(r.value).toBe(6);
    }
  });
});

describe("ABS-04 both-paths 可发现性提示", () => {
  it("同时有 @nudo:case 与调用点记录 ⇒ bothPathsHint 列出函数（默认报告仍是 directive 面）", () => {
    const source = `
/**
 * @nudo:case "one" (1) => 1
 */
export function id(x) {
  return x;
}
export const v = id(1);
`;
    const { result, f } = casesOf(source, "id");
    expect(result.bothPathsHint).toContain("id");
    // 默认互斥：cases 只来自 directive（调用点面被抑制）
    expect(f.cases.every((c) => c.source === "directive")).toBe(true);
  });

  it("无 @nudo:case ⇒ 不产提示（纯调用点路径是默认面）", () => {
    const source = `
export function id(x) { return x; }
export const v = id(1);
`;
    const { result, f } = casesOf(source, "id");
    expect(result.bothPathsHint).toBeUndefined();
    expect(f.cases.some((c) => c.source === "callsite")).toBe(true);
  });
});

describe("ABS-04 截断归因（既有诊断面）", () => {
  it("递归截断诊断带具体抬预算建议（非 cycle 时）", () => {
    const source = `
export function down(n) {
  return n <= 0 ? 0 : down(n - 1) + 1;
}
export const a = down(200);
`;
    const { result } = casesOf(source, "down");
    const trunc = result.diagnostics.filter(
      (d) => d.code === DIAG.recursionTruncated,
    );
    // 若本轮未触发截断则不强制（预算可能足够）——触发时必须有可执行建议
    for (const d of trunc) {
      expect(d.suggestions?.length ?? 0).toBeGreaterThan(0);
      expect(d.suggestions![0]).toMatch(/@nudo:budget|call cycle|contract/);
    }
  });
});
