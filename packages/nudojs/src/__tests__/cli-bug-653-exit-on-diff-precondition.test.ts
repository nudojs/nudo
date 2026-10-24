/**
 * Bug 653：`nudo test --exit-on-diff`（**无 `--freeze`**）被**静默忽略**、
 * exit 0 ⇒ CI 门禁形同虚设（用户以为「有 diff 就红」）。
 *
 * 根因：旗标校验被**嵌在 `if (opts.freeze !== undefined)` 块内** ⇒
 * `--exit-on-diff` 的前置条件（需 `--freeze` / `--dry-run`）只在有
 * `--freeze` 时才被检查；无 `--freeze` 时整段被跳过。
 *
 * 修复：前置校验**移到分支外** ⇒ 无 `--freeze` 时也报**用法错误**
 * （与 `nudo contract --exit-on-diff` 的口径对齐）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

const SRC = `export function one() {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-653-"));
  const file = join(cwd, "one.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd, file };
}

describe("Bug 653 — --exit-on-diff 的前置校验不得嵌在 --freeze 分支内", () => {
  it("无 --freeze：报用法错误 + exit 1（旧行为：静默忽略 + exit 0）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--exit-on-diff"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("--exit-on-diff");
      expect(r.stderr).toContain("--freeze");
      // 旧症状：旗标被吞掉 ⇒ 一句提示都没有
      expect(r.stderr.trim().length).toBeGreaterThan(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("有 --freeze 无 --dry-run：仍是既有的「requires --dry-run」用法错误", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--exit-on-diff", "--freeze"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("--exit-on-diff requires --dry-run");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("合法组合 --freeze --dry-run --exit-on-diff：照常跑（不误伤）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--exit-on-diff", "--freeze", "--dry-run"], { cwd });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("--exit-on-diff requires");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);
});
