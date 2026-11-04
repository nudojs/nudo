/**
 * 精度悬崖 UX（两个特性）的回归钉：
 *
 * 1. `nudo test` 报告含 `call@symbolic`（调用点超 callSiteBudget 被折出的
 *    符号化聚合见证）⇒ 报告尾追加一条 actionable 提示（SYMBOLIC_BUDGET_NOTE）：
 *    抬 `package.json#nudo.analysis.callSiteBudget`（1–64）或用 `@nudo:case`
 *    固化精确见证（limitations §3.2.2 同款口径）。句式与 check 面
 *    `nudo:recursion-truncated` 的建议（「事实 — 动作 A or 动作 B」）同构。
 *    不含 call@symbolic 的报告不得出现该提示（不制造噪音）。
 * 2. `nudo health` Summary（文本面与 --json 面 summary 同源）新增精度计数：
 *    unknown 签名数（返回位推断失败 ⇒ 签名渲染 `unknown`）与 #widened
 *    出现数（conf === "widened" 的见证条数）——观察指标，不挡门禁。
 *
 * 夹具与 docs/design/limitations.md §3.2.2 的实测口径一致：默认预算 3，
 * `add` 的第 4 个调用点起被折进 call@symbolic（实参 widen 成 number，
 * 聚合结果 conf 强制 #widened）；`JSON.parse` 的返回位推断不出 ⇒ unknown 签名。
 * 夹具目录写 SRC_TSCONFIG（run-cli.ts 惯例）⇒ 子进程 CLI 解析到仓内 src，
 * 不会测到陈旧 dist。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx, writeSrcTsconfig } from "./helpers/run-cli.ts";
import { SYMBOLIC_BUDGET_NOTE } from "@nudojs/service";

let dir: string;
const p = (f: string) => join(dir, f);

/**
 * 超预算夹具：4 个调用点 > 默认预算 3 ⇒ 第 4 个起折进 `call@symbolic`
 * （聚合 abs conf 强制 #widened——B4「超预算聚合必须 #widened」）；
 * `parseIt` 是 entry-only 且返回位推断失败（unknown）⇒ 1 条 unknown 签名。
 */
const OVER_BUDGET = `export function add(a, b) {
  return a + b;
}
console.log(add(1, 2));
console.log(add(10, 20));
console.log(add(100, 200));
console.log(add(1000, 2000));
export function parseIt(v) {
  return JSON.parse(v);
}
`;

