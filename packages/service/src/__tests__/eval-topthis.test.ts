/**
 * evaluator 托管回归：函数/方法体内与顶层的 this. 都不降级整文件求值
 * （this 已按 ESM 语义托管——读 undefined / 写 TypeError；能力判定闸已删，
 * 未 lowering 的构造在转译点 fail-closed）。此处回归 analyzeFile 行为面。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFile, clearEvalCache } from "@nudojs/service";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe("eval-hosted files with function-internal this", () => {
  it("analyzes cleanly with cases present (no crash from this.tag)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-topthis-"));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }));
    const file = join(dir, "lib.js");
    const src = `function helper() { return this.tag; }
export function twice(n) { return n * 2; }
`;
    writeFileSync(file, src);
    clearEvalCache();
    const r = analyzeFile(file, src);
    // 允许 info 级 nudo:interface-entry-only（导出无根且无域）；不得有 error/warning
    expect(r.diagnostics.filter((d) => d.severity === "error" || d.severity === "warning")).toHaveLength(0);
    const fn = r.functions.find((f) => f.name === "twice");
    expect(fn).toBeDefined();
    expect(fn!.cases.length).toBeGreaterThan(0);
  });

  it("top-level this.x write fails module load (ESM TypeError) → Abs host fallback, analysis survives", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-topthis-fb-"));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }));
    const file = join(dir, "fb.js");
    const src = `this.x = 1;
export function id(x) { return x; }
`;
    writeFileSync(file, src);
    clearEvalCache();
    const r = analyzeFile(file, src);
    expect(r.nodeAbsMap.size).toBeGreaterThan(0);
  });
});
