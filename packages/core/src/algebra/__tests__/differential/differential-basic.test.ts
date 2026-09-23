/**
 * 差分语料门禁（P0 oracle 收编）：batch1–9——字符串/数组/对象/正则/
 * 控制流/数字静态等基础面。每条语料 B-path 执行 vs strict native 对照，
 * 零 mismatch；total compared 下限防语料整体退化（concrete 盲区哨兵）。
 */
import { describe, it, expect } from "vitest";
import { runCorpus, sectionsOf } from "./harness.ts";
import * as b1 from "./corpus/batch1.ts";
import * as b2 from "./corpus/batch2.ts";
import * as b3 from "./corpus/batch3.ts";
import * as b4 from "./corpus/batch4.ts";
import * as b5 from "./corpus/batch5.ts";
import * as b6 from "./corpus/batch6.ts";
import * as b7 from "./corpus/batch7.ts";
import * as b8 from "./corpus/batch8.ts";
import * as b9 from "./corpus/batch9.ts";

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
        const { compared, mismatches } = runCorpus(corpus);
        totalCompared += compared;
        expect(
          mismatches,
          `${file}.${name} compared=${compared}\n${mismatches.join("\n")}`,
        ).toEqual([]);
      }, 120_000);
    }
  }
  it("total compared floor (corpus must not degrade into skips)", () => {
    expect(totalCompared).toBeGreaterThan(150);
  });
});
