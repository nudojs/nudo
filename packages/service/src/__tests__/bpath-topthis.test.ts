/**
 * B-path 托管判定回归：函数/方法体内的 this. 不得关掉整文件的 B 路径。
 * 回归背景：isBPathCapable 用正则 `(^|[^.\w$])this\s*\.` 扫全文件——
 * 任意函数内 this.x（transpile 会正确降级为 $lit(undefined) 或注入 thisParam）
 * 都静默把整个文件从 B 路径降级到 ast-eval（精度整体下降且无诊断）。
 * 只有**顶层语句作用域**的 this（写入目标不可重绑）才应关闭 B 路径。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBPathCapable, analyzeFile, clearBPathCache } from "@nudojs/service";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe("isBPathCapable: this. scoping", () => {
  it("plain function this. stays B-hosted", () => {
    expect(isBPathCapable("function f() { return this.x; }")).toBe(true);
  });

  it("arrow body this. stays B-hosted", () => {
    expect(isBPathCapable("const f = () => this.x;")).toBe(true);
  });

  it("object method this. stays B-hosted", () => {
    expect(isBPathCapable("const o = { m() { return this.x; } };")).toBe(true);
  });

  it("class method this. stays B-hosted (existing exemption)", () => {
    expect(isBPathCapable("class A { constructor() { this.x = 1; } }")).toBe(true);
    expect(isBPathCapable("class A { get x() { return this._x; } }")).toBe(true);
  });

  it("top-level this no longer disables B-path (ESM semantics: this === undefined)", () => {
    // this 读 → undefined；this 写经 strict 写路径抛 TypeError（模块装载失败）
    expect(isBPathCapable("this.x = 1;")).toBe(true);
    expect(isBPathCapable("const y = this.x + 1;")).toBe(true);
  });
});

describe("B-hosted files with function-internal this", () => {
  it("analyzes cleanly with cases present (no crash from this.tag)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-topthis-"));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }));
    const file = join(dir, "lib.js");
    const src = `function helper() { return this.tag; }
export function twice(n) { return n * 2; }
`;
    writeFileSync(file, src);
    clearBPathCache();
    const r = analyzeFile(file, src);
    expect(r.diagnostics).toHaveLength(0);
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
    clearBPathCache();
    const r = analyzeFile(file, src);
    expect(r.nodeAbsMap.size).toBeGreaterThan(0);
  });
});
