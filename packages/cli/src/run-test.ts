/**
 * nudo test — @nudo:case 即测试。
 *
 * directive case 带 `=> expected` 时，用 leqAbs 校验推断结果；
 * 失败记 FAIL，进程退出码 1。无期望的 directive case 记 unchecked。
 */

import { leqAbs, formatShape, type Abs } from "@nudojs/core";
import type { AnalysisResult } from "@nudojs/service";

export type CaseTestOutcome = {
  fn: string;
  caseName: string;
  ok: boolean;
  unchecked: boolean;
  expected?: string;
  actual: string;
};

export type TestReport = {
  file: string;
  passed: number;
  failed: number;
  unchecked: number;
  outcomes: CaseTestOutcome[];
};

export function buildTestReport(file: string, result: AnalysisResult): TestReport {
  const outcomes: CaseTestOutcome[] = [];
  for (const fn of result.functions) {
    for (const c of fn.cases) {
      if (c.source !== "directive") continue;
      const actual = formatShape(c.abs);
      if (!c.expected) {
        outcomes.push({
          fn: fn.name,
          caseName: c.name,
          ok: true,
          unchecked: true,
          actual,
        });
        continue;
      }
      const expected = formatShape(c.expected as Abs);
      let ok = false;
      try {
        ok = leqAbs(c.abs, c.expected as Abs).ok;
      } catch {
        ok = false;
      }
      outcomes.push({
        fn: fn.name,
        caseName: c.name,
        ok,
        unchecked: false,
        expected,
        actual,
      });
    }
  }
  return {
    file,
    passed: outcomes.filter((o) => o.ok && !o.unchecked).length,
    failed: outcomes.filter((o) => !o.ok).length,
    unchecked: outcomes.filter((o) => o.unchecked).length,
    outcomes,
  };
}

export function formatTestReport(r: TestReport): string {
  const lines: string[] = [];
  lines.push(`nudo test  ${r.file}`);
  if (r.passed + r.failed + r.unchecked === 0) {
    lines.push("No @nudo:case directives found.");
    return lines.join("\n");
  }
  lines.push(r.failed === 0 ? "PASS" : "FAILED");
  lines.push(`  ${r.passed} passed · ${r.failed} failed · ${r.unchecked} unchecked`);
  lines.push("");
  for (const o of r.outcomes) {
    if (o.unchecked) {
      lines.push(`  [unchecked] ${o.fn}  case "${o.caseName}" → ${o.actual}`);
    } else if (o.ok) {
      lines.push(`  [ok]   ${o.fn}  case "${o.caseName}" → ${o.actual}`);
    } else {
      lines.push(`  [FAIL] ${o.fn}  case "${o.caseName}"`);
      lines.push(`         expected: ${o.expected}`);
      lines.push(`         actual:   ${o.actual}`);
    }
  }
  return lines.join("\n");
}
