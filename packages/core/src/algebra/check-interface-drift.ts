/**
 * T10a：nudo:interface-drift（固化生成段 ≠ 今日重算，warning）。
 *
 * 从 check.ts 拆出的内聚段：generated 快照 vs 今日重算的语义对账。
 * checkSourceInner 收集 drift 候选后统一调用 interfaceDriftIssues。
 */

import type { AbsCallRecord } from "./ast-records.ts";
import type { Abs } from "./abs.ts";
import { leqAbs } from "./leq.ts";
import { constraintToEntryAbs, derefConstraint, union } from "./constraint.ts";
import type { NudoConstraint } from "./constraint.ts";
import { joinThenProject } from "./projection.ts";
import { formatAbs } from "./format.ts";
import { formatConstraint, type EffectiveInterface } from "./interface.ts";
import type { CheckIssue } from "./check-report.ts";
import { DIAG } from "./diag-codes.ts";
import { isPointConstraint, widenObservationAbs } from "./widen-observation.ts";

// generated 段是 emit 时刻的固化事实快照（不执法）；本检查把它与「今日
// 重算」做语义对比（§6 证据门槛：conf∈{exact,path} 且无截断标记，无证据
// 不判——real-package zero-FP 红线）：
// - 参数位：今日 = 该函数**执行态**调用点实参域（AbsCallRecord，
//   joinThenProject 投影归一；与 emit 的 callsite case 同源）；
// - 返回位：今日 = 逐调用点结果域（全证据实参 analyzeFn 重跑，与 emit 的
//   case-result 投影同源；无结果证据不判）。
// 语义相等 = 双方经 constraintToEntryAbs 进 entry Abs 后 leqAbs(a,b) &&
// leqAbs(b,a)（不比字符串；两侧同构归一是关键——裸 numLit 域不带 pred，
// 直接与 entry Abs 比 leq 会因 typeof/eq 锚定 pred 恒失败）。每 fn 每位
// （参数名 / return）最多一条。

/** drift 候选：generated 有效契约 + 今日入口签名（checkSourceInner 每函数级收集） */
export type DriftCandidate = {
  fnName: string;
  /** generalize 形参名表（eff.params 的参数名 → 调用点实参位） */
  paramNames: string[];
  eff: EffectiveInterface;
};

/** 展平嵌套 union 成员（`union(union(lit1,lit2),lit3)` ⇒ 叶子成员表） */
function flatMembers(c: NudoConstraint): NudoConstraint[] {
  const d = derefConstraint(c);
  if (d.members === undefined) return [d];
  const out: NudoConstraint[] = [];
  for (const m of d.members) out.push(...flatMembers(m));
  return out;
}

/**
 * drift 比较前的**规范化**（BUG-029）：同一域的 union 拼写必须落到同一个 Abs
 * 形态再比语义（设计：drift 比语义，不比源码字符串）。
 *
 * 平铺 `union(lit(1),lit(2),lit(3))` 走 `constraintToEntryAbs` 的
 * `samePrimLiteralUnionAbs` 快路径 ⇒ `prim number` + 顶层 `or(eq…)`；
 * 嵌套 `union(union(lit(1),lit(2)),lit(3))` 走 joinAbs 回落 ⇒ `sum` 形状、
 * 无顶层 pred ⇒ 双向 `leqAbs` 互不成立 ⇒ **同域假 drift**（`nudo health`
 * exit 1 卡 CI）。规范化 = 递归展平成员后重建 union，让两种拼写走同一条
 * 快路径。
 */
function normalizeForDrift(c: NudoConstraint): NudoConstraint {
  const d = derefConstraint(c);
  if (d.members === undefined) return d;
  const flat = flatMembers(d);
  if (flat.length === d.members.length) return d;
  return union(...flat);
}

