/**
 * Bug 1086：`nudo migrate strip --json` 的 `pathErrors[].path` **混用两种量纲**
 * （目标**目录** vs 失败**文件**），且同目标内**成功文件的逐文件结果被整条丢弃**。
 *
 * 症状（目标目录里混一个语法错文件：`a-good.ts` + `z-bad.ts`）：
 * 1. 库面（`packages/nudojs/src/migrate.ts`，族 56b）已按**逐文件隔离**改好 ——
 *    `migrateStrip` 返回「成功行 + 失败行」，失败行自带 `file`；但 CLI 命中
 *    `plan.find(r => r.code !== undefined)` 后直接 `continue` ⇒ 该目标**所有**
 *    成功行一并丢掉 ⇒ 机器消费者拿不到「哪些文件本来可以迁移」。
 * 2. 失败条目的 `path` 填的是**目标目录**而不是失败文件，而同一数组里
 *    TS-only 闸门失败填的是**文件**（`path: l.file`）⇒ `path` 量纲不一致；
 *    消费者要定位坏文件只能去解析 message 里的文件名字符串。
 *
 * 修复：失败条目的 `path` 改用库面失败行的 `file`（失败**文件**）；同目标内的
 * 成功行**照常透出**（写盘轮按库面已附的「未写盘」注记透出）⇒ 原子性不变
 * （有失败 ⇒ 零写盘），但「哪些文件本来可以迁移」这一事实不再丢。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD = `export function ok(a: number): number {\n  return a + 1;\n}\n`;
const BAD = `export function oops(a: number): number {\n  return a +;\n}\n`;

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1086-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

type StripEnvelope = {
  ok?: boolean;
  action?: string;
  results?: Array<{ file: string; outFile: string; notes?: string[] }>;
  pathErrors?: Array<{ path: string; code: string; message: string }>;
  error?: string;
};

describe("Bug 1086 — migrate strip --json 的逐文件隔离与 path 量纲", () => {
  it("混合目录 ⇒ results 保留成功文件的逐文件结果（不再整目标丢弃）", () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // BUG-017：`--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.action).toBe("strip");
    // 成功文件的行**仍在** results 里（旧行为：整目标丢弃 ⇒ results 为空）
    expect(parsed.results?.length ?? 0).toBe(1);
    expect(parsed.results?.[0]?.file).toBe("a-good.ts");
    expect(parsed.results?.[0]?.outFile).toBe("a-good.js");
  });

  it("失败条目的 path 是**失败文件**（不是目标目录）⇒ 与 TS-only 闸门同量纲", () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // BUG-017：`--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    const p = parsed.pathErrors![0]!.path;
    // 是**文件**（旧行为：目标目录 "."）
    expect(p).toBe("z-bad.ts");
    expect(p.endsWith(".ts")).toBe(true);
    expect(p).not.toBe(".");
    // 失败详情仍逐字沿用库面文案（带文件名）
    expect(parsed.pathErrors![0]!.message).toContain("z-bad.ts");
    expect(parsed.pathErrors![0]!.code).toBe("nudo:migrate-strip-failed");
    // stderr 仍带文件名（人类面不回归）
    expect(r.stderr).toContain("z-bad.ts");
  });

  it("pathErrors[] 内所有 path 量纲一致（都是文件，不是目录）", () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // BUG-017：`--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    const paths = (parsed.pathErrors ?? []).map((e) => e.path);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      // 文件级量纲（不是目录）⇒ 与 `results[].file` 同量纲
      expect(p.endsWith(".ts"), `path=${p}`).toBe(true);
      expect(p).not.toBe(".");
      expect(p).not.toBe(dir);
    }
  });

  it("--write：成功行带库面的「未写盘」注记，且原子性不变（一个字节都不落盘）", () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", "--write", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // BUG-017：`--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    // 成功行仍在 results 里，且带「未写盘」注记（不被误读成已写盘）
    expect(parsed.results?.length ?? 0).toBe(1);
    expect(parsed.results?.[0]?.file).toBe("a-good.ts");
    expect(parsed.results?.[0]?.notes?.join(" ")).toContain("not written");
    // 失败条目的 path 仍是**文件**
    expect(parsed.pathErrors?.[0]?.path).toBe("z-bad.ts");
    // 原子性：零写盘
    expect(existsSync(join(dir, "a-good.js"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".js"))).toHaveLength(0);
  });

  it("负控：全部成功 ⇒ stdout 仍是顶层数组（形状不变）", () => {
    const dir = dirWith({ "a-good.ts": GOOD });
    const r = runCliTsx(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].file).toBe("a-good.ts");
  });
});
