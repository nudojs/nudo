/**
 * `nudo test` 的**断言汇总**（passed / failed / unchecked）——报告面计算。
 *
 * 背景（Bug 754）：CLI 的 `nudo test --json` 在 case 报告本体之外**并入**
 * 一段 `assertions` 汇总（`packages/nudojs/src/commands/test.ts` 调它），
 * 而 LSP agent 工具面（`packages/lsp/src/agent-tools.ts` 的 `testTool`）
 * 只序列化 case 报告本体 ⇒ 消费方**分不出「见证通过」与「见证失败」**。
 *
 * 本模块是那段汇总计算的落点（自 CLI 包下沉，service 未冻结）：CLI 文本面
 * （`nudojs/src/run-test.ts` 再导出）与 agent JSON 面调**同一份**实现 ⇒
 * 两侧的断言口径不再分叉（文本面与 JSON 面同一实现）。
 *
 * 判定口径（与 CLI 既有实现逐字一致）：
 * - 只有**源码声明**的 case（`source === "directive"`）进断言面；分析器合成
 *   的观察（call@ / entry@）只进展示面，不进 passed/failed/unchecked；
 * - 声明了但**没有** `=> expected` 的 case 记 `unchecked`（不是失败）；
 * - **引擎未能推断**实测值（`unknown` / `conf=opaque`）⇒ 也记 `unchecked`
 *   （Bug 950 第三态：**无法判定** ⇒ 既不是失败，也不是空洞通过）；
 * - 期望判定走 service 的**值级谓词**判定（`caseExpectedSatisfied`）——
 *   与分析面同口径（裸 leqAbs 不做值级判定会让 `number().gt(0)` 恒假红）。
 */
import { formatShape, type Abs } from "@nudojs/core";
import {
  caseExpectedSatisfied,
  formatExpected,
  inferenceFailed,
} from "./analyzer-orchestrate-uncached-cases.ts";
import type { AnalysisResult, CaseResult } from "./analyzer.ts";

