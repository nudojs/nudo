/**
 * G1（PR #80 第二轮审查）：注入装配失败（evalAbsModuleGraph /
 * mock-seed 组装 throw）必须挡 exit，且降级产物不得回写磁盘缓存。
 * 旧实现两处假绿：
 * ①单文件 --json 末段 `process.exitCode = checkJson.ok ? 0 : 1`
 *   无条件覆盖 catch 已置的 1——降级分析（无注入）往往零诊断
 *   （ok:true）→ exit 0；多文件信封 `envelope.ok ? 0 : 1` 同族。
 * ②降级分析仍写磁盘缓存 → 下次 check 命中缓存整体跳过注入装配
 *   → 静默转绿。
 *
 * 注入装配的 throw 无法从输入面稳定构造（各装载路径 fail-closed，
 * 走 issue / fromErrors 通道而非异常），故进程内 vi.mock 注入异常并
 * 直接驱动 commander action（不经 dist，与 subprocess 型 check 测试互补）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

vi.mock("@nudojs/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nudojs/service")>();
  return {
    ...actual,
    evalAbsModuleGraph: vi.fn((source: string, file: string) => {
      // 带 INJECTION_BOOM 标记的文件模拟「模块图装配 throw」
      if (source.includes("INJECTION_BOOM")) {
        throw new Error("injected graph boom");
      }
      return actual.evalAbsModuleGraph(source, file);
    }),
  };
});

import { registerCheckCommand } from "../commands/check.ts";

async function runCheckCli(args: string[]): Promise<void> {
  const program = new Command();
  registerCheckCommand(program);
  await program.parseAsync(["node", "nudo", ...args]);
}

let logs: string[] = [];
let errs: string[] = [];

beforeEach(() => {
  process.exitCode = undefined;
  logs = [];
  errs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errs.push(a.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

const BOOM_SRC = `// INJECTION_BOOM
export function id(x) { return x; }
`;
const CLEAN_SRC = `export function id(x) { return x; }
`;

describe("G1: 注入装配失败挡 exit（单文件 --json）", () => {
  it("降级分析 ok:true 仍 exit 1（不被 `ok ? 0 : 1` 覆盖）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-g1-json-"));
    const file = join(dir, "boom.js");
    writeFileSync(file, BOOM_SRC, "utf-8");
    await runCheckCli(["check", file, "--json"]);
    expect(errs.some((e) => e.includes("eval injection setup failed"))).toBe(true);
    // 降级分析零诊断：stdout 机器面仍是 CheckJson ok:true
    const json = JSON.parse(logs.join("\n"));
    expect(json.ok).toBe(true);
    // 但门禁必须红：失败态独立于 ok 挡 exit
    expect(process.exitCode).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("多文件信封：任一文件注入失败 → envelope.ok:true 仍 exit 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-g1-multi-"));
    const clean = join(dir, "clean.js");
    const boom = join(dir, "boom.js");
    writeFileSync(clean, CLEAN_SRC, "utf-8");
    writeFileSync(boom, BOOM_SRC, "utf-8");
    await runCheckCli(["check", clean, boom, "--json"]);
    expect(errs.some((e) => e.includes("eval injection setup failed"))).toBe(true);
    // 信封体本身 ok:true（分析面观察完整）——exit 由失败态挡红
    const envelope = JSON.parse(logs.join("\n"));
    expect(envelope.ok).toBe(true);
    expect(process.exitCode).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("非 --json 终端面：注入失败 exit 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-g1-term-"));
    const file = join(dir, "boom.js");
    writeFileSync(file, BOOM_SRC, "utf-8");
    await runCheckCli(["check", file]);
    expect(errs.some((e) => e.includes("eval injection setup failed"))).toBe(true);
    expect(process.exitCode).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("G1: 注入装配失败不回写磁盘缓存", () => {
  const prevCacheDir = process.env.NUDO_CACHE_DIR;

  afterEach(() => {
    if (prevCacheDir === undefined) delete process.env.NUDO_CACHE_DIR;
    else process.env.NUDO_CACHE_DIR = prevCacheDir;
  });

  it("失败运行无缓存条目；二次运行仍红（不静默转绿）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-g1-cache-"));
    const cacheRoot = join(dir, "nudo-cache");
    process.env.NUDO_CACHE_DIR = cacheRoot;
    const file = join(dir, "boom.js");
    writeFileSync(file, BOOM_SRC, "utf-8");

    await runCheckCli(["check", file, "--json"]);
    expect(process.exitCode).toBe(1);
    // ①降级产物不落缓存：check 命名空间无条目
    expect(existsSync(join(cacheRoot, "check"))).toBe(false);

    // ②二次运行：无缓存可命中 → 重新装配 → 仍失败仍红
    await runCheckCli(["check", file, "--json"]);
    expect(errs.filter((e) => e.includes("eval injection setup failed")).length).toBe(2);
    expect(process.exitCode).toBe(1);
    expect(existsSync(join(cacheRoot, "check"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("对照组：装配成功的正常运行仍写缓存（守卫不误伤）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-g1-cacheok-"));
    const cacheRoot = join(dir, "nudo-cache");
    process.env.NUDO_CACHE_DIR = cacheRoot;
    const file = join(dir, "clean.js");
    writeFileSync(file, CLEAN_SRC, "utf-8");
    await runCheckCli(["check", file, "--json"]);
    expect(process.exitCode).toBe(0);
    expect(existsSync(join(cacheRoot, "check"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
