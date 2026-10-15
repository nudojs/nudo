/**
 * nudo test — 观察主报告面 + 声明断言（design-cli-semantics §1.1）。
 *
 * - 默认打印全部 case（含合成 call@/entry@）——这就是调用点观察
 * - 仅 `@nudo:case` 且带 `=> expected` 进入 pass/fail；失败才影响 exit
 * - `--freeze[=update]`：见证固化，仍在 test 名下
 */

import { dirname } from "node:path";
import {
  effectiveInterface,
  formatShape,
  interfaceDiagCount,
  leqAbs,
  takeInterfaceDiagsSince,
  type Abs,
} from "@nudojs/core";
import {
  defaultLoadModule,
  findProjectConfig,
  interfaceConfig,
  type AnalysisResult,
  type CaseResult,
} from "@nudojs/service";

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
  const argsStr = c.argAbs.map((a) => formatShape(a)).join(", ");
  let line = `  ${caseLabel(c)}  (${argsStr}) => ${formatShape(c.abs)}`;
  if (c.throwsAbs && c.throwsAbs.shape.k !== "never") {
    line += `   throws ${formatShape(c.throwsAbs)}`;
  }
  return line;
}

/**
 * entry@ 回退 case × 有效契约的注解行：解释「check 全绿但 test 打
 * `(any) => any throws`」的表面矛盾——entry@ 用的是无约束入口 face，
 * 契约作用于 check/export 面；要看到受约束的 case 就加 @nudo:case
 * 或提供调用点。throws 显示保留（那是无约束 face 的诚实结果）。
 */
export const ENTRY_CONTRACT_NOTE =
  "  (entry@ runs the unconstrained entry face — this contract gates check/export; add @nudo:case or call sites for a constrained case)";

/**
 * 计算 entry@ case 区块尾需要契约注解的函数名集（仅同文件 functions；
 * external 函数的契约绑定在定义模块，不在本面）。判定与 check 门禁同口径：
 * effectiveInterface 返回 handwritten（侧车手写绑定 ∪ 源码 @nudo:contract）；
 * `@generated` 段是事实快照不执法，不触发注解。无契约函数（真 entry-only
 * 回退）不在集内——那是普通回退，不是矛盾。
 */
export function entryContractNoteFns(
  filePath: string,
  source: string,
  result: AnalysisResult,
): Set<string> {
  const candidates = result.functions.filter(
    (fn) => !fn.skipped && fn.cases.some((c) => c.name.startsWith("entry@")),
  );
  if (candidates.length === 0) return new Set();
  // 配置同源 check（commands/check.ts loadCheckCache）：autoBind 关闭 /
  // 树外侧车不参与契约判定
  const proj = findProjectConfig(dirname(filePath));
  const autoBind = interfaceConfig(proj?.config).autoBind;
  const fns = new Set<string>();
  for (const fn of candidates) {
    const since = interfaceDiagCount();
    try {
      const eff = effectiveInterface(source, fn.name, {
        loadModule: defaultLoadModule,
        fromFile: filePath,
        ...(autoBind === false ? { autoBind: false } : {}),
        ...(proj?.projectDir ? { projectDir: proj.projectDir } : {}),
      });
      if (eff?.source === "handwritten") fns.add(fn.name);
    } catch {
      /* optional: 契约解析失败按无契约处理（不注解） */
    } finally {
      // 探测诊断就地排干（工具面惯例），不滞留 interface 诊断通道
      takeInterfaceDiagsSince(since);
    }
  }
  return fns;
}

export type TestReportOptions = {
  /** entry@ case 尾部加契约注解的函数名集（entryContractNoteFns 产物）；缺省不注解 */
  entryContractNotes?: ReadonlySet<string>;
};

export function buildTestReport(
  file: string,
  result: AnalysisResult,
  opts: TestReportOptions = {},
): TestReport {
  const outcomes: CaseTestOutcome[] = [];
  const caseLines: string[] = [];

  const emitFnCases = (
    fnName: string,
    cases: CaseResult[],
    skipped?: boolean,
    declared?: string,
  ): void => {
    caseLines.push(`=== ${fnName} ===`);
    if (skipped) {
      caseLines.push(
        declared ? `  skipped (declared): ${declared}` : "  skipped (no return type declared)",
      );
      // #176 skip×case 解耦：skip 只声明推断面（combinedAbs）；声明的
      // @nudo:case 是运行时见证，照常逐条打印并计入断言结果——不再
      // 「交易掉运行时真值换声明面」。无 case 的 skip 保持只显示说明行。
      if (cases.length === 0) {
        caseLines.push("");
        return;
      }
    } else if (cases.length === 0) {
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
        /* optional: leqAbs threw — treat case as failed */
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
    // entry@ 回退 × 有效契约：区块尾注解表面矛盾（只进展示面，不进断言）
    if (!skipped && opts.entryContractNotes?.has(fnName)) {
      caseLines.push(ENTRY_CONTRACT_NOTE);
    }
    caseLines.push("");
  };

  for (const fn of result.functions) {
    emitFnCases(
      fn.name,
      fn.cases,
      fn.skipped,
      fn.skipped && fn.combinedAbs ? formatShape(fn.combinedAbs) : undefined,
    );
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
        emitFnCases(
          fn.name,
          fn.cases,
          fn.skipped,
          fn.skipped && fn.combinedAbs ? formatShape(fn.combinedAbs) : undefined,
        );
      }
    }
  }

  const declared = outcomes.filter((o) => !o.synthetic);
  return {
    file,
    passed: declared.filter((o) => o.ok && !o.unchecked).length,
    failed: declared.filter((o) => !o.ok).length,
    // 只计声明 case 的 unchecked；合成 call@/entry@ 不进断言面
    unchecked: declared.filter((o) => o.unchecked).length,
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
  const syntheticCount = r.outcomes.length - declared.length;
  lines.push("assertions");
  if (declared.length === 0) {
    lines.push(
      `  — 0 passed · 0 failed · 0 unchecked (no declared @nudo:case expectations${syntheticCount > 0 ? `; ${syntheticCount} synthetic case(s) printed above` : ""})`,
    );
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
