/**
 * health 的 budget 截断行与 check --json 对同一文件必须同源同义：
 * - 未截断文件：check budget.truncated=false ⇔ health 不打 truncated 行；
 * - 真截断文件：两者同 truncated=true，且 health 行内计数 = 触发截断的那条
 *   预算自己的计数（depth 截断打 depth/limit 对、必到顶；cycle 不是预算，
 *   不打任何计数段）——杜绝「71/20000 却标 truncated」的自相矛盾；
 * - 多文件运行不得串档：前一文件的截断旗标/计数不得 latch 进后一文件报告。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;
const p = (f: string) => join(dir, f);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-health-budget-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 三个普通导出函数：不触发任何预算 */
const PLAIN = `export function add(a, b) { return a + b; }
export function greet(name) { return "hello " + name; }
export function len(s) { return s.length; }
`;

/** 深自递归：实参逐层变形（n-1），cycle 键不重复 → depth 预算截断（64/64） */
const DEEP = `export function down(n) { if (n <= 0) { return 0; } return down(n - 1); }
`;

/** 同参自递归：同指纹重入 → cycle 截断（预算抬不动，没有可打的计数段） */
const CYCLE = `export function sameArgs(x) { sameArgs(x); return x; }
`;

function checkBudget(file: string) {
  const r = runCliTsx(["check", "--json", file]);
  const parsed = JSON.parse(r.stdout) as {
    budget?: {
      truncated: boolean;
      reasons: string[];
      callReasons: string[];
      evalReasons: string[];
      evalDepth: number;
      maxEvalDepth: number;
    };
  };
  expect(parsed.budget).toBeDefined();
  return parsed.budget!;
}

/** health 输出按文件切块（file 行 → 下一 file 行 / Summary） */
function healthSections(args: string[]): Map<string, string> {
  const r = runCliTsx(["health", ...args]);
  const sections = new Map<string, string>();
  const lines = r.stdout.split("\n");
  let cur: string | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    if (line.startsWith("Summary:") || line.startsWith("Result:")) {
      if (cur) sections.set(cur, buf.join("\n"));
      cur = null;
      buf = [];
      continue;
    }
    if (line && !line.startsWith(" ") && !line.startsWith("Summary") && !line.startsWith("Result")) {
      if (cur) sections.set(cur, buf.join("\n"));
      cur = line;
      buf = [];
      continue;
    }
    if (cur) buf.push(line);
  }
  return sections;
}

describe("health budget line agrees with check --json", () => {
  it("未截断文件：check truncated=false ⇔ health 无 truncated 行", { timeout: 30_000 }, () => {
    writeFileSync(p("plain.js"), PLAIN);
    const budget = checkBudget(p("plain.js"));
    expect(budget.truncated).toBe(false);
    const sec = healthSections([p("plain.js")]).get(p("plain.js")) ?? "";
    expect(sec).not.toContain("budget truncated");
  });

  it("深递归文件：两者同 truncated=true；health 打触发预算（eval depth）自己的计数且到顶", { timeout: 30_000 }, () => {
    writeFileSync(p("deep.js"), DEEP);
    const budget = checkBudget(p("deep.js"));
    expect(budget.truncated).toBe(true);
    expect(budget.evalReasons).toContain("depth");
    expect(budget.evalDepth).toBe(budget.maxEvalDepth);

    const sec = healthSections([p("deep.js")]).get(p("deep.js")) ?? "";
    expect(sec).toContain("budget truncated");
    // depth 截断 → 打 depth 对（到顶），不打未到顶的调用总数计数
    expect(sec).toMatch(/eval depth 64\/64/);
    expect(sec).not.toMatch(/eval calls \d+\/\d+/);
    expect(sec).not.toMatch(/· calls \d+\/\d+/);
  });

  it("cycle 截断：不是预算——不打任何计数段，只声明 call cycle", { timeout: 30_000 }, () => {
    writeFileSync(p("cycle.js"), CYCLE);
    const budget = checkBudget(p("cycle.js"));
    expect(budget.truncated).toBe(true);
    expect(budget.reasons).toContain("cycle");

    const sec = healthSections([p("cycle.js")]).get(p("cycle.js")) ?? "";
    expect(sec).toContain("budget truncated");
    expect(sec).toContain("call cycle — not a budget limit");
    expect(sec).not.toMatch(/\d+\/\d+/);
  });

  it("多文件运行不串档：截断文件的旗标不得 latch 进后续未截断文件", { timeout: 30_000 }, () => {
    writeFileSync(p("deep2.js"), DEEP);
    writeFileSync(p("plain2.js"), PLAIN);
    const sections = healthSections([p("deep2.js"), p("plain2.js")]);
    expect(sections.get(p("deep2.js"))).toContain("budget truncated");
    expect(sections.get(p("plain2.js")) ?? "").not.toContain("budget truncated");
  });
});
