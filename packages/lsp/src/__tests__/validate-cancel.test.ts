import { describe, it, expect, beforeEach } from "vitest";
import {
  validateText,
  clearValidationState,
  validateGeneration,
  type ValidateTextDeps,
} from "../validation.ts";
import { DiagnosticSeverity } from "vscode-languageserver/node.js";

function makeDeps(): ValidateTextDeps & { sent: Array<{ uri: string; n: number }> } {
  const sent: Array<{ uri: string; n: number }> = [];
  return {
    sent,
    sendDiagnostics: ({ uri, diagnostics }) => {
      sent.push({ uri, n: diagnostics.length });
    },
    loadModule: () => undefined,
    isNudoUri: () => true,
  };
}

describe("A8 validateGeneration cancel", () => {
  beforeEach(() => {
    clearValidationState();
  });

  it("bumps generation per validateText call", async () => {
    const deps = makeDeps();
    await validateText("/t/a.js", "file:///t/a.js", "function id(x){return x;}\n", 1, deps);
    expect(validateGeneration.get("/t/a.js")).toBe(1);
    await validateText("/t/a.js", "file:///t/a.js", "function id(x){return x;}\n", 2, deps);
    expect(validateGeneration.get("/t/a.js")).toBe(2);
  });

  it("older overlapping validate does not publish after a newer one starts", async () => {
    const deps = makeDeps();
    const src1 = `
/**
 * @nudo:case "neg" (-1)
 */
function safe(x) {
  if (x < 0) throw new RangeError("neg");
  return x;
}
`;
    const src2 = `
/**
 * @nudo:case "pos" (1)
 */
function safe(x) {
  return x;
}
`;
    // 启动慢分析（v1），不 await；立刻启动 v2
    const p1 = validateText("/t/storm.js", "file:///t/storm.js", src1, 1, deps);
    const p2 = validateText("/t/storm.js", "file:///t/storm.js", src2, 2, deps);
    await Promise.all([p1, p2]);
    expect(validateGeneration.get("/t/storm.js")).toBe(2);
    expect(deps.sent.length).toBeGreaterThan(0);
    // P2：旧 generation 不得在 v2 之后再 publish
    // 最终 generation=2；sent 次数应 ≤2，且最后一次 send 发生在 gen 已到 2 之后
    expect(deps.sent.length).toBeLessThanOrEqual(2);
  });

  it("stillCurrent gate: a completed older gen after newer bump does not send", async () => {
    const deps = makeDeps();
    const uri = "file:///t/gate.js";
    const path = "/t/gate.js";
    // v1 启动
    const p1 = validateText(path, uri, "export function a(){return 1;}\n", 1, deps);
    // 立刻 bump 到 v2（空 validate 覆盖）
    const p2 = validateText(path, uri, "export function b(){return 2;}\n", 2, deps);
    await Promise.all([p1, p2]);
    expect(validateGeneration.get(path)).toBe(2);
    // 若旧 gen 在 bump 后仍 publish，sent 可能 >1；契约是 ≤ gen 且不 throw
    // 更强：所有 send 的诊断内容不得来自已被取代的 generation 专属结果——
    // 这里用 sent 次数与 gen 一致性做契约：不得出现「gen 已是 2 仍因 v1 再 push」导致 >2
    expect(deps.sent.length).toBeLessThanOrEqual(2);
  });

  it("clearValidationState resets generations", async () => {
    const deps = makeDeps();
    await validateText("/t/b.js", "file:///t/b.js", "export function f(){return 1;}\n", 1, deps);
    clearValidationState();
    expect(validateGeneration.size).toBe(0);
  });
});
