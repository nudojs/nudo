/**
 * Bug 576 — `nudo migrate retire` **二次运行擦掉退役审计记录**
 * （`.nudo/migrate-retired.json` 的 `removedDeps` / `rewrittenScripts` /
 *  `rewrittenWorkflows` 被清空、`retiredAt` 被改写）。
 *
 * 期望：二次运行 **合并** 既有审计记录（并集 + 保留首次 `retiredAt`）。
 * 反向闸：首次运行必须真的记下审计内容（否则「不被清空」是永真）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function auditPkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m5-576-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "auditpkg",
      version: "1.0.0",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  return dir;
}

function marker(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8")) as Record<
    string,
    unknown
  >;
}

describe("Bug 576: 二次 retire 不得擦掉退役审计记录", () => {
  it("库面：二次运行的 marker 保留首次的 removedDeps / rewrittenScripts / retiredAt", () => {
    const dir = auditPkg();
    migrateRetire(dir, { workflows: false });
    const first = marker(dir);
    expect(first.removedDeps).toContain("devDependencies");
    expect((first.rewrittenScripts as unknown[]).length).toBeGreaterThan(0);
    const firstAt = String(first.retiredAt);

    migrateRetire(dir, { workflows: false });
    const second = marker(dir);
    expect(second.removedDeps).toContain("devDependencies");
    expect((second.rewrittenScripts as unknown[]).length).toBeGreaterThan(0);
    expect(second.retiredAt).toBe(firstAt);
  });

  it("CLI 面：跑两遍 ⇒ 审计记录仍在（removedDeps 不被清空）", () => {
    const dir = auditPkg();
    const r1 = runCliTsx(["migrate", "retire", dir, "--json"]);
    expect(r1.status).toBe(0);
    const r2 = runCliTsx(["migrate", "retire", dir, "--json"]);
    expect(r2.status).toBe(0);
    const m = marker(dir);
    expect(m.removedDeps).toContain("devDependencies");
    expect((m.rewrittenScripts as unknown[]).length).toBeGreaterThan(0);
    expect(typeof m.retiredAt).toBe("string");
  });

  it("反向闸：首次运行确实写下了审计内容", () => {
    const dir = auditPkg();
    migrateRetire(dir, { workflows: false });
    const first = marker(dir);
    expect(first.removedDeps).toEqual(["devDependencies"]);
    expect(first.rewrittenScripts).toEqual([
      { name: "typecheck", from: "tsc --noEmit", to: "nudo check ." },
    ]);
  });
});
