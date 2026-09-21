/**
 * 差分语料门禁（P0 oracle 收编）：batch10–13——THROW 域/复合赋值/控制流
 * mutator/迭代器/强制转换等边缘面。
 */
import { describe, it, expect } from "vitest";
import { runCorpus, sectionsOf } from "./harness.ts";
import * as b10 from "./corpus/batch10.ts";
import * as b11 from "./corpus/batch11.ts";
import * as b12 from "./corpus/batch12.ts";
import * as b13 from "./corpus/batch13.ts";

const FILES: Array<[string, Record<string, unknown>]> = [
  ["batch10", b10],
  ["batch11", b11],
  ["batch12", b12],
  ["batch13", b13],
];

let totalCompared = 0;

describe("differential corpus batch10-13", () => {
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
    expect(totalCompared).toBeGreaterThan(200);
  });
});
