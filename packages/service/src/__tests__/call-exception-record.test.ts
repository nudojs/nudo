/**
 * BUG-008 service 侧回归：EvalCallRecord → CallRecord 桥。
 * threw 时 result 位承载抛出 Abs（$callNamed / class.ts 同约定），
 * 桥后 throwsAbs 必须是非 never 载荷——不得落成 never+never 被
 * isLeakedCallRecord 判「泄漏」丢弃。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, setEvalCallCollector, numLit, type EvalCallRecord } from "@nudojs/core";
import { callTranspiledExportFull } from "@nudojs/core";
import { callRecordFromAbsCall } from "../analyzer-abs-eval.ts";
import { isLeakedCallRecord, neverAbs } from "../evaluator/call-record.ts";

function collect(src: string, fnName: string): EvalCallRecord[] {
  const records: EvalCallRecord[] = [];
  const prev = setEvalCallCollector((r) => records.push(r));
  try {
    const run = runTranspiled(src, { mode: "analyze" });
    callTranspiledExportFull(run, fnName, [numLit(1)]);
  } finally {
    setEvalCallCollector(prev);
  }
  return records;
}

describe("BUG-008: callRecordFromAbsCall keeps throw payload", () => {
  it("custom throw payload → throwsAbs non-never, resultAbs never", () => {
    const records = collect(
      `
      function boom(x) { throw "cb-payload"; }
      export function g(x) { return boom(x); }
    `,
      "g",
    );
    const boom = records.find((r) => r.fnName === "boom");
    expect(boom).toBeDefined();
    const rec = callRecordFromAbsCall(boom!);
    expect(rec.resultAbs.shape.k).toBe("never");
    expect(rec.throwsAbs.shape.k).not.toBe("never");
    expect(isLeakedCallRecord(rec)).toBe(false);
  });

  it("native TypeError throw → throwsAbs non-never (not leaked)", () => {
    const records = collect(
      `
      function boom(x) { throw new TypeError("t"); }
      export function g(x) { return boom(x); }
    `,
      "g",
    );
    const boom = records.find((r) => r.fnName === "boom");
    expect(boom).toBeDefined();
    const rec = callRecordFromAbsCall(boom!);
    expect(rec.throwsAbs.shape.k).not.toBe("never");
    expect(isLeakedCallRecord(rec)).toBe(false);
  });

  it("isLeakedCallRecord still flags true never+never", () => {
    expect(
      isLeakedCallRecord({
        fnName: "x",
        argAbs: [],
        resultAbs: neverAbs,
        throwsAbs: neverAbs,
      }),
    ).toBe(true);
  });
});
