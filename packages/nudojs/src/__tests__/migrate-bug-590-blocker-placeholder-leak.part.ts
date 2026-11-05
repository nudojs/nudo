/**
 * Bug 590 — `nudo migrate status` 的 `blockers` 串里**泄漏占位符「—」**：
 * blockers 用「—」表示「本项无」，汇总成逗号串时没过滤占位符 ⇒
 * 用户 / 脚本看到 `1 tsc line(s) in .github/workflows; —` 会以为有**两条**待办。
 *
 * 期望：占位符不得出现在 blockers 汇总里（无阻塞项 ⇒ 空）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStatus, formatStatusTable } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 本包无 TS、无依赖、无 tsc 脚本，但仓库 workflow 里还有 tsc 行 */
function pkgWithWorkflowTsc() {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-590-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "wf-pkg", version: "1.0.0", private: true }),
    "utf-8",
  );
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  writeFileSync(
    join(wf, "ci.yml"),
    "name: CI\njobs:\n  typecheck:\n    steps:\n      - run: npx tsc --noEmit\n",
    "utf-8",
  );
  return dir;
}

describe("Bug 590: migrate status 的 blockers 汇总不得泄漏占位符「—」", () => {
  it("blockers 数组里没有「—」元素", () => {
    const dir = pkgWithWorkflowTsc();
    const rows = migrateStatus(dir);
    expect(rows[0]!.blockers).not.toContain("—");
    for (const b of rows[0]!.blockers) expect(b.trim()).not.toBe("—");
  });

  it("文本面只有真 blocker，不带占位符", () => {
    const dir = pkgWithWorkflowTsc();
    const text = formatStatusTable(migrateStatus(dir));
    expect(text).toContain("blockers: 1 tsc line(s) in .github/workflows");
    expect(text).not.toContain("—");
  });

  it("反向闸：真有 blocker 时占位符也不得混入（防御性过滤）", () => {
    const text = formatStatusTable([
      {
        root: "x",
        packageJson: true,
        typescriptDep: false,
        tsconfig: false,
        tscScripts: [],
        tsFiles: 0,
        tsxFiles: 0,
        nudoScripts: [],
        nudoConfig: false,
        retired: false,
        retiring: false,
        blockers: ["1 tsc line(s) in .github/workflows", "—"],
      },
    ]);
    expect(text).toContain("blockers: 1 tsc line(s) in .github/workflows");
    expect(text).not.toContain("—");
  });

  it("反向闸：只有占位符 ⇒ 文本面不出现 blockers 行", () => {
    const text = formatStatusTable([
      {
        root: "x",
        packageJson: true,
        typescriptDep: false,
        tsconfig: false,
        tscScripts: [],
        tsFiles: 0,
        tsxFiles: 0,
        nudoScripts: [],
        nudoConfig: false,
        retired: false,
        retiring: false,
        blockers: ["—"],
      },
    ]);
    expect(text).not.toContain("blockers:");
  });
});
