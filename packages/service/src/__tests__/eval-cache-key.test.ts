import { it, expect, describe, afterEach } from "vitest";
import {
  tryRunEval,
  tryEvalCall,
  clearEvalCache,
  getEvalCacheSize,
  evictEvalCacheForFiles,
  setSessionCacheLimits,
  resetSessionCacheLimitState,
} from "@nudojs/service";
import { litValue } from "@nudojs/core";

afterEach(() => clearEvalCache());

describe("evalRunCache key", () => {
  // 同长度、前 200+ 字符完全相同、尾部不同的两份源码：
  // 旧前缀截断键会命中同一条缓存，静默返回陈旧结果。
  const head = `// ${"x".repeat(210)}\nexport function f() { return `;
  const srcA = `${head}1; }`;
  const srcB = `${head}2; }`;

  it("same source twice returns the identical cached run", () => {
    const a = tryRunEval(srcA, "/test/cache-key.js");
    const b = tryRunEval(srcA, "/test/cache-key.js");
    expect(a).toBeDefined();
    expect(b).toBe(a);
  });

  it("same length + same prefix but different tail must not collide", () => {
    const r1 = tryRunEval(srcA, "/test/cache-key.js");
    const r2 = tryRunEval(srcB, "/test/cache-key.js");
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(r2).not.toBe(r1);

    // 语义正确性：src求值引擎的求值必须看到 f() = 2，而非 srcA 的陈旧 1
    const out = tryEvalCall(srcB, "/test/cache-key.js", "f", []);
    if (!out) throw new Error("expected f to resolve via eval path");
    expect(litValue(out)).toEqual({ ok: true, value: 2 });
  });
});

describe("evalRunCache LRU order (BUG-012)", () => {
  const mk = (v: number) => `export function f() { return ${v}; }`;

  afterEach(() => {
    setSessionCacheLimits(null);
    resetSessionCacheLimitState();
    clearEvalCache();
  });

  it("overwriting an existing key (edited source, same path) refreshes its LRU position", () => {
    setSessionCacheLimits({ maxEvalRuns: 2 });
    tryRunEval(mk(1), "/t/lru-a.js");
    tryRunEval(mk(2), "/t/lru-b.js");
    tryRunEval(mk(3), "/t/lru-a.js"); // 编辑后重算同一路径：覆盖写刷新为最近使用
    tryRunEval(mk(4), "/t/lru-c.js"); // 容量 2：逐出 /t/lru-b.js，而不是刚写过的 /t/lru-a.js
    expect(getEvalCacheSize()).toBe(2);
    expect(evictEvalCacheForFiles(["/t/lru-b.js"])).toBe(0); // 已被逐出
    expect(evictEvalCacheForFiles(["/t/lru-a.js"])).toBe(1); // 新写条目存活
  });

  it("maxEvalRuns=0 disables reads too — recompute instead of stale hit", () => {
    setSessionCacheLimits({ maxEvalRuns: 2 });
    const r1 = tryRunEval(mk(1), "/t/off.js");
    expect(r1).toBeDefined();
    setSessionCacheLimits({ maxEvalRuns: 0 });
    const r2 = tryRunEval(mk(1), "/t/off.js");
    expect(r2).toBeDefined();
    expect(r2).not.toBe(r1); // 重算（新对象），而非陈旧命中（同一缓存对象）
    expect(getEvalCacheSize()).toBe(1); // 写路径关闭：不新增条目
  });
});
