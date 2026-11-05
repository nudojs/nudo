/**
 * BUG-102 —— `nudo migrate status` 把**仓库根**共享 workflow 的 tsc 行算作
 * **每个子包**的 blocker ⇒ 子包 `retire` 成功后 blocker 永不消失
 * （status 与 retire 结论矛盾）。
 *
 * 根因：status 用 `listWorkflowTscLines` → `findWorkflowDir`（**向上找 6 层**），
 * 而 `retire` 的作用域是**包自有**的 `.github/workflows`（不向上找）⇒
 * status 报的 blocker `retire` 修不掉。
 *
 * 修复：status 的 workflow blocker 用 `ownWorkflowDir`（与 retire 同口径）——
 * 仓库根共享 workflow 的 tsc 行只算**根包**的 blocker。
 *
 * 反向闸：包**自有**的 workflow 仍照常计入（不得把真 blocker 也吞掉）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { migrateStatus, migrateRetire } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CI = "name: CI\njobs:\n  build:\n    steps:\n      - run: npx tsc --noEmit\n";

function monorepo(): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-mig-102-"));
  dirs.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
    "utf-8",
  );
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), CI, "utf-8");
  const a = join(root, "packages", "a");
  mkdirSync(join(a, "src"), { recursive: true });
  writeFileSync(
    join(a, "package.json"),
    JSON.stringify({
      name: "a",
      private: true,
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    }),
    "utf-8",
  );
  writeFileSync(join(a, "src", "x.ts"), "export const x: number = 1;\n", "utf-8");
  return root;
}

function row(root: string, target: string) {
  const abs = relative(process.cwd(), join(root, "packages", "a"));
  return migrateStatus(target).find((r) => r.root === abs)!;
}

describe("Bug 102: status 的 workflow blocker 归属与 retire 的作用域同口径", () => {
  it("子包：不继承仓库根共享 workflow 的 tsc 行", () => {
    const root = monorepo();
    const sub = row(root, join(root, "packages", "a"));
    expect(sub.blockers.filter((b) => b.includes("tsc line(s)"))).toEqual([]);
    // 该包的**自有** blocker 照常报（反向闸：不是把 blocker 全吞了）
    expect(sub.blockers).toContain("tsc still in scripts");
    expect(sub.blockers).toContain("typescript still in dependencies");
  });

  it("根包：共享 workflow 的 tsc 行算在它头上（只算一次）", () => {
    const root = monorepo();
    const rows = migrateStatus(root);
    const rootRow = rows.find((r) => r.root === (relative(process.cwd(), root) || "."))!;
    expect(
      rootRow.blockers.filter((b) => b.includes("tsc line(s)")),
    ).toEqual(["1 tsc line(s) in .github/workflows"]);
  });

  it("子包 retire 成功后 blocker 清空（status 与 retire 不再矛盾）", () => {
    const root = monorepo();
    migrateRetire(join(root, "packages", "a"));
    const sub = migrateStatus(join(root, "packages", "a"))[0]!;
    expect(sub.retired).toBe(true);
    expect(sub.blockers).toEqual([]);
  });
});