/**
 * 两侧约束语义相等（经 entry Abs 的双向 leqAbs）。
 *
 * BUG-199：漂移判据 = 「`--emit` 会不会改写这一位」——固化段等于今日**原始**
 * 域，或等于今日的**点拓宽**域（`--emit` 自己的产物，见 BUG-021），都算新鲜。
 * 多值观测域不拓宽（`union(lit…)` 是真实观测域，被 `number()` 吸收是真漂移）。
 */
function sameDomain(a: NudoConstraint, b: NudoConstraint, name: string): boolean {
  const ea = constraintToEntryAbs(normalizeForDrift(a), name);
  const eb = constraintToEntryAbs(normalizeForDrift(b), name);
  return leqAbs(ea, eb).ok && leqAbs(eb, ea).ok;
}

/** §6 证据门槛：conf∈{exact,path} 且非 unknown/any。截断求值会被宽化为
 *  partial/opaque（或退化为 unknown），自然出局——无需另查截断标记。 */
function driftEvidence(a: Abs | undefined): a is Abs {
  if (!a) return false;
  if (a.conf !== "exact" && a.conf !== "path") return false;
  return a.shape.k !== "unknown" && a.shape.k !== "any";
}

/**
 * 每函数逐调用点实参表——**执行态**通道（AbsCallRecord，host 模块图求值
 * （evalAbsModuleGraph）收集；与 emit 的 callsite case 同源：只有真正执行了的
 * 调用才产证据）。
 * 语法全树扫描会把「兄弟函数体内从未执行的调用」也算进今日域，fresh
 * emit 后立即误报 drift 且重跑 emit 无法消除——两端口径必须一致。
 */
function driftCallsites(
  records: AbsCallRecord[],
  wanted: Set<string>,
): Map<string, Array<{ args: Abs[]; line?: number }>> {
  const out = new Map<string, Array<{ args: Abs[]; line?: number }>>();
  for (const r of records) {
    if (!wanted.has(r.fnName)) continue;
    const list = out.get(r.fnName) ?? [];
    list.push({ args: r.args, line: r.callLoc?.line });
    out.set(r.fnName, list);
  }
  return out;
}

/** generated 快照 vs 今日重算（参数位 + 返回位），每 fn 每位最多一条。
 *  callRecords：执行态调用记录 AbsCallRecord（今日域证据，与 emit 的
 *  callsite case 同源——analyzeFn 以全证据实参重跑返回位；语法扫描会把
 *  未执行的调用算进今日域，fresh emit 恒误报）。 */
