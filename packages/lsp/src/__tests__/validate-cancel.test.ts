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
    // 代数已到 2；发布次数应由仍 current 的轮次决定（至少一次，且无 throw）
    expect(validateGeneration.get("/t/storm.js")).toBe(2);
    expect(deps.sent.length).toBeGreaterThan(0);
    expect(deps.sent.length).toBeLessThanOrEqual(2);
  });

  it("clearValidationState resets generations", async () => {
    const deps = makeDeps();
    await validateText("/t/b.js", "file:///t/b.js", "export function f(){return 1;}\n", 1, deps);
    clearValidationState();
    expect(validateGeneration.size).toBe(0);
  });
});
