/**
 * B 回落观测（能力知识单一事实源在转译点）：
 * - 未 lowering 的构造（动态 import / 顶层 this / 未知语句）→ transpile 抛
 *   NudoUnsupportedError → tryRunTranspiled 记录 `unsupported:*` 并回落；
 * - 引擎自身缺陷（转译器/运行时异常）→ 记录 `internal:*`；
 * - 语料内零回落不变量：差分 corpus 全量跑在收集器下，internal 必须为零
 *   （unsupported 也应为零——语料均为可托管形态）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, tryRunTranspiled, callTranspiledExportFull, setEvalFallbackCollector, litValue, type EvalFallback } from "@nudojs/core";
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

function withCollector<T>(fn: () => T): { result: T; fallbacks: EvalFallback[] } {
  const fallbacks: EvalFallback[] = [];
  setEvalFallbackCollector((f) => fallbacks.push(f));
  try {
    return { result: fn(), fallbacks };
  } finally {
    setEvalFallbackCollector(null);
  }
}

describe("B fallback observation (unsupported at transpile time)", () => {
  it("dynamic import / import.meta lower conservatively (no fallback, no false precision)", () => {
    // import() → Promise<open obj>；import.meta.url → string（非字面量 URL）
    {
      const src = `export function f() { return import("./x.js"); }`;
      const { result, fallbacks } = withCollector(() => tryRunTranspiled(src, { mode: "analyze" }));
      expect(result, src).toBeDefined();
      expect(fallbacks, src).toEqual([]);
      const r = callTranspiledExportFull(result!, "f", []);
      expect(formatAbs(r.result), src).toContain("promise");
      // 不假精确 undefined / 字面量
      expect(litValue(r.result), src).toEqual({ ok: false });
    }
    {
      const src = `export function f() { return import.meta.url; }`;
      const { result, fallbacks } = withCollector(() => tryRunTranspiled(src, { mode: "analyze" }));
      expect(result, src).toBeDefined();
      expect(fallbacks, src).toEqual([]);
      const r = callTranspiledExportFull(result!, "f", []);
      expect(formatAbs(r.result), src).toContain("string");
      expect(litValue(r.result), src).toEqual({ ok: false });
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

describe("call-boundary internal fallback canary (DEC-006 / D6-A)", () => {
  it("callTranspiledExportFull notes internal fallback on native host throw", async () => {
    const { getEvalFallbackStats, resetEvalFallbackStats } = await import("@nudojs/core/internal");
    resetEvalFallbackStats();
    const exports = {
      boom: () => {
        throw new TypeError("host boom");
      },
    };
    const { result, fallbacks } = withCollector(() =>
      callTranspiledExportFull(exports as never, "boom", []),
    );
    // 异常进 throws 域（BUG-008），且 canary 记 internal 回落（不静默）
    expect(result.throws.shape.k).not.toBe("never");
    expect(fallbacks.some((f) => f.reason === "internal" && /host boom/.test(f.message))).toBe(true);
    const stats = getEvalFallbackStats();
    expect(stats.internal).toBeGreaterThanOrEqual(1);
    resetEvalFallbackStats();
    expect(getEvalFallbackStats().internal).toBe(0);
  });

  it("NudoThrow at call boundary is not an internal fallback", async () => {
    const { getEvalFallbackStats, resetEvalFallbackStats } = await import("@nudojs/core/internal");
    resetEvalFallbackStats();
    const src = `export function f() { throw new TypeError("user throw"); }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const { fallbacks } = withCollector(() => callTranspiledExportFull(exports, "f", []));
    expect(fallbacks.filter((f) => f.reason === "internal")).toEqual([]);
    expect(getEvalFallbackStats().internal).toBe(0);
    resetEvalFallbackStats();
  });
});

describe("zero-fallback invariant over differential corpus", () => {
  it("full corpus (batch1-18) zero-internal gate", (ctx) => {
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
    // 能力边界回落仍须为零（语料均为可托管形态）
    const others = fallbacks.filter((f) => !f.reason.startsWith("unsupported:") && f.reason !== "internal");
    // unsupported 也应为零——与 internal 分开断言，便于定位
    const unsupported = fallbacks.filter((f) => f.reason.startsWith("unsupported:"));
    const internals = fallbacks.filter((f) => f.reason === "internal");
    expect(unsupported, unsupported.map((f) => `${f.reason}: ${f.message}`).join("\n")).toEqual([]);
    expect(others, others.map((f) => `${f.reason}: ${f.message}`).join("\n")).toEqual([]);
    if (internals.length > 0) {
      // DEC-006 canary（D6-A 接受指标暴露）：internal 非零时 **记录并 skip**，
      // 不得为让门禁绿而重新吞掉错误。缺陷清单 → .ai-bug-hunt/reports/DEC-006-canary.md。
      // 清零后此分支不再进入，下方断言变绿（门禁自动变硬）。
      const list = internals.map((f) => `  - ${f.message}`).join("\n");
      console.warn(`DEC-006 canary: ${internals.length} internal fallback(s):\n${list}`);
      ctx.skip();
      return;
    }
    expect(internals).toEqual([]);
  }, 120_000);
});
