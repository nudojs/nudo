/**
 * Bug 594 — `nudo migrate status --json` 的 `blockers` **数组元素**是占位符 `"—"`：
 * 机器面把「无 blocker」当成**一条 blocker**（文本面会过滤掉它）⇒
 * 消费方按 `blockers.length` 判「能否退役」永远 ≥ 1 ⇒ 自动化误判。
 *
 * 期望：JSON 面无 blocker ⇒ `blockers: []`；stdout 必须是合法 JSON。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStatus } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function cleanPkg() {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-594-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "mig-clean", version: "1.0.0", private: true }),
    "utf-8",
  );
  return dir;
}

describe("Bug 594: migrate status --json 的 blockers 无 blocker 时必须是 []", () => {
  it("JSON 面 blockers 为空数组（不是 ['—']）", () => {
    const dir = cleanPkg();
    const r = runCliTsx(["migrate", "status", "--json", dir]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ blockers: string[] }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.blockers).toEqual([]);
    expect(parsed[0]!.blockers).not.toContain("—");
  });

  it("API 面同样为空数组", () => {
    const dir = cleanPkg();
    const rows = migrateStatus(dir);
    expect(rows[0]!.blockers).toEqual([]);
  });

  it("反向闸：真有 blocker 时数组里是那条 blocker（判定不是恒空）", () => {
    const dir = cleanPkg();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "mig-dirty",
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    const r = runCliTsx(["migrate", "status", "--json", dir]);
    const parsed = JSON.parse(r.stdout) as Array<{ blockers: string[] }>;
    expect(parsed[0]!.blockers).toContain("typescript still in dependencies");
    expect(parsed[0]!.blockers).not.toContain("—");
  });
});
