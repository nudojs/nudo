/**
 * R2-5 A：loadModuleDepsFingerprint 全图 BFS 必须提出 per-fn 循环。
 * 同一 (source, filePath, loader) 的指纹对所有函数相同——逐函数重算即 N+1。
 * 断言：函数数翻倍时 loadModule 调用数不随 F 线性增长。
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFile } from "../analyzer.ts";
import { resetAllAnalysisCaches } from "../session-cache.ts";
import { defaultLoadModule } from "../load-module.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function countingLoader(counter: { n: number }) {
  return (spec: string, fromFile: string): string | undefined => {
    counter.n++;
    return defaultLoadModule(spec, fromFile);
  };
}

function makeEntry(dir: string, fnCount: number): { path: string; src: string } {
  const depPath = join(dir, "dep.js");
  writeFileSync(depPath, `export const k = 1;\n`, "utf-8");
  const fns = Array.from(
    { length: fnCount },
    (_, i) => `export function f${i}(x) {\n  return x + ${i};\n}\n`,
  ).join("\n");
  const src = `import { k } from "./dep.js";\n\n${fns}`;
  const path = join(dir, `entry-${fnCount}.js`);
  writeFileSync(path, src, "utf-8");
  return { path, src };
}

describe("loadModuleDepsFingerprint hoisted out of per-fn loop (R2-5 A)", () => {
  beforeEach(() => {
    resetAllAnalysisCaches();
  });

  it("函数数翻倍不线性放大 loadModule 调用", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-fp-hoist-"));
    dirs.push(dir);

    const one = makeEntry(dir, 1);
    const c1 = { n: 0 };
    analyzeFile(one.path, one.src, undefined, undefined, countingLoader(c1), "none");

    const extra = 11;
    const many = makeEntry(dir, 1 + extra);
    const c2 = { n: 0 };
    analyzeFile(many.path, many.src, undefined, undefined, countingLoader(c2), "none");

    // 每个新增函数只应多付 1 次（auto-bind 侧车探测）；指纹 BFS 与 F 无关。
    // 修复前 per-fn 各 walk 一次全图 ⇒ 每函数多约 3-4 次（dep + 侧车闭包）。
    const marginal = c2.n - c1.n;
    expect(marginal).toBeLessThanOrEqual(extra + 2);
    // 且总量远低于线性放大（12 函数 × 全图 BFS）
    expect(c2.n).toBeLessThan(c1.n * 3);
  });
});
