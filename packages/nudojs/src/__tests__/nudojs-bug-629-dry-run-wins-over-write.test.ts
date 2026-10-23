/**
 * Bug 629：`nudo check --fix --write --dry-run` 仍**落盘**（--dry-run 被静默忽略）。
 *
 * 症状：--dry-run 与 --write 同时给出时 write 胜出 ⇒ 磁盘被改、侧车被写；
 * 用户以为在演练、实际改了仓库。修复：--dry-run 优先（与兄弟命令同款口径：
 * `nudo contract --draft --write --dry-run` / `nudo test --freeze --dry-run`
 * 都是「只打印、不落盘」）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliTsx } from "./helpers/run-cli.ts";

const SRC = `export function staticName(node) {
  return node.type;
}
`;

function makeProject(): { cwd: string; file: string; sidecar: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-629-"));
  const file = join(dir, "helper.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd: dir, file, sidecar: join(dir, "helper.nudo.js") };
}

describe("Bug 629 — --dry-run 与 --write 同时给出时以 dry-run 为准", () => {
  it("CLI：--fix --write --dry-run 只打印计划、**不落盘**", () => {
    const { cwd, file, sidecar } = makeProject();
    try {
      const r = runCliTsx(["check", file, "--fix", "--write", "--dry-run"], { cwd });
      const out = r.stdout + r.stderr;
      // 计划面：打印 diff + 「planned (dry-run)」
      expect(out).toContain("planned (dry-run)");
      expect(out).not.toContain("edit(s) written");
      // 磁盘面：侧车不生成、源文件不变
      expect(existsSync(sidecar)).toBe(false);
      expect(readFileSync(file, "utf-8")).toBe(SRC);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：--fix --write（不带 --dry-run）仍落盘（旧口径不回归）", () => {
    const { cwd, file, sidecar } = makeProject();
    try {
      const r = runCliTsx(["check", file, "--fix", "--write"], { cwd });
      const out = r.stdout + r.stderr;
      expect(out).toContain("edit(s) written");
      expect(existsSync(sidecar)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：--fix（不带 --write）只打印计划、不落盘（默认值不回归）", () => {
    const { cwd, file, sidecar } = makeProject();
    try {
      const r = runCliTsx(["check", file, "--fix"], { cwd });
      const out = r.stdout + r.stderr;
      expect(out).toContain("planned (dry-run)");
      expect(existsSync(sidecar)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
