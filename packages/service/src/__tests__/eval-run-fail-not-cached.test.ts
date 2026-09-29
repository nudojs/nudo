import { describe, it, expect, afterEach } from "vitest";
import {
  absFunction,
  numLit,
  setEvalFallbackCollector,
  type Abs,
  type EvalFallback,
} from "@nudojs/core";
import { tryRunEval, clearEvalCache, getEvalCacheSize } from "../eval-run.ts";

/** 调一次即抛、再调成功的 mock：同 fingerprint → 同 cache key。 */
function throwsOnceMock(counter: { calls: number }): Abs {
  return absFunction([], {
    apply: () => {
      counter.calls += 1;
      if (counter.calls === 1) throw new Error("transient eval boom");
      return numLit(1);
    },
    fingerprint: "throws-once-mock",
  });
}

function withFallbacks<T>(fn: () => T): { result: T; fallbacks: EvalFallback[] } {
  const fallbacks: EvalFallback[] = [];
  setEvalFallbackCollector((f) => fallbacks.push(f));
  try {
    return { result: fn(), fallbacks };
  } finally {
    setEvalFallbackCollector(null);
  }
}

describe("tryRunEval failure is not memoized", () => {
  afterEach(() => {
    clearEvalCache();
    setEvalFallbackCollector(null);
  });

  it("transient failure then success is not permanently undefined", () => {
    const counter = { calls: 0 };
    const boom = throwsOnceMock(counter);
    // mode=exec：analyze 会 strip 顶层副作用，mock 不会被调用
    const src = `const r = boom(); export const x = 1;`;
    const file = "/tmp/eval-run-fail-once.js";

    const first = withFallbacks(() =>
      tryRunEval(src, file, { mode: "exec", mocks: { boom } }),
    );
    expect(first.result).toBeUndefined();
    // 失败可观测（对齐 tryRunTranspiled）
    expect(first.fallbacks.length).toBeGreaterThan(0);
    expect(first.fallbacks[0]!.message).toContain("transient eval boom");
    // 失败结果不得入 memo
    expect(getEvalCacheSize()).toBe(0);

    const second = tryRunEval(src, file, { mode: "exec", mocks: { boom } });
    expect(second).toBeDefined();
    expect(second!.exports).toHaveProperty("x");
    // 同 key 重新求值（而非 cache 命中恒 undefined）
    expect(counter.calls).toBe(2);
    expect(getEvalCacheSize()).toBe(1);
  });

  it("successful result still caches and hits", () => {
    const counter = { calls: 0 };
    const ok = absFunction([], {
      apply: () => {
        counter.calls += 1;
        return numLit(7);
      },
      fingerprint: "ok-mock",
    });
    const src = `const r = ok(); export const x = 1;`;
    const file = "/tmp/eval-run-ok-cache.js";

    const a = tryRunEval(src, file, { mode: "exec", mocks: { ok } });
    expect(a).toBeDefined();
    const b = tryRunEval(src, file, { mode: "exec", mocks: { ok } });
    expect(b).toBeDefined();
    expect(counter.calls).toBe(1);
    expect(getEvalCacheSize()).toBe(1);
  });
});
