/**
 * nudo test — 观察主报告面 + 声明断言（design-cli-semantics §1.1）。
 *
 * - 默认打印全部 case（含合成 call@/entry@）——这就是调用点观察
 * - 仅 `@nudo:case` 且带 `=> expected` 进入 pass/fail；失败才影响 exit
 * - `--freeze[=update]`：见证固化（原 infer --emit-cases），仍在 test 名下
 */

import { formatShape, leqAbs, type Abs } from "@nudojs/core";
import type { AnalysisResult, CaseResult } from "@nudojs/service";

export type CaseTestOutcome = {
  fn: string;
  caseName: string;
  ok: boolean;
  unchecked: boolean;
  expected?: string;
  actual: string;
  throws?: string;
  /** 合成 case（call@/entry@）— 不参与 exit */
  synthetic: boolean;
};

export type TestReport = {
  file: string;
  passed: number;
  failed: number;
  unchecked: number;
  outcomes: CaseTestOutcome[];
  /** 逐函数全量 case 展示（含合成） */
  caseLines: string[];
};

function caseLabel(c: CaseResult): string {
  if (c.name.startsWith("call@") || c.name.startsWith("entry@")) return c.name;
  return `debug "${c.name}"`;
}

function formatCaseLine(c: CaseResult): string {
  const argsStr = c.argAbs.map(formatShape).join(", ");
  let line = `  ${caseLabel(c)}  (${argsStr}) => ${formatShape(c.abs)}`;
  if (c.throwsAbs && c.throwsAbs.shape.k !== "never") {
    line += `   throws ${formatShape(c.throwsAbs)}`;
  }
  return line;
}

export function buildTestReport(file: string, result: AnalysisResult): TestReport {
  const outcomes: CaseTestOutcome[] = [];
  const caseLines: string[] = [];

  const emitFnCases = (fnName: string, cases: CaseResult[], skipped?: boolean): void => {
    caseLines.push(`=== ${fnName} ===`);
    if (skipped) {
      caseLines.push("  skipped (declared)");
      caseLines.push("");
      return;
    }
    if (cases.length === 0) {
      caseLines.push("  (no cases)");
      caseLines.push("");
      return;
    }
    for (const c of cases) {
      caseLines.push(formatCaseLine(c));
      const synthetic = c.name.startsWith("call@") || c.name.startsWith("entry@");
      const throwsStr =
        c.throwsAbs && c.throwsAbs.shape.k !== "never" ? formatShape(c.throwsAbs) : undefined;
      if (c.source !== "directive" || synthetic) {
        outcomes.push({
          fn: fnName,
          caseName: c.name,
          ok: true,
          unchecked: true,
          actual: formatShape(c.abs),
          ...(throwsStr ? { throws: throwsStr } : {}),
          synthetic: true,
        });
        continue;
      }
      const actual = formatShape(c.abs);
      if (!c.expected) {
        outcomes.push({
          fn: fnName,
          caseName: c.name,
          ok: true,
          unchecked: true,
          actual,
          ...(throwsStr ? { throws: throwsStr } : {}),
          synthetic: false,
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
        fn: fnName,
        caseName: c.name,
        ok,
        unchecked: false,
        expected,
        actual,
        ...(throwsStr ? { throws: throwsStr } : {}),
        synthetic: false,
      });
    }
    caseLines.push("");
  };

  for (const fn of result.functions) {
    emitFnCases(fn.name, fn.cases, fn.skipped);
  }
  if (result.externalFunctions && result.externalFunctions.length > 0) {
    const byModule = new Map<string, typeof result.externalFunctions>();
    for (const fn of result.externalFunctions) {
      const mod = fn.fromModule ?? "";
      const list = byModule.get(mod) ?? [];
      list.push(fn);
      byModule.set(mod, list);
    }
    for (const [mod, fns] of byModule) {
      caseLines.push(`--- ${mod} (imported) ---`);
      for (const fn of fns) {
        emitFnCases(fn.name, fn.cases, fn.skipped);
      }
    }
  }

  const declared = outcomes.filter((o) => !o.synthetic);
  return {
    file,
    passed: declared.filter((o) => o.ok && !o.unchecked).length,
    failed: declared.filter((o) => !o.ok).length,
    unchecked: outcomes.filter((o) => o.unchecked).length,
    outcomes,
    caseLines,
  };
}

export function formatTestReport(r: TestReport): string {
  const lines: string[] = [];
  lines.push(`nudo test  ${r.file}`);
  lines.push("");
  if (r.caseLines.length > 0) {
    for (const ln of r.caseLines) lines.push(ln);
  } else {
    lines.push("No functions found to analyze.");
  }
  const declared = r.outcomes.filter((o) => !o.synthetic);
  lines.push("assertions");
  if (declared.length === 0) {
    lines.push(`  — 0 passed · 0 failed · ${r.unchecked} unchecked (no declared @nudo:case expectations)`);
  } else {
    const mark = r.failed === 0 ? "✓" : "✗";
    lines.push(`  ${mark} ${r.passed} passed · ${r.failed} failed · ${r.unchecked} unchecked`);
  }
  for (const o of declared) {
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
