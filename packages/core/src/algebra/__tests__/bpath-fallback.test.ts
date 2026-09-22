/**
 * B 回落观测（能力知识单一事实源在转译点）：
 * - 未 lowering 的构造（动态 import / 顶层 this / 未知语句）→ transpile 抛
 *   NudoUnsupportedError → tryRunTranspiled 记录 `unsupported:*` 并回落；
 * - B 自身缺陷（转译器/运行时异常）→ 记录 `internal:*`；
 * - 语料内零回落不变量：差分 corpus 全量跑在收集器下，internal 必须为零
 *   （unsupported 也应为零——语料均为可托管形态）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, tryRunTranspiled, callTranspiledExportFull, setBPathFallbackCollector, litValue, type BPathFallback } from "@nudojs/core";
import { formatAbs } from "../format.ts";
import { runCorpus } from "./differential/harness.ts";
import * as b1 from "./differential/corpus/batch1.ts";
import * as b2 from "./differential/corpus/batch2.ts";
import * as b3 from "./differential/corpus/batch3.ts";
import * as b4 from "./differential/corpus/batch4.ts";
import * as b5 from "./differential/corpus/batch5.ts";
import * as b6 from "./differential/corpus/batch6.ts";
import * as b7 from "./differential/corpus/batch7.ts";
import * as b8 from "./differential/corpus/batch8.ts";
import * as b9 from "./differential/corpus/batch9.ts";
import * as b10 from "./differential/corpus/batch10.ts";
import * as b11 from "./differential/corpus/batch11.ts";
import * as b12 from "./differential/corpus/batch12.ts";
import * as b13 from "./differential/corpus/batch13.ts";
import * as b14a from "./differential/corpus/batch14a.ts";
import * as b14b from "./differential/corpus/batch14b.ts";
import * as b14c from "./differential/corpus/batch14c.ts";
import * as b14d from "./differential/corpus/batch14d.ts";
import * as b14e from "./differential/corpus/batch14e.ts";
import * as b14f from "./differential/corpus/batch14f.ts";
import * as b15a from "./differential/corpus/batch15a.ts";
import * as b15b from "./differential/corpus/batch15b.ts";
import * as b15c from "./differential/corpus/batch15c.ts";
import * as b15d from "./differential/corpus/batch15d.ts";
import * as b16a from "./differential/corpus/batch16a.ts";
import * as b16b from "./differential/corpus/batch16b.ts";
import * as b16c from "./differential/corpus/batch16c.ts";
import * as b16d from "./differential/corpus/batch16d.ts";
import * as b17a from "./differential/corpus/batch17a.ts";
import * as b17b from "./differential/corpus/batch17b.ts";
import * as b18 from "./differential/corpus/batch18-readprobes.ts";

function withCollector<T>(fn: () => T): { result: T; fallbacks: BPathFallback[] } {
  const fallbacks: BPathFallback[] = [];
  setBPathFallbackCollector((f) => fallbacks.push(f));
  try {
    return { result: fn(), fallbacks };
  } finally {
    setBPathFallbackCollector(null);
  }
}

describe("B fallback observation (unsupported at transpile time)", () => {
  it("dynamic import / import.meta lower conservatively (no fallback, no false precision)", () => {
    for (const src of [
      `export function f() { return import("./x.js"); }`,
      `export function f() { return import.meta.url; }`,
    ]) {
      const { result, fallbacks } = withCollector(() => tryRunTranspiled(src, { mode: "analyze" }));
      expect(result, src).toBeDefined();
      expect(fallbacks, src).toEqual([]);
      const r = callTranspiledExportFull(result!, "f", []);
      // 保守 unknown（此前静默折 $lit(undefined) #exact 是假精确）
      expect(formatAbs(r.result), src).toContain("unknown");
      expect(litValue(r.result), src).toBeUndefined();
    }
  });

  it("top-level this.x write throws at module load (ESM strict TypeError, not a B fallback)", () => {
    // ESM 语义：this === undefined → 写经 strict 写路径硬抛 TypeError。
    // 这是模块装载失败（程序行为），不是 B 能力边界——tryRunTranspiled
    // 仍返回 undefined（调用方回落），但不得记为 unsupported 回落。
    const src = `this.y = 1; export function f(x) { return x; }`;
    const { result, fallbacks } = withCollector(() => tryRunTranspiled(src, { mode: "analyze" }));
    expect(result).toBeUndefined();
    expect(fallbacks.every((f) => !f.reason.startsWith("unsupported:top-level-this"))).toBe(true);
    // 顶层 this 读（无写）不再回落：this === undefined
    const { result: r2, fallbacks: f2 } = withCollector(() =>
      tryRunTranspiled(`export const t = this; export function f(x) { return x; }`, { mode: "analyze" }),
    );
    expect(r2).toBeDefined();
    expect(f2).toEqual([]);
  });

  it("in-function this and object-method this stay capable (no fallback)", () => {
    for (const src of [
      `export function f() { return this.x; }`,
      `export function f() { return { m() { return this.x; } }; }`,
    ]) {
      const { result, fallbacks } = withCollector(() => tryRunTranspiled(src, { mode: "analyze" }));
      expect(result, src).toBeDefined();
      expect(fallbacks, src).toEqual([]);
    }
  });

  it("benign statements (empty / debugger) stay capable", () => {
    const src = `;; debugger; export function f(x) { return x + 1; }`;
    const { result, fallbacks } = withCollector(() => tryRunTranspiled(src, { mode: "analyze" }));
    expect(result).toBeDefined();
    expect(fallbacks).toEqual([]);
  });
});

describe("zero-fallback invariant over differential corpus", () => {
  it("full corpus (batch1-18) never triggers B fallback", () => {
    const sections = [
      b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13,
      b14a, b14b, b14c, b14d, b14e, b14f,
      b15a, b15b, b15c, b15d,
      b16a, b16b, b16c, b16d, b17a, b17b, b18,
    ].flatMap((mod) =>
      Object.entries(mod).filter(([, v]) => Array.isArray(v)),
    ) as Array<[string, string[]]>;
    const { fallbacks } = withCollector(() => {
      for (const [, corpus] of sections) runCorpus(corpus);
    });
    expect(fallbacks, fallbacks.map((f) => `${f.reason}: ${f.message}`).join("\n")).toEqual([]);
  }, 120_000);
});
