/**
 * Bug 920 — `nudo migrate retire <子包>` 的 **workflow 改写作用域是「仓库根的整个
 * `.github/workflows` 目录」**，与被退役包的边界无关 ⇒ 未退役的根包 / 其它包的
 * CI 类型门禁被静默替换成 `npx nudojs check .`。
 *
 * 期望：退役子包时只改写**该包自有**的 `.github/workflows`；仓库根共享的 workflow
 *       属于整仓作用域，退役子包不得越界改写。
 * 反向闸：被退役包**自有**的 workflow 照常改写（断言非永真）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

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

/** monorepo：根包 + 子包 `packages/a`；根有共享 workflow，子包可选自带 workflow */
function monoRepo(subOwnWorkflow: boolean): { root: string; sub: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-m5-920-"));
  dirs.push(root);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), CI, "utf-8");
  mkdirSync(join(root, "packages", "a"), { recursive: true });
  if (subOwnWorkflow) {
    mkdirSync(join(root, "packages", "a", ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, "packages", "a", ".github", "workflows", "ci.yml"), CI, "utf-8");
  }
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5" },
    }),
    "utf-8",
  );
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
  writeFileSync(
    join(root, "packages", "a", "package.json"),
    JSON.stringify({
      name: "a",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5" },
    }),
    "utf-8",
  );
  return { root, sub: join(root, "packages", "a") };
}

describe("Bug 920: retire 子包的 workflow 改写作用域必须限定在该包", () => {
  it("库面：仓库根的共享 workflow 零改动，根包 package.json 零改动", () => {
    const { root, sub } = monoRepo(false);
    const rootWfBefore = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf-8");
    const rootPkgBefore = readFileSync(join(root, "package.json"), "utf-8");

    const result = migrateRetire(sub);

    expect(readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf-8")).toBe(rootWfBefore);
    expect(readFileSync(join(root, "package.json"), "utf-8")).toBe(rootPkgBefore);
    // 被退役包没有自己的 workflow ⇒ 本次没有任何 workflow 改写
    expect(result.rewrittenWorkflows).toEqual([]);
  });

  it("CLI 面：仓库根的共享 workflow 零改动，且不被报告", () => {
    const { root, sub } = monoRepo(false);
    const rootWfBefore = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf-8");
    const r = runCliTsx(["migrate", "retire", sub]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf-8")).toBe(rootWfBefore);
    expect(r.stdout).not.toContain("workflow ");
  });

  it("反向闸：被退役包**自有**的 workflow 照常改写", () => {
    const { root, sub } = monoRepo(true);
    migrateRetire(sub);
    const subWf = readFileSync(join(sub, ".github", "workflows", "ci.yml"), "utf-8");
    expect(subWf).toContain("npx nudojs check .");
    // 根的共享 workflow 仍然零改动
    expect(readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf-8")).toBe(CI);
  });
});
