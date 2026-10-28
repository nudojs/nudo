/**
 * BUG-127 回归：调用记录去重必须按**调用点身份**，不能按「形态」——
 * 两个不同现场的调用只要实参/结果/throws 形状相同就会被判成同一条
 * ⇒ 后到现场的见证被吞，`--from` 顺序决定谁活下来。
 */
import { describe, it, expect } from "vitest";
import { numLit } from "@nudojs/core";
import { dedupeCallRecords } from "../analyzer-diagnose.ts";
import { neverAbs, type CallRecord } from "../evaluator/call-record.ts";

function rec(line: number, column: number): CallRecord {
  return {
    fnName: "id",
    argAbs: [numLit(1)],
    resultAbs: numLit(1),
    throwsAbs: neverAbs,
    callLoc: { line, column },
  };
}

describe("BUG-127 — 去重键含调用点身份", () => {
  it("同形态但不同调用点 ⇒ 两条独立见证（顺序无关）", () => {
    expect(dedupeCallRecords([rec(2, 0), rec(5, 0)])).toHaveLength(2);
    expect(dedupeCallRecords([rec(5, 0), rec(2, 0)])).toHaveLength(2);
    // 同一行不同列同样是两个调用点
    expect(dedupeCallRecords([rec(2, 0), rec(2, 8)])).toHaveLength(2);
  });

  it("对照组：同一调用点被重复采集 ⇒ 仍去重成一条", () => {
    expect(dedupeCallRecords([rec(2, 0), rec(2, 0)])).toHaveLength(1);
  });
});
