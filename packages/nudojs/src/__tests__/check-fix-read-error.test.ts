/**
 * `nudo check --fix` 读文件失败不得静默跳过（旧实现 `catch { continue; }`
 * 把不可读目标吞掉 → 混排时静默绿）。修复：上屏 + 计入 residualErrors
 * → 末尾按 check 同契约 exit 1。进程内驱动 commander action。
 * root 下 chmod 000 仍可读，跳过（GitHub Actions runner / 开发机均非 root）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerCheckCommand } from "../commands/check.ts";

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

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

const BOOM_SRC = `export function boom() {
  throw new TypeError("x");
}
`;

describe.skipIf(isRoot)("check --fix 读文件失败不静默", () => {
  it("不可读目标：上屏 + exit 1（不得静默绿）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-fix-read-"));
    const locked = join(dir, "locked.js");
    const boom = join(dir, "boom.js");
    writeFileSync(locked, BOOM_SRC, "utf-8");
    writeFileSync(boom, BOOM_SRC, "utf-8");
    chmodSync(locked, 0o000);
    try {
      await runCheckCli(["check", "--fix", locked]);
      expect(errs.some((e) => e.includes("cannot read") && e.includes("locked.js"))).toBe(true);
      // 计入 residualErrors → 门禁红（不是静默跳过后的 exit 0）
      expect(process.exitCode).toBe(1);
      expect(logs.join("\n")).toContain("residual error(s) remain");

      // 混排：可读红文件 + 不可读文件 → 同样红且不可读文件上屏
      await runCheckCli(["check", "--fix", boom, locked]);
      expect(errs.some((e) => e.includes("cannot read") && e.includes("locked.js"))).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      // 目录可写：unlink 不受文件模式影响
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
