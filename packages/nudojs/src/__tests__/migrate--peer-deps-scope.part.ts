/**
 * Bug 572 — `peerDependencies.typescript` 不在 `status` 的作用域里：
 * status 的依赖集合只合并 `dependencies` + `devDependencies` ⇒
 * 只把 typescript 放在 peerDependencies 的包被报成「typescript dep: no」（假绿），
 * 且没有「typescript still in dependencies」阻塞（三个动词对同一事实三种答案）。
 *
 * 期望：依赖合并口径 = dependencies + devDependencies + peerDependencies + optionalDependencies。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as migrate from "../migrate.ts";

const { migrateStatus } = migrate;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkg(name: string, deps: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-572-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", ...deps }),
    "utf-8",
  );
  writeFileSync(
    join(dir, "src", "b.ts"),
    "export function mul(a: number, b: number): number { return a * b; }\n",
    "utf-8",
  );
  return dir;
}

describe("Bug 572: migrate status 的依赖口径必须含 peerDependencies", () => {
  it("peerDependencies.typescript ⇒ typescriptDep 为 true 且报出阻塞", () => {
    const dir = pkg("pkg-b", { peerDependencies: { typescript: "^5.0.0" } });
    const rows = migrateStatus(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.typescriptDep).toBe(true);
    expect(rows[0]!.blockers).toContain("typescript still in dependencies");
  });

  it("devDependencies / dependencies 口径不回退", () => {
    const dir = pkg("pkg-a", { devDependencies: { typescript: "^5.0.0" } });
    expect(migrateStatus(dir)[0]!.typescriptDep).toBe(true);
    const dir2 = pkg("pkg-a2", { dependencies: { typescript: "^5.0.0" } });
    expect(migrateStatus(dir2)[0]!.typescriptDep).toBe(true);
  });

  it("optionalDependencies.typescript 也算（四个来源同一口径）", () => {
    const dir = pkg("pkg-opt", { optionalDependencies: { typescript: "^5.0.0" } });
    expect(migrateStatus(dir)[0]!.typescriptDep).toBe(true);
  });

  it("反向闸：没有 typescript 依赖 ⇒ typescriptDep 为 false（判定不是恒真）", () => {
    const dir = pkg("pkg-none", { dependencies: { react: "^18.0.0" } });
    const rows = migrateStatus(dir);
    expect(rows[0]!.typescriptDep).toBe(false);
    expect(rows[0]!.blockers).not.toContain("typescript still in dependencies");
  });

  it("mergePackageDeps 合并四个依赖来源，且忽略非对象字段", () => {
    const merged = migrate.mergePackageDeps({
      dependencies: { a: "1" },
      devDependencies: { b: "2" },
      peerDependencies: { c: "3" },
      optionalDependencies: { d: "4" },
      scripts: { x: "y" },
    });
    expect(merged).toEqual({ a: "1", b: "2", c: "3", d: "4" });
  });
});