/** 预算内夹具：1 个调用点 ⇒ 无 call@symbolic、无 unknown / #widened */
const WITHIN_BUDGET = `export function double(n) {
  return n + n;
}
console.log(double(21));
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-precision-hints-"));
  writeSrcTsconfig(dir);
  writeFileSync(p("over.js"), OVER_BUDGET);
  writeFileSync(p("within.js"), WITHIN_BUDGET);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. test 报告尾的 call@symbolic actionable 提示
// ---------------------------------------------------------------------------

describe("test: call@symbolic ⇒ 报告尾 actionable 提示", () => {
  it("含 call@symbolic 的报告：尾行 = SYMBOLIC_BUDGET_NOTE（两条恢复路径）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["test", p("over.js")]);
    expect(r.status, `stdout:\n${r.stdout}`).toBe(0);

    // 真实失真现场：第 4 个调用点起被折进符号化聚合见证
    expect(r.stdout).toContain("call@symbolic");

    // 报告尾追加提示（逐字 = 单源常量）：抬预算 or @nudo:case 固化
    expect(r.stdout).toContain(SYMBOLIC_BUDGET_NOTE);
    expect(SYMBOLIC_BUDGET_NOTE).toContain(
      "raise package.json#nudo.analysis.callSiteBudget (1–64)",
    );
    expect(SYMBOLIC_BUDGET_NOTE).toContain("pin exact witnesses with @nudo:case");

    // 位置：提示在 assertions 段之后（报告尾），不是 case 行中间
    const noteIdx = r.stdout.indexOf(SYMBOLIC_BUDGET_NOTE);
    const assertionsIdx = r.stdout.indexOf("assertions");
    expect(noteIdx).toBeGreaterThan(assertionsIdx);
  });

  it("不含 call@symbolic 的报告：无提示（不制造噪音）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["test", p("within.js")]);
    expect(r.status, `stdout:\n${r.stdout}`).toBe(0);
    expect(r.stdout).toContain("call@L4");
    expect(r.stdout).not.toContain("call@symbolic");
    expect(r.stdout).not.toContain(SYMBOLIC_BUDGET_NOTE);
  });

  it("formatTestReport 单元面：检测源 = outcomes 的见证名（合成见证同报）", async () => {
    const { analyzeFileAsync } = await import("@nudojs/service");
    const { buildTestReport, formatTestReport } = await import("../run-test.ts");
    const source = `
      export function sumTo(n) {
        if (n <= 0) return 0;
        return n + sumTo(n - 1);
      }
      console.log(sumTo(3));
    `;
    const result = await analyzeFileAsync(
      p("sum.js"),
      source,
      undefined,
      undefined,
      undefined,
      "all",
    );
    const text = formatTestReport(buildTestReport(p("sum.js"), result));
    expect(text).toContain("call@symbolic");
    expect(text.trimEnd().endsWith(SYMBOLIC_BUDGET_NOTE.trimEnd())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. health Summary 的精度计数（文本面 / --json 面 / 同源）
// ---------------------------------------------------------------------------

describe("health: Summary 精度计数（unknown 签名 + #widened 见证）", () => {
  it("文本面 Summary：1 unknown signature(s) · 1 #widened witness(es)", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("over.js")]);
    expect(r.status, `stdout:\n${r.stdout}`).toBe(0);
    // parseIt 返回位 unknown（JSON.parse）⇒ 1；add 的 call@symbolic 聚合
    // conf=#widened ⇒ 1
    expect(r.stdout).toMatch(
      /Summary: 1 file\(s\) · 0 case drift · 0 contract drift · 0 error\(s\) · \d+ uncovered function\(s\) · 1 unknown signature\(s\) · 1 #widened witness\(es\)\nResult: OK/,
    );
  });

  it("--json 面 summary：同源同数字（unknownSignatures / widenedWitnesses）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("over.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      summary: { unknownSignatures: number; widenedWitnesses: number };
    };
    expect(parsed.ok).toBe(true);
    // 三面一致：--json 的两个数 == 文本面 Summary 的两个数
    expect(parsed.summary.unknownSignatures).toBe(1);
    expect(parsed.summary.widenedWitnesses).toBe(1);
  });

  it("干净夹具：两面都是 0（键恒出现，不条件隐藏）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("within.js")]);
    expect(r.status, `stdout:\n${r.stdout}`).toBe(0);
    expect(r.stdout).toContain("· 0 unknown signature(s) · 0 #widened witness(es)");
    const j = runCliTsx(["health", "--json", p("within.js")]);
    const parsed = JSON.parse(j.stdout) as {
      summary: { unknownSignatures: number; widenedWitnesses: number };
    };
    expect(parsed.summary.unknownSignatures).toBe(0);
    expect(parsed.summary.widenedWitnesses).toBe(0);
  });

  it("skip 函数不计 unknown 签名（声明面不是引擎债）", { timeout: 60_000 }, () => {
    const skipped = `/**
 * @nudo:skip => number()
 */
export function declared(a) {
  return JSON.parse(a);
}
`;
    writeFileSync(p("skipped.js"), skipped);
    const j = runCliTsx(["health", "--json", p("skipped.js")]);
    const parsed = JSON.parse(j.stdout) as {
      summary: { unknownSignatures: number };
    };
    expect(parsed.summary.unknownSignatures).toBe(0);
  });
});
