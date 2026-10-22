/**
 * Bug 602 — `nudo export --format all` 到 stdout：zod 段与 standard 段的
 * `<fn>Output` **同名** ⇒ 同一模块作用域里 TS2451 ⇒ 产物不可用。
 *
 * 机制：stdout 把四个方言**平铺**进同一模块作用域，导出名无前缀 / 无去重 ⇒
 * zod 段（`<fn>Output`）与 standard 段（`<fn>Output`）必然撞名。
 *
 * 修法（stdout 面，S5）：跨段顶层标识符去重——先到先得，后段改名
 * （`<fn>Output` → `<fn>OutputStandard`）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 夹具：一个导出函数（zod 段 + standard 段各有 `<fn>Output` ⇒ 单函数即触发）。 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-602-"));
  dirs.push(dir);
  const file = join(dir, "one.js");
  writeFileSync(file, "export function foo() { return 1; }\n", "utf-8");
  return file;
}

/** 顶层声明出现次数（行首锚定）。 */
function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/**
 * stdout 流里的**重复顶层声明**（导出名 + 非导出声明）。
 *
 * 一个 TS 模块作用域里同名声明只能出现一次 ⇒ 重复即产物不可用。
 */
function duplicateTopLevelNames(text: string): string[] {
  const decl =
    /^(?:export\s+(?:declare\s+)?)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const line of text.split("\n")) {
    const m = decl.exec(line);
    if (m === null) continue;
    const name = m[1]!;
    if (seen.has(name)) dup.add(name);
    seen.add(name);
  }
  return [...dup];
}

describe("Bug 602 — export --format all 到 stdout：`<fn>Output` 不跨段撞名", () => {
  it("stdout 里 `fooOutput` 只声明一次（standard 段改名）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "all"]);
    expect(r.status).toBe(0);
    // zod 段保留产品名；standard 段改名（不再是同名第二份）
    expect(count(r.stdout, /^export const fooOutput\b/gm)).toBe(1);
    expect(r.stdout).toContain("export const fooOutputStandard");
    expect(r.stdout).toContain('import { z } from "zod"');
  }, 30000);

  it("stdout 流里没有重复的顶层声明（产物可编译）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "all"]);
    expect(r.status).toBe(0);
    expect(duplicateTopLevelNames(r.stdout)).toEqual([]);
  }, 30000);

  it("--out 落盘不变（各方言各占一个文件 ⇒ 产品名不漂移）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-602-out-"));
    dirs.push(dir);
    const file = join(dir, "one.js");
    writeFileSync(file, "export function foo() { return 1; }\n", "utf-8");
    const out = join(dir, "out");
    const r = runCli(["export", file, "--format", "all", "--out", out]);
    expect(r.status).toBe(0);
    // 产物文件名由 S4 决定 ⇒ 按后缀找文件，只断言「导出名不漂移」
    const names = readdirSync(out);
    const zodName = names.find((n) => n.includes(".nudo.schema."));
    const stdName = names.find((n) => n.endsWith(".nudo.standard.ts"));
    expect(zodName).toBeDefined();
    expect(stdName).toBeDefined();
    const zod = readFileSync(join(out, zodName!), "utf-8");
    expect(zod).toContain("export const fooOutput");
    expect(zod).not.toContain("fooOutputStandard");
    const std = readFileSync(join(out, stdName!), "utf-8");
    expect(std).toContain("export const fooOutput");
    expect(std).not.toContain("fooOutputStandard");
  }, 30000);
});
