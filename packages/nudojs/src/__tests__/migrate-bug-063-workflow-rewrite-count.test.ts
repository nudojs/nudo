/**
 * BUG-063 —— `nudo migrate retire` 的 workflow 改写**少报**（去重键 `file+from+to`
 * 不含位置）⇒ 同一 workflow 里**两处**相同的 tsc 命令只记 1 条记录，
 * 而落盘改了 2 处、`migrate status` 数到 2 行 ⇒ 报告 / 审计 / 落盘三面不一致。
 *
 * 修复：改写记录带 `line`（该 `run:` 的行号），去重键 = 文件 + 位置 + 命令。
 *
 * 反向闸：只有一处改写时仍只记 1 条（不得把同一条命令重复计数）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire, migrateStatus } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 两条**文本相同**的 tsc 命令（单行标量 + 折叠标量） */
const CI_TWO = [
  "steps:",
  "  - name: A single line",
  "    run: npx tsc --noEmit",
  "  - name: B folded scalar",
  "    run: >-",
  "      npx tsc --noEmit",
  "",
].join("\n");

const CI_ONE = [
  "steps:",
  "  - name: A single line",
  "    run: npx tsc --noEmit",
  "",
].join("\n");

function pkgWith(ci: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-063-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "w063",
      version: "1.0.0",
      private: true,
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    }),
    "utf-8",
  );
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "ci.yml"), ci, "utf-8");
  return dir;
}

describe("Bug 063: workflow 改写记录条数必须等于实际改写的行数", () => {
  it("两处相同命令 ⇒ 报告 2 条（带位置）、落盘 2 处、status 数到 0（已改写）", () => {
    const dir = pkgWith(CI_TWO);
    // 改前 status 数到 2 行
    expect(
      migrateStatus(dir)[0]!.blockers.find((b) => b.includes("tsc line(s)")),
    ).toBe("2 tsc line(s) in .github/workflows");

    const result = migrateRetire(dir);
    expect(result.rewrittenWorkflows).toHaveLength(2);
    expect(result.rewrittenWorkflows.map((w) => w.line)).toEqual([3, 5]);
    // 落盘确实改了 2 处
    const ci = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    expect(ci.match(/nudojs check/g) ?? []).toHaveLength(2);
    // 审计标记与报告同条数
    const marker = JSON.parse(
      readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8"),
    ) as { rewrittenWorkflows: unknown[] };
    expect(marker.rewrittenWorkflows).toHaveLength(2);
  });

  it("反向闸：单处改写仍只记 1 条（不得因加位置而重复计数）", () => {
    const dir = pkgWith(CI_ONE);
    const result = migrateRetire(dir);
    expect(result.rewrittenWorkflows).toHaveLength(1);
    expect(result.rewrittenWorkflows[0]!.line).toBe(3);
  });
});
