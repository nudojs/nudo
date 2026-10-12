/**
 * 差分语料门禁（P0 oracle 收编）：batch1–9——字符串/数组/对象/正则/
 * 控制流/数字静态等基础面。每条语料 evaluator 执行 vs strict native 对照，
 * 零 mismatch；total compared 下限防语料整体退化（concrete 盲区哨兵）；
 * skip 台账对账 skip-baseline.json——新增 skip（基线外 unknown 回归）即失败。
 */
import { describe, it, expect } from "vitest";
import { runCorpus, sectionsOf, newSkippedBodies, unexpectedMismatches } from "./harness.ts";
import {
  batch1 as b1,
  batch2 as b2,
  batch3 as b3,
  batch4 as b4,
  batch5 as b5,
  batch6 as b6,
  batch7 as b7,
  batch8 as b8,
  batch9 as b9,
} from "./all-batches.ts";

const FILES: Array<[string, Record<string, unknown>]> = [
  ["batch1", b1],
  ["batch2", b2],
  ["batch3", b3],
  ["batch4", b4],
  ["batch5", b5],
  ["batch6", b6],
  ["batch7", b7],
  ["batch8", b8],
  ["batch9", b9],
];

let totalCompared = 0;

describe("differential corpus batch1-9", () => {
  for (const [file, mod] of FILES) {
    for (const [name, corpus] of sectionsOf(mod)) {
      it(`${file}.${name} zero mismatch`, () => {
        const { compared, mismatches, skipped } = runCorpus(corpus);
        totalCompared += compared;
        const unexpected = unexpectedMismatches(mismatches);
        expect(
          unexpected,
          `${file}.${name} compared=${compared} skipped=${skipped.length} mismatches=${mismatches.length}\n${unexpected.join("\n")}`,
        ).toEqual([]);
        const freshSkips = newSkippedBodies(`${file}.${name}`, skipped);
        expect(
          freshSkips,
          `${file}.${name} compared=${compared}: new skipped line(s) outside skip-baseline.json (unknown regression)\n${freshSkips.map((s) => `  [${s.replace(/\n/g, " ").slice(0, 100)}]`).join("\n")}`,
        ).toEqual([]);
      }, 120_000);
    }
  }
  it("total compared floor (corpus must not degrade into skips)", () => {
    expect(totalCompared).toBeGreaterThan(150);
  });
});
