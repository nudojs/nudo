import { it, expect, describe, afterEach } from "vitest";
import {
  tryRunEval,
  tryEvalCall,
  clearEvalCache,
  getEvalCacheSize,
  evictEvalCacheForFiles,
  setSessionCacheLimits,
  resetSessionCacheLimitState,
  clearAbsModuleCache,
} from "@nudojs/service";
import { callTranspiledExport } from "../eval-run.ts";
import { litValue } from "@nudojs/core";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("evalRunCache dimension keys: lenientGlobals / maxLoopIters 不得互命中", () => {
  it("different lenientGlobals must not cross-hit the same entry", () => {
    const src = `export function f() { return 7; }\n`;
    const file = "/test/dim-lenient.js";
    const a = tryRunEval(src, file, { mode: "exec", lenientGlobals: true });
    const b = tryRunEval(src, file, { mode: "exec", lenientGlobals: false });
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // 非 lenient 调用点发现口径不得命中 lenient 条目（反之亦然）
    expect(b).not.toBe(a);
    // 同口径自命中：重算后写入的条目对同参调用生效
    const b2 = tryRunEval(src, file, { mode: "exec", lenientGlobals: false });
    expect(b2).toBe(b);
  });

  it("different maxLoopIters must not cross-hit (budget changes the result)", () => {
    // 1500 次具体循环：具体条件循环不再按 maxIters 截断（假精确修复），
    // 默认预算在硬上限 MAX_CONCRETE_LOOP_ITERS=1024 截断得 1024（conf 降级）；
    // 显式更大预算（2000 > 硬上限，调用方为准）得精确 1500。
    const src = `let s = 0;
for (let i = 0; i < 1500; i++) { s = s + 1; }
export function f() { return s; }
`;
    const file = "/test/dim-iters.js";
    const big = tryRunEval(src, file, { mode: "exec", maxLoopIters: 2000 });
    expect(big).toBeDefined();
    expect(litValue(callTranspiledExport(big!.exports, "f", []))).toEqual({
      ok: true,
      value: 1500,
    });
    // 默认预算：必须重算（硬上限截断得 1024），而非命中预算 2000 的条目（陈旧 1500）
    const def = tryRunEval(src, file, { mode: "exec" });
    expect(def).toBeDefined();
    expect(def).not.toBe(big);
    expect(litValue(callTranspiledExport(def!.exports, "f", []))).toEqual({
      ok: true,
      value: 1024,
    });
  });
});

describe("evalRunCache mode slots: analyze / exec 互不逐出", () => {
  it("analyze and exec coexist per path; evict clears both slots", () => {
    const src = `export function f() { return 1; }\n`;
    const file = "/test/mode-slot.js";
    const a = tryRunEval(src, file); // analyze（默认）
    const e = tryRunEval(src, file, { mode: "exec" });
    expect(a).toBeDefined();
    expect(e).toBeDefined();
    expect(e).not.toBe(a);
    expect(getEvalCacheSize()).toBe(2);
    // exec 采集（collectCallRecords 口径）不得踢掉 analyze 条目
    expect(tryRunEval(src, file)).toBe(a);
    expect(tryRunEval(src, file, { mode: "exec" })).toBe(e);
    // 依赖逐出：两种 mode 槽一并清
    expect(evictEvalCacheForFiles([file])).toBe(2);
    expect(getEvalCacheSize()).toBe(0);
  });
});

describe("tryRunEval/tryEvalCall loadModule passthrough", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
    clearEvalCache();
    clearAbsModuleCache();
  });

  it("in-memory loader content drives evaluation; depKey separates it from disk content", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-loader-pass-"));
    dirs.push(dir);
    writeFileSync(join(dir, "dep.js"), `export const v = 100;\n`);
    const src = `import { v } from "./dep.js";\nexport function f() { return v + 1; }\n`;
    const file = join(dir, "main.js");
    writeFileSync(file, src);

    // 虚拟 loader（如 LSP 未保存 buffer）：同路径返回不同内容
    const buffer = (v: number) => (spec: string) =>
      spec === "./dep.js" ? `export const v = ${v};\n` : undefined;

    const runA = tryRunEval(src, file, { loadModule: buffer(41) });
    expect(runA).toBeDefined();
    expect(litValue(callTranspiledExport(runA!.exports, "f", []))).toEqual({
      ok: true,
      value: 42,
    });
    // 同 loader 同内容：缓存命中（同一结果对象）
    const runA2 = tryRunEval(src, file, { loadModule: buffer(41) });
    expect(runA2).toBe(runA);

    // tryEvalCall 透传 loader：求值走 loader 内容而非磁盘
    const r1 = tryEvalCall(src, file, "f", [], { loadModule: buffer(41) });
    expect(litValue(r1!)).toEqual({ ok: true, value: 42 });

    // 无 loader → depKey 变化（磁盘内容）→ 不得命中 loader 条目
    clearAbsModuleCache();
    const runB = tryRunEval(src, file);
    expect(runB).toBeDefined();
    expect(runB).not.toBe(runA);
    expect(litValue(callTranspiledExport(runB!.exports, "f", []))).toEqual({
      ok: true,
      value: 101,
    });
  });
});
