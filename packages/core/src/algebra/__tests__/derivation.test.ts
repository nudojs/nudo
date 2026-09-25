/**
 * 推导图 side-channel（design-refine-derivation §14.3#6 / Phase 2）：
 * add/join 打点 → root 标签 → 组合式投影（positive.shift(1)）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { constraintToEntryAbs, number, runTranspiled, callTranspiledExportFull, setBCallCollector, type BCallRecord } from "../index.ts";
import { beginDerivationSession, abortDerivationSession, endDerivationSession, getDerivation, tagDerivationRoot, projectDerivationDsl } from "../../internal.ts";

/** B 路径驱动：runTranspiled + 导出调用（取代 analyzeFn 的求值面） */
function analyzeExport(src: string, fnName: string, args: import("../index.ts").Abs[]): import("../index.ts").Abs {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, fnName, args).result;
}

describe("derivation collector", () => {
  beforeEach(() => {
    beginDerivationSession();
  });
  afterEach(() => {
    abortDerivationSession();
    setBCallCollector(null);
  });

  it("tags a root and records a +k shift on the call arg", () => {
    const positive = number().gt(0);
    const entry = constraintToEntryAbs(positive, "x");
    tagDerivationRoot(entry, { expr: "positive", importFrom: "./std.nudo.js", importName: "positive" });

    const src = `
function add2(x) { return x + 2; }
export function add4(x) { return add2(x + 1) + 1; }
`;
    const calls: BCallRecord[] = [];
    setBCallCollector((r) => calls.push(r));
    analyzeExport(src, "add4", [entry]);
    setBCallCollector(null);

    expect(calls.length).toBe(1);
    const arg = calls[0]!.args[0]!;
    const node = getDerivation(arg);
    expect(node).toBeDefined();
    expect(node!.kind).toBe("shift");
    expect(node!.offset).toBe(1);

    const proj = projectDerivationDsl(node!, "x");
    expect(proj).toBeDefined();
    expect(proj!.prelude).toEqual(["const x = positive.shift(1);"]);
    expect(proj!.expr).toBe("x");
    expect(proj!.imports).toEqual([{ name: "positive", from: "./std.nudo.js" }]);
  });

  it("records a second shift on the callee body result", () => {
    const positive = number().gt(0);
    const entry = constraintToEntryAbs(positive, "x");
    tagDerivationRoot(entry, { expr: "positive" });

    const src = `
function add2(x) { return x + 2; }
export function add4(x) { return add2(x + 1) + 1; }
`;
    const calls: BCallRecord[] = [];
    setBCallCollector((r) => calls.push(r));
    analyzeExport(src, "add4", [entry]);
    setBCallCollector(null);

    const arg = calls[0]!.args[0]!;
    // 用同一 arg Abs 求值 add2 body → result 应是 shift(2) from arg
    const ret = analyzeExport(`export function add2(x) { return x + 2; }`, "add2", [arg]);
    const retNode = getDerivation(ret);
    expect(retNode).toBeDefined();
    expect(retNode!.kind).toBe("shift");
    expect(retNode!.offset).toBe(2);

    const proj = projectDerivationDsl(retNode!, "x");
    expect(proj).toBeDefined();
    // 链式不加总：positive.shift(1).shift(2) → 中间量 + 最终 local
    expect(proj!.prelude).toEqual([
      "const x_0 = positive.shift(1);",
      "const x = x_0.shift(2);",
    ]);
  });

  it("endDerivationSession returns nodes in creation order", () => {
    const positive = number().gt(0);
    const entry = constraintToEntryAbs(positive, "x");
    tagDerivationRoot(entry, { expr: "positive" });
    analyzeExport(`export function f(x) { return x + 3; }`, "f", [entry]);
    const nodes = endDerivationSession();
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    expect(nodes[0]!.kind).toBe("root");
    expect(nodes.some((n) => n.kind === "shift" && n.offset === 3)).toBe(true);
  });
});
