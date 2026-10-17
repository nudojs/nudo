/**
 * check 链路：JSDoc 块内错位的文件级指令族标签（@nudo:env / @nudo:mock-module）
 * 必须以 nudo:directive-syntax 警告上屏到 check issues（与畸形 @nudo:case 同链：
 * buildCheckInjection 的 runWithDirectiveDiags 域 → directiveDiagIssues）。
 * 进程内驱动 commander action（与 check-gitlab / check-injection-fail-gate 同型；
 * vitest alias 使 @nudojs/parser 解析到 src，无需 dist 重建）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerCheckCommand } from "../commands/check-command.ts";

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

const DEP2_SRC = `/**
 * @nudo:env node
 */
import { join } from "node:path";

export function safeJoin(base, rel) {
  return join(base, rel);
}
`;

const DEP7_SRC = `/// @nudo:env node
import { join } from "node:path";

export function safeJoin(base, rel) {
  return join(base, rel);
}
`;

describe("check 上屏 JSDoc 块内错位的文件级指令标签", () => {
  it("dep2 形态（JSDoc 块 @nudo:env）→ issues 含该警告", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-check-envwarn-"));
    const file = join(dir, "dep2.js");
    writeFileSync(file, DEP2_SRC, "utf-8");
    try {
      await runCheckCli(["check", file]);
      const out = logs.join("\n");
      expect(out).toContain("nudo:directive-syntax");
      expect(out).toContain(
        "@nudo:env is a file-level directive — use '/// @nudo:env node' at the top of the file (JSDoc block form is ignored)",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dep7 形态（/// @nudo:env node）→ 无该警告", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-check-envok-"));
    const file = join(dir, "dep7.js");
    writeFileSync(file, DEP7_SRC, "utf-8");
    try {
      await runCheckCli(["check", file]);
      const out = logs.join("\n");
      expect(out).not.toContain("file-level directive");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
