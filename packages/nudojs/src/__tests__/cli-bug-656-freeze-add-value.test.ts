/**
 * Bug 656：`nudo test --freeze=add` 被**拒绝**（exit 1 + 「Invalid --freeze
 * value: add」），而 `nudo test --help` **明写** `--freeze [mode]` 的合法
 * 取值是「**update | add**」⇒ 用户照 `--help` 写就命令失败。
 *
 * 修复（与 Bug 654 同根因、同片一次修完）：解析器接受 `--freeze=add`
 * ⇒ 显式 `=add` 与省略取值（默认 add）**同义**。
 *
 * 本钉只钉**实现侧**：`=add` 可用 + 与省略值同义 + 非法取值仍被拒。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

const SRC = `export function add(a, b) {
  return a + b;
}
const x = add(1, 2);
`;

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-656-"));
  const file = join(cwd, "lib.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd, file };
}

describe("Bug 656 — --freeze=add 被接受（与省略取值同义）", () => {
  it("--freeze=add --dry-run：exit 0（旧行为：exit 1 + Invalid --freeze value）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--freeze=add", "--dry-run"], { cwd });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).not.toContain("Invalid --freeze value");
      // add 模式：把调用点见证固化成 @nudo:case 指令（dry run ⇒ 只打 diff）
      expect(r.stdout).toContain("freeze: would write cases");
      expect(r.stdout).toContain("@nudo:case");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("--freeze=add 与省略取值（默认 add）产出逐字一致", () => {
    const { cwd, file } = makeProject();
    try {
      const explicit = runCli(["test", file, "--freeze=add", "--dry-run"], { cwd });
      const implicit = runCli(["test", file, "--freeze", "--dry-run"], { cwd });
      expect(explicit.status).toBe(0);
      expect(implicit.status).toBe(0);
      expect(explicit.stdout).toBe(implicit.stdout);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("--freeze=update 仍是 update 模式（不回归）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--freeze=update", "--dry-run"], { cwd });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).not.toContain("Invalid --freeze value");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("非法取值仍被拒 + exit 1", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--freeze=bogus", "--dry-run"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Invalid --freeze value");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);
});
