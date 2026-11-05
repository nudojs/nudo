/**
 * BUG-052 —— `nudo migrate retire --all` 跳过 workspace **根**的 workflow tsc 行
 * ⇒ 退役不完整且 exit 0（子包退役了，根的 CI 仍跑 `tsc`）。
 *
 * 根因：`migrateRetireAll` 的工作集判据只看「可摘的依赖 + 门禁脚本」，
 * **不看**「仅 workflow 里有 tsc 行」⇒ 根包被 `continue` 跳过；而单目标路径
 * （`planRetirePackage`）**计入** workflow 行 ⇒ 同一份夹具两个入口不同结果。
 *
 * 修复：两条入口共用 `retireScope` 的「有活可干」判据。
 *
 * 反向闸：没有 tsc 面的包仍不写标记（断言非永真）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { migrateRetireAll, migrateStatus } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CI = [
  "name: CI",
  "on: [push]",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: npx tsc --noEmit",
  "",
].join("\n");

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-mig-052-"));
  dirs.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
    "utf-8",
  );
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), CI, "utf-8");
  mkdirSync(join(root, "packages", "a"), { recursive: true });
  writeFileSync(
    join(root, "packages", "a", "package.json"),
    JSON.stringify({
      name: "a",
      private: true,
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    }),
    "utf-8",
  );
  return root;
}

describe("Bug 052: retire --all 必须与单目标同口径（含 workflow-only 的根包）", () => {
  it("根包只有 workflow 里的 tsc 行 ⇒ --all 仍要改写它", () => {
    const root = workspace();
    const results = migrateRetireAll(root);
    // `result.root` 是相对 process.cwd() 的路径（与 JSON 面同形）
    const roots = results.map((r) => r.root);
    expect(roots).toContain(relative(process.cwd(), root) || ".");
    expect(roots).toContain(relative(process.cwd(), join(root, "packages", "a")));
    // 落盘核对：CI 里不再有 tsc
    const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf-8");
    expect(ci).not.toContain("tsc --noEmit");
    expect(ci).toContain("nudojs check");
  });

  it("退役后 status 不再报 workflow blocker（CI 与仓库一致）", () => {
    const root = workspace();
    migrateRetireAll(root);
    const rows = migrateStatus(root);
    for (const row of rows) {
      expect(row.blockers.filter((b) => b.includes("tsc line(s)"))).toEqual([]);
    }
  });

  it("反向闸：没有 tsc 面的包不被写标记（--all 不得凭空退役）", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-mig-052-plain-"));
    dirs.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
      "utf-8",
    );
    mkdirSync(join(root, "packages", "p"), { recursive: true });
    writeFileSync(
      join(root, "packages", "p", "package.json"),
      JSON.stringify({ name: "p", private: true, scripts: { test: "node -e 0" } }),
      "utf-8",
    );
    expect(migrateRetireAll(root)).toEqual([]);
    expect(existsSync(join(root, "packages", "p", ".nudo"))).toBe(false);
    expect(existsSync(join(root, ".nudo"))).toBe(false);
  });
});
