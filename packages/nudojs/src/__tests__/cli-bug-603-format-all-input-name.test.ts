/**
 * Bug 603 — 同一 stdout 产物里 zod 段的 `<fn>Input` 与另一段的 `<fn>Input`
 * **标识符冲突**（TS2300 / TS2451）⇒ 产物不可用。
 *
 * ⚠ 勘误（AGENT-CONTEXT §4）：报告说的「dts 段 `export declare function
 * <fn>Input`」**不存在**（dts 生成器全文件无 `Input` 字样）⇒ 真实撞名对是
 * **zod 段 vs standard 段**（两段各自自洽，合进同一作用域即冲突）。
 *
 * 修法（stdout 面，S5）：跨段顶层标识符去重——先到先得，后段改名
 * （`<fn>Input` → `<fn>InputStandard`）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 夹具：一个带形参的导出函数（zod 段 + standard 段各有 `<fn>Input`）。 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-603-"));
  dirs.push(dir);
  const file = join(dir, "one.js");
  writeFileSync(file, "export function foo(x) { return x; }\n", "utf-8");
  return file;
}

/** 顶层声明出现次数（行首锚定）。 */
function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

describe("Bug 603 — export --format all 到 stdout：`<fn>Input` 不跨段撞名", () => {
  it("stdout 里 `fooInput` 只声明一次（standard 段改名）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "all"]);
    expect(r.status).toBe(0);
    expect(count(r.stdout, /^export const fooInput\b/gm)).toBe(1);
    expect(r.stdout).toContain("export const fooInputStandard");
  }, 30000);

  it("dts 段不产 `<fn>Input`（报告的撞名对不存在 ⇒ 治的是 zod ↔ standard）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("fooInput");
    expect(r.stdout).toContain("export declare function foo");
  }, 30000);

  it("--format standard 单方言时导出名不漂移（无冲突 ⇒ 不改名）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export const fooInput");
    expect(r.stdout).not.toContain("fooInputStandard");
  }, 30000);
});
