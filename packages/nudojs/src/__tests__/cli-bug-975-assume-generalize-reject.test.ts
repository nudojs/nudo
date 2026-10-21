/**
 * Bug 975：`--abs --generalize` 与 `--assume` 组合被**接受并打印 assume 回显**，
 * 但 generalize 分支**根本不吃 assume**（`generalizeFromAst` 没有 Φ 入口）
 * ⇒ 静默说谎：用户以为假设参与了符号推导。
 *
 * 修复：这个组合**显式拒绝**（用法错误 + 非零 exit），不回显假设。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";
import { runAbsViewCaptured } from "./helpers/abs-view.ts";

const G_SRC = `export function g(x, y) {\n  return x + y;\n}\n`;

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-c4-975-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Bug 975: --assume 与 --generalize 互斥 ⇒ 显式拒绝", () => {
  it("组合 → 用法错误 + exit 1（且不回显 assume）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, G_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { generalize: true, assume: ["x>100"] });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("--assume cannot be combined with --generalize");
      expect(r.stderr).toContain("fix:");
      // 旧行为：打印 assume 回显（说谎），然后 generalize 照跑
      expect(r.stdout).not.toContain("assume:");
    });
  });

  it("单独 --generalize 仍然可用（不误伤）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, G_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { generalize: true });
      expect(r.stderr).not.toContain("cannot be combined");
      expect(r.stdout).toContain("mode: generalize");
    });
  });

  it("单独 --assume 仍然可用（不误伤）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, G_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x>100"] });
      expect(r.stderr).not.toContain("cannot be combined");
      expect(r.stdout).toContain("assume: x > 100");
    });
  });

  it("CLI 级：组合 → 进程 exit 1", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, G_SRC, "utf-8");
      const r = runCli(["check", file, "--abs", "--generalize", "--assume", "x>100"], {
        cwd: dir,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("--assume cannot be combined with --generalize");
    });
  }, 30000);
});
