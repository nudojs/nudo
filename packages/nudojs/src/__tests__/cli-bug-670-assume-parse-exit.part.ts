/**
 * Bug 670：`--assume` 的**坏值**（形如 `x=5`）只打一行 stderr 就被吞掉，
 * 命令照常跑完并 exit 0 ⇒ CI 里把「假设根本没生效」当成功。
 *
 * 旧行为：stderr 有 `Cannot parse --assume: x=5`，但 exit code = 0。
 * 修复：坏值 = **用法错误**（stderr + fix: 提示）+ 非零 exit，且不进入观察面。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";
import { runAbsViewCaptured } from "./helpers/abs-view.ts";

const ONE = `export function one(){ return 1; }\n`;

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-c4-670-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Bug 670: --assume 坏值 ⇒ 用法错误 + 非零 exit", () => {
  it("`x=5` 这类坏值 → exit 1（旧行为 exit 0）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x=5"] });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("Cannot parse --assume");
      expect(r.stderr).toContain("x=5");
      expect(r.stderr).toContain("fix:");
      // 旧行为：坏值被吞掉后继续跑观察面
      expect(r.stdout).not.toContain("nudo check --abs");
      expect(r.stdout).not.toContain("assume:");
    });
  });

  it("好值仍然生效（不误伤）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x>0"] });
      expect(r.exitCode).toBe(0);
      expect(r.stderr).not.toContain("Cannot parse --assume");
      expect(r.stdout).toContain("assume: x > 0");
    });
  });

  it("多个 --assume 里混一个坏值 → 仍然 exit 1（不得部分生效后假绿）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x>0", "y=5"] });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("Cannot parse --assume");
      expect(r.stdout).not.toContain("assume:");
    });
  });

  it("CLI 级：坏值 → 进程 exit 1", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = runCli(["check", file, "--abs", "--assume", "x=5"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Cannot parse --assume");
    });
  }, 30000);
});
