/**
 * Bug 601 — `nudo export --format standard` 到 stdout 时产出**重复的 helper 声明**
 * （TS2393 / TS2300 ⇒ 产物不可用）。
 *
 * 机制（AGENT-CONTEXT §4 已裁决）：产物头**没有** helper；helper 是 service 侧
 * `absToStandardSchemaFunction` 的模块装配在**每个 per-function 模块**里内联的
 * 一份（`__nudoCheck` / `__nudoTypeOf` / `NudoSchemaNode` …）⇒ stdout 平铺 N 份
 * = N 次同名声明。
 *
 * 修法（stdout 面，S5）：standard 各块的**公共前导**（banner + helper）只发一次。
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

/** 夹具：两个导出函数（standard 面 ⇒ 两块 ⇒ 两份 helper）。 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-601-"));
  dirs.push(dir);
  const file = join(dir, "two.js");
  writeFileSync(
    file,
    "export function alpha(x) { return x + 1; }\nexport function beta(x) { return x + 2; }\n",
    "utf-8",
  );
  return file;
}

/** 顶层声明出现次数（行首锚定）。 */
function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

describe("Bug 601 — export --format standard 的 helper 只声明一次", () => {
  it("stdout 里 helper / 类型别名各只出现一次（两个函数 ⇒ 两块）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(count(r.stdout, /^function __nudoTypeOf/gm)).toBe(1);
    expect(count(r.stdout, /^function __nudoCheck/gm)).toBe(1);
    expect(count(r.stdout, /^function __nudoDescribe/gm)).toBe(1);
    expect(count(r.stdout, /^type NudoSchemaNode =/gm)).toBe(1);
    expect(count(r.stdout, /^const __nudoBrandCtors =/gm)).toBe(1);
  }, 30000);

  it("剥前导不丢内容：两个函数的导出体都在", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export const alpha_x");
    expect(r.stdout).toContain("export const beta_x");
    expect(r.stdout).toContain("export const alphaInput");
    expect(r.stdout).toContain("export const betaInput");
    expect(r.stdout).toContain("// === alpha Standard Schema ===");
    expect(r.stdout).toContain("// === beta Standard Schema ===");
  }, 30000);

  it("--out 落盘不变（每函数一份文件，各带一份 helper ⇒ 互不冲突）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-601-out-"));
    dirs.push(dir);
    const file = join(dir, "two.js");
    writeFileSync(
      file,
      "export function alpha(x) { return x + 1; }\nexport function beta(x) { return x + 2; }\n",
      "utf-8",
    );
    const out = join(dir, "out");
    const r = runCli(["export", file, "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);
    // 产物文件名由 S4 决定 ⇒ 只断言「每个 standard 产物自带一份 helper」
    const files = readdirSync(out).filter((f) => f.endsWith(".nudo.standard.ts"));
    expect(files.length).toBe(2);
    for (const name of files) {
      const body = readFileSync(join(out, name), "utf-8");
      expect(count(body, /^function __nudoCheck/gm)).toBe(1);
      expect(count(body, /^type NudoSchemaNode =/gm)).toBe(1);
    }
  }, 30000);
});
