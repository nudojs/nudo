/**
 * BUG-178 —— `nudo migrate status` 与 `nudo migrate retire` 对**同一项目**给出
 * **相反结论**：`retired: true` 却仍报 2 个 blocker（正是 `retire` **有意保留**
 * 的两项：编译器角色的 tsc 脚本 + 它带出的 typescript 依赖）；且 `next:` 提示
 * **无条件**输出 ⇒ 已退役项目仍被建议「再退一次」。
 *
 * 修复：
 * - blocker 判定与 `retire` 的**保留**决策同源（gate / compiler 分类）——
 *   有意保留的项不算 blocker；
 * - 机器面新增 `preserved`（真 blocker 与有意保留**可区分**）；
 * - `formatStatusTable` 的 `next:` **按状态分支**。
 *
 * 反向闸：**门禁角色**的 tsc 脚本仍报 blocker（不得把真 blocker 也吞掉）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatStatusTable, migrateRetire, migrateStatus } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CI = "name: CI\njobs:\n  build:\n    steps:\n      - run: npx tsc --noEmit\n";

/** 编译器角色的 tsc 脚本（`--outDir` 会 emit）+ 它的 typescript 依赖 + CI 里的 tsc */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-178-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "b178",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: { build: "tsc --outDir dist" },
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "export const a: number = 1;\n", "utf-8");
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "ci.yml"), CI, "utf-8");
  return dir;
}

describe("Bug 178: status 与 retire 必须同结论（有意保留的项不算 blocker）", () => {
  it("retire 明确记录了「有意保留」的两项", () => {
    const dir = project();
    const result = migrateRetire(dir);
    expect(result.preservedScripts.map((p) => p.name)).toEqual(["build"]);
    const marker = JSON.parse(
      readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8"),
    ) as { keptDeps: string[] };
    expect(marker.keptDeps).toEqual(["devDependencies"]);
  });

  it("retire 之后 status 的 blockers 为空（不再与 retired: true 自相矛盾）", () => {
    const dir = project();
    migrateRetire(dir);
    const row = migrateStatus(dir)[0]!;
    expect(row.retired).toBe(true);
    expect(row.blockers).toEqual([]);
    // 有意保留**可区分**（机器面）
    expect(row.preserved?.scripts).toEqual(["build"]);
    expect(row.preserved?.deps).toEqual(["devDependencies"]);
  });

  it("已退役项目的 next: 提示不再指向 strip → verify → retire", () => {
    const dir = project();
    migrateRetire(dir);
    const text = formatStatusTable(migrateStatus(dir));
    expect(text).toContain("nothing to do");
    expect(text).not.toContain("strip <path>");
  });

  it("反向闸：门禁角色的 tsc 脚本仍报 blocker，next: 仍给流水线指引", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-mig-178-gate-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "b178g",
        version: "1.0.0",
        scripts: { typecheck: "tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    const row = migrateStatus(dir)[0]!;
    expect(row.blockers).toContain("tsc still in scripts");
    expect(row.blockers).toContain("typescript still in dependencies");
    expect(formatStatusTable([row])).toContain("strip <path>");
  });
});
