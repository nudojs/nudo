/**
 * BUG-117 —— `nudo migrate retire` 对**已退役的包**重跑 ⇒ **谎报**「本次摘掉了
 * 依赖 / 改写了脚本」（实际字节未变），且与同一包 `--all` 入口的结论互斥。
 *
 * 根因：`planRetirePackage` 的 `result` 直接取 marker 里的**累计**台账
 * （`payload.removedDeps` / `payload.rewrittenScripts`）⇒ 历史被当成本次事实。
 *
 * 修复：`result` 只装**本次 delta**（累计台账只留在 `.nudo/migrate-retired.json`），
 * 并给「早已退役、本次无操作」的包 `alreadyRetired: true`。
 *
 * 反向闸：首次退役的 delta **必须非空**（否则「二次为空」是永真）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire, migrateRetireAll } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tsPkg(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `nudo-mig-117-${name}-`));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      private: true,
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    }),
    "utf-8",
  );
  return dir;
}

describe("Bug 117: 已退役包的机器面不得把历史台账当成本次改动", () => {
  it("首次退役：delta 非空（断言非永真）", () => {
    const dir = tsPkg("first");
    const first = migrateRetire(dir, { workflows: false });
    expect(first.removedDeps).toContain("devDependencies");
    expect(first.rewrittenScripts.length).toBeGreaterThan(0);
    expect(first.alreadyRetired).toBeUndefined();
  });

  it("二次退役：delta 为空 + alreadyRetired: true + 文件逐字未变", () => {
    const dir = tsPkg("second");
    migrateRetire(dir, { workflows: false });
    const after = readFileSync(join(dir, "package.json"), "utf-8");
    const second = migrateRetire(dir, { workflows: false });
    expect(second.removedDeps).toEqual([]);
    expect(second.rewrittenScripts).toEqual([]);
    expect(second.rewrittenWorkflows).toEqual([]);
    expect(second.alreadyRetired).toBe(true);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(after);
  });

  it("累计台账仍在 marker 里（Bug 576 口径不变：审计不得被擦）", () => {
    const dir = tsPkg("audit");
    migrateRetire(dir, { workflows: false });
    const firstMarker = JSON.parse(
      readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8"),
    ) as { removedDeps: string[]; rewrittenScripts: unknown[] };
    migrateRetire(dir, { workflows: false });
    const secondMarker = JSON.parse(
      readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8"),
    ) as { removedDeps: string[]; rewrittenScripts: unknown[] };
    expect(secondMarker.removedDeps).toEqual(firstMarker.removedDeps);
    expect(secondMarker.rewrittenScripts).toEqual(firstMarker.rewrittenScripts);
  });

  it("--all 与显式目标对已退役的包给同一结论（都不谎称有动作）", () => {
    const dir = tsPkg("all");
    migrateRetire(dir, { workflows: false });
    // 显式：already retired（无 delta）
    const explicit = migrateRetire(dir, { workflows: false });
    expect(explicit.alreadyRetired).toBe(true);
    // --all：没有可退役项 ⇒ 空结果（不谎报「刚摘了 typescript」）
    expect(migrateRetireAll(dir, { workflows: false })).toEqual([]);
  });
});
