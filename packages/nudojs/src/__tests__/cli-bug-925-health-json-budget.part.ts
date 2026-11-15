/**
 * Bug 925：`nudo health --json` 的机器面**整条丢掉 budget 截断快照**。
 *
 * `HealthReport` 类型声明了 `budget?: AbsBudgetStats`（注释明写与
 * `nudo check --json` 的 budget **同源同义**），分析后也填了、文本分支
 * 也打了「⚠ budget truncated」——但 JSON 分支是**逐字段手写列举**的，
 * `budget` 不在清单里 ⇒ 机器消费者读到 `ok: true` 的「干净」健康报告，
 * 而实际结果已被**宽化**（同一轮两个面结论相反）。
 *
 * 钉：两个面同时断言——文本面报截断 + JSON 面**有**对应字段
 * （files[].budget 同源同义 + summary.budgetTruncated 聚合）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;

/** 深自递归：实参逐层变形 ⇒ eval depth 截断（64/64） */
const DEEP = `export function down(n) {
  if (n <= 0) {
    return 0;
  }
  return down(n - 1);
}
`;

/** 普通导出函数：不触发任何预算 */
const PLAIN = `export function add(a, b) {
  return a + b;
}
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-925-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 925: health --json 序列化 budget 截断快照", () => {
  it("截断文件：JSON 面带 budget.truncated=true + summary.budgetTruncated；文本面报截断", { timeout: 30_000 }, () => {
    const deep = join(dir, "deep.js");
    writeFileSync(deep, DEEP);

    const json = runCliTsx(["health", deep, "--json"]);
    const parsed = JSON.parse(json.stdout) as {
      ok: boolean;
      files: Array<{ file: string; budget?: { truncated: boolean; reasons: string[] } }>;
      summary: { budgetTruncated?: boolean };
    };
    expect(parsed.files[0]!.budget, `no budget in JSON face:\n${json.stdout}`).toBeDefined();
    expect(parsed.files[0]!.budget!.truncated).toBe(true);
    expect(parsed.summary.budgetTruncated).toBe(true);

    // 文本面：同一轮明确报「budget truncated」（两个面同源）
    const text = runCliTsx(["health", deep]);
    expect(text.stdout).toContain("budget truncated");

    // 与 `nudo check --json` 的同一份 core budget 快照同源同义
    const check = runCliTsx(["check", deep, "--json"]);
    const cj = JSON.parse(check.stdout) as { budget?: { truncated: boolean } };
    expect(cj.budget!.truncated).toBe(parsed.files[0]!.budget!.truncated);
  });

  it("未截断文件：budget 也在（truncated=false），summary 不报 budgetTruncated", { timeout: 30_000 }, () => {
    const plain = join(dir, "plain.js");
    writeFileSync(plain, PLAIN);
    const json = runCliTsx(["health", plain, "--json"]);
    const parsed = JSON.parse(json.stdout) as {
      files: Array<{ budget?: { truncated: boolean } }>;
      summary: { budgetTruncated?: boolean };
    };
    expect(parsed.files[0]!.budget).toBeDefined();
    expect(parsed.files[0]!.budget!.truncated).toBe(false);
    expect(parsed.summary.budgetTruncated).toBeUndefined();
    const text = runCliTsx(["health", plain]);
    expect(text.stdout).not.toContain("budget truncated");
  });
});