export type CaseTestOutcome = {
  fn: string;
  caseName: string;
  ok: boolean;
  unchecked: boolean;
  /**
   * `unchecked` 的原因（Bug 950 第三态）：
   * - `"no-expectation"`：声明了 case 但**没写** `=> expected`（既有口径）；
   * - `"inference-failed"`：引擎**未能推断**实测值（`unknown` / `conf=opaque`）
   *     ⇒ **无法判定**（既不是失败，也不是空洞通过）。
   *
   * 缺省 = 合成 case（`synthetic: true`，不进断言面）。
   */
  uncheckedReason?: "no-expectation" | "inference-failed";
  expected?: string;
  actual: string;
  throws?: string;
  /** 合成 case（分析器合成出来的观察，非源码声明）— 不参与 exit */
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

/**
 * 见证行**本体**（不含行首缩进）：`<label>  (args) => <result>[   throws T]`。
 *
 * BUG-136：这是 CLI `nudo test` 报告与 LSP codeLens 标题（`agent-tools.ts`
 * 的 `observationTitle`）的**共享格式**。两面此前各自手写（throws 前 2 vs 3
 * 空格）⇒ 同一事实两种渲染。格式只在这里定义一次：CLI 报告在
 * `caseLines.push` 处加容器缩进，LSP lens 标题**不带**缩进按同一模板渲染
 * （一致性由 `lsp-bug-136-witness-line-parity.test.ts` 逐字符钉住）。
 */
function formatCaseLine(c: CaseResult): string {
  const argsStr = c.argAbs.map((a) => formatShape(a)).join(", ");
  let line = `${caseLabel(c)}  (${argsStr}) => ${formatShape(c.abs)}`;
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

export type TestReportOptions = {
  /** entry@ case 尾部加契约注解的函数名集（entryContractNoteFns 产物）；缺省不注解 */
  entryContractNotes?: ReadonlySet<string>;
};

/**
 * 汇总一份 case 报告的断言结果（+ 逐函数展示行）。
 *
 * 外部（imported）函数的 case 一并计入——与 CLI 的 `nudo test` 报告面
 * 同口径（外部函数的声明 case 同样是源码声明的见证）。
 */
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
      // 行首 2 空格 = 报告容器缩进（LSP codeLens 标题不携带，BUG-136）
      caseLines.push(`  ${formatCaseLine(c)}`);
      // synthetic 判据 = **来源**（源里没有这条 case ⇒ 合成出来的观察）。
      // 不能只看名字前缀：`nudo test --freeze` 写回的见证 case 名叫
      // `call@<file>:<line>`，但它是**写在源码里的** case 指令 ⇒ 已声明
      // （无 `=> expected` ⇒ unchecked，不是 synthetic）。按名字前缀判会把它
      // 误算成 synthetic，报告就写成「没有声明的断言」（Bug 511）。
      const synthetic = c.source !== "directive";
      const throwsStr =
        c.throwsAbs && c.throwsAbs.shape.k !== "never" ? formatShape(c.throwsAbs) : undefined;
      if (synthetic) {
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
          uncheckedReason: "no-expectation",
          actual,
          ...(throwsStr ? { throws: throwsStr } : {}),
          synthetic: false,
        });
        continue;
      }
      // Bug 207：期望渲染带谓词（`number (> 0)`）——与 check 诊断面
      // （`nudo:case-expected` 的 expected 文本）同口径；裸 formatShape 会
      // 把谓词期望压成 `number`，用户无从判断判定依据。
      const expected = formatExpected(c.expected as Abs);
      // Bug 950 第三态：引擎**未能推断**实测值（unknown / conf=opaque）⇒
      // **无法判定** ⇒ 记 unchecked（既不是失败，也不是空洞通过）。
      // ⚠ 判在**判定调用之前** ⇒ `any()` / `unknown()` 这类「放宽的期望」
      // 不会借 `leqAbs` 的「目标放宽 ⇒ 通过」捷径空洞判 ok（改前：假红
      // `number()` / 假绿 `any()` —— 同一事实两种期望都不可用）。
      if (inferenceFailed(c.abs)) {
        outcomes.push({
          fn: fnName,
          caseName: c.name,
          ok: false,
          unchecked: true,
          uncheckedReason: "inference-failed",
          expected,
          actual,
          ...(throwsStr ? { throws: throwsStr } : {}),
          synthetic: false,
        });
        continue;
      }
      let ok = false;
      try {
        // 期望判定与 service 分析面**同口径**（值级谓词）：裸 leqAbs 不做
        // 值级判定 ⇒ `number().gt(0)` 这类谓词期望在报告面恒假红
        // （分析面判满足、报告面判不满足）。
        ok = caseExpectedSatisfied(c.abs, c.expected as Abs);
      } catch {
        /* optional: 判定抛错 — treat case as failed */
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
    // Bug 950：`unchecked`（无法判定）**不算失败** ⇒ 「引擎没推出来」
    // 不再被压成「断言不符」（假红）⇒ 也不置红（exit 0）。
    failed: declared.filter((o) => !o.ok && !o.unchecked).length,
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
    if (o.uncheckedReason === "inference-failed") {
      // Bug 950 第三态：**工具的局限**（引擎没推出来）⇒ 不是「类型不匹配」。
      // 文本指向 check 面同事实的 INFO（`nudo:opaque-result`）的补证据路径。
      lines.push(`  [unchecked] ${o.fn}  case "${o.caseName}" → ${o.actual}`);
      lines.push(
        `         cannot judge — the engine could not infer the actual value (declared expectation: ${o.expected ?? "(none)"}; not a type mismatch)`,
      );
      lines.push(
        `         → nudo:opaque-result: add a call site (@nudo:case) or a sidecar contract`,
      );
    } else if (o.unchecked) {
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
