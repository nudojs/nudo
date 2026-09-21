/**
 * 差分语料门禁（P0 oracle 收编）：batch14–18——Promise/Date/JSON/RegExp
 * ctor/Map-Set/字符串数字数组边缘 + 第 18 批六类修复的读层金丝雀。
 */
import { describe, it, expect } from "vitest";
import { runCorpus, sectionsOf } from "./harness.ts";
import * as b14a from "./corpus/batch14a.ts";
import * as b14b from "./corpus/batch14b.ts";
import * as b14c from "./corpus/batch14c.ts";
import * as b14d from "./corpus/batch14d.ts";
import * as b14e from "./corpus/batch14e.ts";
import * as b14f from "./corpus/batch14f.ts";
import * as b15a from "./corpus/batch15a.ts";
import * as b15b from "./corpus/batch15b.ts";
import * as b15c from "./corpus/batch15c.ts";
import * as b15d from "./corpus/batch15d.ts";
import * as b16a from "./corpus/batch16a.ts";
import * as b16b from "./corpus/batch16b.ts";
import * as b16c from "./corpus/batch16c.ts";
import * as b16d from "./corpus/batch16d.ts";
import * as b17a from "./corpus/batch17a.ts";
import * as b17b from "./corpus/batch17b.ts";
import * as b18 from "./corpus/batch18-readprobes.ts";

const FILES: Array<[string, Record<string, unknown>]> = [
  ["batch14a", b14a],
  ["batch14b", b14b],
  ["batch14c", b14c],
  ["batch14d", b14d],
  ["batch14e", b14e],
  ["batch14f", b14f],
  ["batch15a", b15a],
  ["batch15b", b15b],
  ["batch15c", b15c],
  ["batch15d", b15d],
  ["batch16a", b16a],
  ["batch16b", b16b],
  ["batch16c", b16c],
  ["batch16d", b16d],
  ["batch17a", b17a],
  ["batch17b", b17b],
  ["batch18-readprobes", b18],
];

let totalCompared = 0;

describe("differential corpus batch14-18", () => {
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
    expect(totalCompared).toBeGreaterThan(300);
  });
});
