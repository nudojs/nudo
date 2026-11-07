/**
 * BUG-011 回归：跨模块调用记录全部**超限被丢**时，合成路径不得解引用空数组。
 *
 * 改前 `synthesizeExternalFunctions` 直接读 `deduped[0].callLoc` /
 * `deduped[0].resultAbs` ⇒ TypeError 抛出分析器（`nudo check` 吞掉异常后
 * 静默假绿，`nudo test` / `export` 直接崩溃）。
 */
import { describe, it, expect } from "vitest";
import { numLit, type Abs } from "@nudojs/core";
import { synthesizeExternalFunctions } from "../analyzer-diagnose.ts";
import { MAX_RECORD_TYPE_NODES, neverAbs, type CallRecord } from "../evaluator/call-record.ts";

/** > MAX_RECORD_TYPE_NODES 个形状节点的对象 Abs。 */
function oversizedObjAbs(): Abs {
  const slots: Record<string, { value: Abs }> = {};
  for (let i = 0; i < MAX_RECORD_TYPE_NODES + 500; i++) slots[`k${i}`] = { value: numLit(i) };
  return { shape: { k: "obj", slots }, conf: "exact" } as Abs;
}

function record(over: Partial<CallRecord>): CallRecord {
  return {
    fnName: "pick",
    argAbs: [numLit(1)],
    resultAbs: numLit(1),
    throwsAbs: neverAbs,
    callLoc: { line: 3, column: 0 },
    targetModule: "/proj/lib.js",
    targetExport: "pick",
    ...over,
  };
}

describe("BUG-011 — 超限调用记录不得让分析器崩溃", () => {
  it("组内记录全部超限 ⇒ 整组跳过（不抛、不产出残缺分析）", () => {
    const out = synthesizeExternalFunctions(
      [record({ argAbs: [oversizedObjAbs()] }), record({ argAbs: [oversizedObjAbs()] })],
      "/proj/main.js",
    );
    expect(out).toEqual([]);
  });

  it("对照组：正常记录照常合成（口径不变）", () => {
    const out = synthesizeExternalFunctions([record({})], "/proj/main.js");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("pick");
    expect(out[0]!.loc.start.line).toBe(3);
    expect(out[0]!.combinedAbs).toBeDefined();
  });
});
