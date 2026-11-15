/**
 * BUG-053 —— `nudo migrate retire --dry-run --json` 与**真跑**的 JSON 输出
 * **逐字相同** ⇒ 机器消费者无法区分「这是计划」与「已经执行了」。
 *
 * 修复：`RetireResult` 带 `dryRun: true`（只在 dry-run 时出现 ⇒ 真跑的输出
 * 形状与旧版一致）；人类面本来就是区分的（`dry-run` vs `retired`）。
 *
 * 反向闸：真跑的 JSON **不得**出现 `dryRun`（否则「计划/事实」又被抹平）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-053-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "p11a",
      version: "1.0.0",
      private: true,
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    }),
    "utf-8",
  );
  return dir;
}

describe("Bug 053: dry-run 与真跑的机器面必须可区分", () => {
  it("库面：dry-run 的 result 带 dryRun: true，且零写盘", () => {
    const dir = pkg();
    const before = readFileSync(join(dir, "package.json"), "utf-8");
    const result = migrateRetire(dir, { dryRun: true, workflows: false });
    expect(result.dryRun).toBe(true);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(false);
  });

  it("库面：真跑的 result **不带** dryRun（形状与旧版一致）", () => {
    const dir = pkg();
    const result = migrateRetire(dir, { workflows: false });
    expect(result.dryRun).toBeUndefined();
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
  });

  it("CLI 面：dry-run 与真跑的 --json 输出**不再逐字相同**", () => {
    const dir = pkg();
    const dry = runCliTsx(["migrate", "retire", "--dry-run", "--json", dir]);
    expect(dry.status, dry.stderr).toBe(0);
    const apply = runCliTsx(["migrate", "retire", "--json", dir]);
    expect(apply.status, apply.stderr).toBe(0);
    expect(dry.stdout).not.toBe(apply.stdout);
    const dryRows = JSON.parse(dry.stdout) as Array<{ dryRun?: boolean }>;
    const applyRows = JSON.parse(apply.stdout) as Array<{ dryRun?: boolean }>;
    expect(dryRows[0]!.dryRun).toBe(true);
    expect(applyRows[0]!.dryRun).toBeUndefined();
  });
});
