/**
 * B 回落观测（能力知识单一事实源在转译点）：
 * - 未 lowering 的构造（动态 import / 顶层 this / 未知语句）→ transpile 抛
 * NudoUnsupportedError → tryRunTranspiled 记录 `unsupported:*` 并回落；
 * - 引擎自身缺陷（转译器/运行时异常）→ 记录 `internal:*`；
 * - 语料内零回落不变量由差分门禁承担（`differential/harness.ts` 的
 * `runCorpus` 在同一次语料执行里收集回落，三个 differential 套件断言为零；
 * 本文件不再重跑全语料）。
 */
import {describe, it, expect} from "vitest";
import {runTranspiled, tryRunTranspiled, callTranspiledExportFull, setEvalFallbackCollector, litValue, type EvalFallback} from "@nudojs/core";
import {formatAbs} from "../format/format.ts";

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
    const {getEvalFallbackStats, resetEvalFallbackStats} = await import("@nudojs/core/internal");
    resetEvalFallbackStats();
    const exports = {
      boom: () => {
        throw new TypeError("host boom");
      },
    };
    const { result, fallbacks } = withCollector(() =>
      callTranspiledExportFull(exports as never, "boom", []),
    );
    // 异常进 throws 域（），且 canary 记 internal 回落（不静默）
    expect(result.throws.shape.k).not.toBe("never");
    expect(fallbacks.some((f) => f.reason === "internal" && /host boom/.test(f.message))).toBe(true);
    const stats = getEvalFallbackStats();
    expect(stats.internal).toBeGreaterThanOrEqual(1);
    resetEvalFallbackStats();
    expect(getEvalFallbackStats().internal).toBe(0);
  });

  it("NudoThrow at call boundary is not an internal fallback", async () => {
    const {getEvalFallbackStats, resetEvalFallbackStats} = await import("@nudojs/core/internal");
    resetEvalFallbackStats();
    const src = `export function f() { throw new TypeError("user throw"); }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const { fallbacks } = withCollector(() => callTranspiledExportFull(exports, "f", []));
    expect(fallbacks.filter((f) => f.reason === "internal")).toEqual([]);
    expect(getEvalFallbackStats().internal).toBe(0);
    resetEvalFallbackStats();
  });
});
