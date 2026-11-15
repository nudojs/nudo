/**
 * Bug 668 — `nudo migrate status` 静默忽略第一个之后的全部路径。
 *
 * 族 16（commit e5b3f388）已在**命令层**修好（`packages/nudojs/src/commands/
 * migrate.ts` 的 status 分支改为**全量审计**）⇒ 本文件是**回归钉**（防止
 * 回退到「只报 targets[0]」），不是重复修复。
 *
 * 反向闸（断言非永真）：把命令层换回**族 16 之前**的版本（`git show
 * e5b3f388^:packages/nudojs/src/commands/migrate.ts`）⇒ 「两个包都被审计」
 * 断言**必红**（旧实现只报 pkg-a）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { runCliTsx, repoRoot } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkgDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-668-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", scripts: { typecheck: "tsc --noEmit" } }),
    "utf-8",
  );
  return dir;
}

describe("Bug 668 — migrate status 审计全部路径（回归钉）", () => {
  it("migrate status <a> <b> ⇒ 两个包都被审计（不得只报第一个）", () => {
    const a = pkgDir("status-a");
    const b = pkgDir("status-b");
    const r = runCliTsx(["migrate", "status", a, b]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(a);
    expect(r.stdout).toContain(b);
  });

  it("migrate status --json <a> <b> ⇒ 顶层数组含两个 root", () => {
    const a = pkgDir("status-json-a");
    const b = pkgDir("status-json-b");
    const r = runCliTsx(["migrate", "status", "--json", a, b]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ root: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    // migrate status 的 root 是**相对 cwd** 的路径（CLI 的 cwd = repoRoot）
    expect(parsed.map((row) => row.root)).toEqual([relative(repoRoot, a), relative(repoRoot, b)]);
  });

  it("单路径时行为不变（不得因多路径支持而破坏单路径）", () => {
    const a = pkgDir("status-single");
    const r = runCliTsx(["migrate", "status", a]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(a);
  });
});