export function interfaceDriftIssues(
  candidates: DriftCandidate[],
  callRecords: AbsCallRecord[],
  evalResult: (fnName: string, args: Abs[]) => Abs | undefined,
  /**
   * BUG-023：**函数体求值期**（generalize 各函数体时）的执行态调用记录。
   *
   * 只有当该函数在**顶层执行态**没有任何调用点证据时才回退使用——这是
   * 「陈旧的生成段在函数体调用下完全静默」的最小修法：
   * - 兄弟函数体内**从未被调用**的调用点不得进今日域（否则 fresh emit 后
   *   立即误报 drift 且重跑 emit 无法消除，见 `check-interface-drift.test`
   *   的「执行态证据」回归）⇒ 有顶层证据时**绝不**混入；
   * - 完全没有顶层证据时，与其静默通过（假绿），不如用分析期真实执行过的
   *   函数体调用点对账——这正是 `@generated` 段唯一的监督通道。
   */
  fallbackCallRecords: AbsCallRecord[] = [],
): CheckIssue[] {
  const out: CheckIssue[] = [];
  const wanted = new Set(candidates.map((c) => c.fnName));
  const callsites = driftCallsites(callRecords, wanted);
  const fallbackSites = driftCallsites(fallbackCallRecords, wanted);

  for (const cand of candidates) {
    // 顶层执行态证据优先；无顶层证据才回退到函数体求值期记录（BUG-023）
    const sites = callsites.get(cand.fnName) ?? fallbackSites.get(cand.fnName) ?? [];

    // 参数位：今日域 = 逐调用点实参（证据门槛过滤）→ joinThenProject 投影
    for (const { param, constraint } of cand.eff.params) {
      const idx = cand.paramNames.indexOf(param);
      if (idx < 0) continue; // 快照参数名已不在今日签名：无位置可对账
      const evidence: Array<{ abs: Abs; line?: number }> = [];
      for (const s of sites) {
        const a = s.args[idx];
        if (driftEvidence(a)) evidence.push({ abs: a, line: s.line });
      }
      if (evidence.length === 0) continue; // 无证据 → 不判 drift（宁缺勿滥）
      const todayC = joinThenProject(evidence.map((e) => e.abs));
      if (!todayC) continue; // 域不可表达（ widened/partial 混入等）→ 不比
      const today = constraintToEntryAbs(normalizeForDrift(todayC), param);
      // BUG-199：漂移判据 = 「`--emit` 会不会改写这一位」。
      // - 固化段 == 今日原始域 ⇒ 新鲜（旧版/手写侧车口径）；
      // - 固化段 == 今日**点拓宽**域 ⇒ 也新鲜——`--emit` 对单点观测写的
      //   就是 `number()`（BUG-021），否则 fresh emit 之后恒报漂移。
      // 多值观测域不拓宽：`number()` 吸收 `union(lit(1),lit(-2))` 是真漂移。
      if (sameDomain(todayC, constraint, param)) continue;
      if (isPointConstraint(todayC)) {
        const widenedC = joinThenProject(evidence.map((e) => widenObservationAbs(e.abs)));
        if (widenedC && sameDomain(widenedC, constraint, param)) continue;
      }
      out.push({
        severity: "warning",
        code: DIAG.interfaceDrift,
        message: `${cand.fnName}[${param}]: persisted @generated segment ≠ today's call-site domain`,
        actual: formatAbs(today),
        expected: formatConstraint(constraint),
        suggestion: `re-run nudo contract --emit to refresh the generated segment, or check the call sites of ${param}`,
        fn: cand.fnName,
        line: evidence[0]!.line,
      });
    }

    // 返回位：今日 = 逐调用点结果域（与 emit 同源；generated 无 returns 声明 → 只查参数位）
    const retC = cand.eff.returns?.constraint;
    if (!retC) continue;
    const retEvidence: Array<{ abs: Abs; line?: number }> = [];
    for (const s of sites) {
      if (s.args.some((a) => !driftEvidence(a))) continue; // 全参证据才重跑（与 case 合成同口径）
      const r = evalResult(cand.fnName, s.args as Abs[]);
      if (driftEvidence(r)) retEvidence.push({ abs: r, line: s.line });
    }
    if (retEvidence.length === 0) continue; // 无结果证据 → 不判 drift（宁缺勿滥）
    const todayRetC = joinThenProject(retEvidence.map((e) => e.abs));
    if (!todayRetC) continue;
    const today = constraintToEntryAbs(normalizeForDrift(todayRetC), "return");
    // 同上（BUG-199）：返回位漂移判据与参数位同口径。
    if (sameDomain(todayRetC, retC, "return")) continue;
    if (isPointConstraint(todayRetC)) {
      const widenedRetC = joinThenProject(retEvidence.map((e) => widenObservationAbs(e.abs)));
      if (widenedRetC && sameDomain(widenedRetC, retC, "return")) continue;
    }
    out.push({
      severity: "warning",
      code: DIAG.interfaceDrift,
      message: `${cand.fnName}[return]: persisted @generated segment ≠ today's inferred return`,
      actual: formatAbs(today),
      expected: formatConstraint(retC),
      suggestion: `re-run nudo contract --emit to refresh the generated segment, or check the return value`,
      fn: cand.fnName,
      line: retEvidence[0]!.line,
    });
  }
  return out;
}
