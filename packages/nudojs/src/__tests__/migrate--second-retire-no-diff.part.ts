/**
 * BUG-179 —— `nudo migrate retire` **重复运行**时，人类面输出的 diff「`-` 侧」
 * 与文件**当前内容**不符（重放首次计划，不读当前状态）⇒ 报告说谎 + 人读面的
 * 幂等性被破。
 *
 * 根因：人类面直接打印 marker 的**累计台账**（合并后的 `rewrittenScripts` /
 * `rewrittenWorkflows`），并把它们挂在 `retired  <root>` 标题下 ⇒ 第二次运行
 * 打印 `- (none)` / `- npx tsc --noEmit`，而这两处**早已是** `nudo check .` /
 * `npx nudojs check .`。
 *
 * 修复（与 BUG-117 同一处根因）：`result` 只含**本次 delta**；人类面在
 * 「本次零改动」时打 `already retired` + `nothing to do` / `no changes`。
 *
 * 反向闸：首次运行**必须**打印 `- (none)`（否则「第二次不打印」是永真）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CI = "name: CI\njobs:\n  build:\n    steps:\n      - run: npx tsc --noEmit\n";

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-179-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "b179",
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

function scriptsOf(dir: string): Record<string, string> {
  return (JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
    scripts: Record<string, string>;
  }).scripts;
}

describe("Bug 179: 重复 retire 的人类面不得重放首次的 diff", () => {
  it("第一次：真的打印 `- (none)` / `- npx tsc --noEmit`（反向闸）", () => {
    const dir = project();
    const first = runCliTsx(["migrate", "retire", dir]);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("- (none)");
    expect(first.stdout).toContain("- npx tsc --noEmit");
    expect(first.stdout).toContain("+ nudo check .");
  });

  it("第二次：只报「已退役 / 无改动」，且 `-` 侧不再与文件现状矛盾", () => {
    const dir = project();
    runCliTsx(["migrate", "retire", dir]);
    const before = readFileSync(join(dir, "package.json"), "utf-8");
    const second = runCliTsx(["migrate", "retire", dir]);
    expect(second.status, second.stderr).toBe(0);

    // 文件逐字未变（本次什么都没做）
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
    // 报文必须承认「没改」，而不是重放首次的 `-` 侧
    expect(second.stdout).toContain("already retired");
    expect(second.stdout).toContain("nothing to do");
    expect(second.stdout).not.toContain("- (none)");
    expect(second.stdout).not.toContain("- npx tsc --noEmit");
    // 文件现状：门禁已装、CI 已是 nudojs（`-` 侧若打印就与这两条冲突）
    expect(scriptsOf(dir)["check:nudo"]).toBe("nudo check .");
    expect(readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8")).toContain(
      "nudojs check",
    );
  });

  it("机器面同步：第二次的 --json 是零 delta + alreadyRetired", () => {
    const dir = project();
    runCliTsx(["migrate", "retire", dir]);
    const second = runCliTsx(["migrate", "retire", dir, "--json"]);
    expect(second.status, second.stderr).toBe(0);
    const rows = JSON.parse(second.stdout) as Array<{
      alreadyRetired?: boolean;
      removedDeps: string[];
      rewrittenScripts: unknown[];
      rewrittenWorkflows: unknown[];
    }>;
    expect(rows[0]!.alreadyRetired).toBe(true);
    expect(rows[0]!.removedDeps).toEqual([]);
    expect(rows[0]!.rewrittenScripts).toEqual([]);
    expect(rows[0]!.rewrittenWorkflows).toEqual([]);
  });
});
