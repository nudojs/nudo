/**
 * evaluator 托管判定回归：函数/方法体内的 this. 不得关掉整文件的 求值引擎。
 * 回归背景：isEvalCapable 用正则 `(^|[^.\w$])this\s*\.` 扫全文件——
 * 任意函数内 this.x（transpile 会正确降级为 $lit(undefined) 或注入 thisParam）
 * 都静默把整个文件从 求值引擎降级到 ast-eval（精度整体下降且无诊断）。
 * 只有**顶层语句作用域**的 this（写入目标不可重绑）才应关闭 求值引擎。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEvalCapable, analyzeFile, clearEvalCache } from "@nudojs/service";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe("isEvalCapable: this. scoping", () => {
  it("plain function this. stays eval-hosted", () => {
    expect(isEvalCapable("function f() { return this.x; }")).toBe(true);
  });

  it("arrow body this. stays eval-hosted", () => {
    expect(isEvalCapable("const f = () => this.x;")).toBe(true);
  });

  it("object method this. stays eval-hosted", () => {
    expect(isEvalCapable("const o = { m() { return this.x; } };")).toBe(true);
  });

  it("class method this. stays eval-hosted (existing exemption)", () => {
    expect(isEvalCapable("class A { constructor() { this.x = 1; } }")).toBe(true);
    expect(isEvalCapable("class A { get x() { return this._x; } }")).toBe(true);
  });

  it("top-level this no longer disables evaluator (ESM semantics: this === undefined)", () => {
    // this 读 → undefined；this 写经 strict 写路径抛 TypeError（模块装载失败）
    expect(isEvalCapable("this.x = 1;")).toBe(true);
    expect(isEvalCapable("const y = this.x + 1;")).toBe(true);
  });
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
