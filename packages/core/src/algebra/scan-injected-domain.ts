/**
 * T10b：跨文件注入调用点域证据 ⊄ 手写契约（nudo:interface-domain-exceeds）。
 *
 * 从 scan.ts 拆出的内聚段：只消费 externalCallRecords 注入的跨文件记录，
 * 不做同文件调用点扫描（那是 scanLiteralCalls 的职责）。
 */

import {
  effectiveInterface,
  formatConstraint,
  type EffectiveInterface,
} from "./interface.ts";
import { literalMeetsConstraint } from "./domain-membership.ts";
import { litValue } from "./abs.ts";
import type { Abs } from "./abs.ts";
import type { CheckIssue } from "./check-report.ts";

/**
 * 注入记录的最小结构面。Abs 为唯一真理源。
 */
export type InjectedDomainRecord = {
  /** 无损参数 Abs（必填；domain 证据唯一来源） */
  argAbs?: Abs[];
  resultAbs?: Abs;
  throwsAbs?: Abs;
};

export type InjectedDomainEvidenceOpts = {
  /** 被调函数形参名（位置序）；契约按参数名对齐证据位 */
  paramNames: string[];
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  fromFile?: string;
  /** 侧车 ambient 绑定开关（host 配置下传；默认 true） */
  autoBind?: boolean;
  /** 项目根：树外侧车不 ambient 绑定 */
  projectDir?: string;
  /** 报告定位：被调函数声明处。注入证据的 loc 在使用现场文件，不属于本文件 */
  loc?: { line: number; column: number };
};

/** 字面量证据展示：字符串带引号，number/boolean 原样 */
function evidenceToString(v: number | string | boolean): string {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

/**
 * 跨文件注入的调用点域证据 vs 手写契约（设计稿 §3.3/§6 对账矩阵第一行）。
 *
 * 来源分流铁律：写在被分析文件里的调用点违例（含 scanLiteralCalls 的
 * checkExternalCall 跨文件被调路径）维持 `nudo:constraint-violated` 原码
 * 原语义——本函数**只**消费经 externalCallRecords 注入的跨文件记录（analyzer
 * 消费区已做归属守卫），该路径此前不查契约，是纯增量。
 *
 * 证据门槛（§6）：
 * - 只有 plain literal 实参构成证据：union/unknown/primitive/refined 形态
 *   无法归因到确定值，不参与。Abs 路径直接读 `litValue` + conf
 *   ∈ {exact, path}。
 * - null 证据预过滤（T4 caveat：lit(null) 编码 prim undefined + eq(self,
 *   null)，对任何约束恒不满足，不过滤必 FP）；undefined/bigint/symbol
 *   不在字面量证据域内，一并跳过；
 * - resultType=never ∧ throws=never 是求值中断泄漏（analyzer 注入消费区
 *   同款过滤；有 resultAbs/throwsAbs 时同口径）。CallRecord 上没有截断字段
 *   （查证于 evaluator.ts CallRecord 声明）——递归截断走
 *   nudo:recursion-truncated 诊断通道且只 widen 结果，不产生新字面量证据；
 * - fn/shape/array 参数位 Phase 1 不执法（§3.3 HOF 豁免：
 *   literalMeetsConstraint 对这些形态恒 false，直接查必 FP）。
 *
 * 每函数每参数位最多一条 issue（多证据并列在 actual 里，去重）。
 */
export function checkInjectedDomainEvidence(
  fnName: string,
  source: string,
  records: InjectedDomainRecord[],
  opts: InjectedDomainEvidenceOpts,
): CheckIssue[] {
  const isLeaked = (r: InjectedDomainRecord): boolean => {
    if (r.resultAbs && r.throwsAbs) {
      return r.resultAbs.shape.k === "never" && r.throwsAbs.shape.k === "never";
    }
    return false;
  };
  const usable = records.filter((r) => !isLeaked(r));
  if (usable.length === 0) return [];

  let ei: EffectiveInterface | undefined;
  try {
    ei = effectiveInterface(source, fnName, {
      ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
      fromFile: opts.fromFile,
      ...(opts.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
      ...(opts.projectDir !== undefined ? { projectDir: opts.projectDir } : {}),
    });
  } catch (e) {
    return [
      {
        severity: "warning",
        code: "nudo:interface-load",
        message: `${fnName}: effective interface load failed (${e instanceof Error ? e.message : String(e)}); skipping domain-exceeds check`,
        fn: fnName,
        line: opts.loc?.line,
        column: opts.loc?.column,
      },
    ];
  }
  // §3.3 执法分档：仅手写契约执法。generated 段是事实快照（过期由
  // nudo:interface-drift 覆盖）；implicit 无契约。
  if (!ei || ei.source !== "handwritten") return [];

  const out: CheckIssue[] = [];
  for (const { param, constraint } of ei.params) {
    if (constraint.fields || constraint.element || constraint.fn) continue;
    const idx = opts.paramNames.indexOf(param);
    // 形参名对不上（解构/rest/改名）：证据无法归位，跳过不猜
    if (idx < 0) continue;
    const failures: Array<number | string | boolean> = [];
    for (const rec of usable) {
      const lit = extractLiteralEvidence(rec, idx);
      if (lit === undefined) continue;
      if (!literalMeetsConstraint(lit, constraint)) failures.push(lit);
    }
    if (failures.length === 0) continue;
    const shown = [...new Set(failures)].map(evidenceToString).join(", ");
    out.push({
      severity: "error",
      code: "nudo:interface-domain-exceeds",
      message: `${fnName}[${param}]: cross-file call-site domain evidence ${shown} exceeds handwritten contract`,
      actual: shown,
      expected: formatConstraint(constraint),
      suggestion: `Loosen the handwritten contract for ${fnName} (${param}: ${formatConstraint(constraint)}), or fix the caller's values`,
      fn: fnName,
      line: opts.loc?.line,
      column: opts.loc?.column,
    });
  }
  return out;
}

/**
 * 单条记录在参数位 idx 的字面量证据。
 * Abs 无损 lit + conf 门槛。
 * 非字面量 / conf 门槛不过 / null·undefined·bigint·symbol → undefined。
 */
function extractLiteralEvidence(
  rec: InjectedDomainRecord,
  idx: number,
): number | string | boolean | undefined {
  const absArg = rec.argAbs?.[idx];
  if (!absArg) return undefined;
  if (absArg.conf !== "exact" && absArg.conf !== "path") return undefined;
  const lv = litValue(absArg);
  if (typeof lv === "number" || typeof lv === "string" || typeof lv === "boolean") {
    return lv;
  }
  return undefined;
}
