/**
 * export — 契约面 / 观测面：从契约或 case 证据算出**统一的参数面与返回面**。
 *
 * 契约面（手写契约：sidecar `*.nudo.js` ∪ inline `@nudo:contract`）优先；
 * 缺契约时回落观测面（`@nudo:case` 见证）。
 *
 * 本模块只做**面计算**（不写盘、不上屏）；产物面（zod / standard / guard / dts）
 * 由各面模块消费本模块的产物。
 */
import { constraintToEntryAbs, joinAbs, type Abs, type EffectiveInterface } from "@nudojs/core";
import { domainEvidenceCases } from "@nudojs/service/emit";
import type { CaseResult, FunctionAnalysis } from "@nudojs/service";
import { evidencePathOf } from "./selection.ts";

/** 统一参数面的一条：参数名 + entry Abs + 契约级可选性标记。 */
export type ParamFace = {
  name: string;
  abs: Abs;
  /**
   * 契约级**顶层形参可选性**（Bug 536）——`constraintToEntryAbs` 对标量契约会
   * **丢掉** `isOptional`（entry Abs 里没有该信息），故可选性必须由契约面显式
   * 带过来；缺省（undefined）= 契约未申报该位 ⇒ 按**必填**处理（契约是用户
   * 申报的调用域，权威）。
   */
  optional?: boolean;
};

/**
 * 契约参数面：`eff.params` → entry Abs（无 eff / 无参数契约 = 空表）。
 *
 * 与 {@link unifiedParamFace} 的差别：这里**只**取契约面（不回落域证据）——
 * dts 面要的是「契约声明了什么」，不是「证据能推出什么」。
 */
export function contractParamFace(eff: EffectiveInterface | undefined): ParamFace[] {
  if (!eff) return [];
  return eff.params.map((p) => ({
    name: p.param,
    abs: constraintToEntryAbs(p.constraint, p.param),
    optional: p.constraint.isOptional === true,
  }));
}

/**
 * 契约返回面：`eff.returns` → entry Abs（无契约返回 = undefined）。
 *
 * 与 {@link unifiedReturnFace} 的差别：这里**只**取契约面（不回落观测证据）。
 */
export function contractReturnFace(eff: EffectiveInterface | undefined): Abs | undefined {
  return eff?.returns ? constraintToEntryAbs(eff.returns.constraint, "return") : undefined;
}

/**
 * 统一参数面：契约参数面优先；无契约参数时回落**域证据**。
 *
 * 无显式参数契约：对**域证据** case 的同槽 argAbs 做 join（合成证据 call@/entry@
 * + 带断言的声明 case）。无断言的 case 指令是见证、不是域声明 ⇒ 不参与
 * （Bug 511：freeze 写回的单点见证会把入参面收窄成该点的字面量）。
 */
export function unifiedParamFace(
  fn: FunctionAnalysis,
  eff: EffectiveInterface | undefined,
  caseResults: readonly CaseResult[],
): ParamFace[] {
  const contractParams = contractParamFace(eff);
  if (evidencePathOf(contractParams.length > 0) === "contract") return contractParams;
  const domainCases = domainEvidenceCases(caseResults);
  const arity = Math.max(0, ...domainCases.map((c) => c.argAbs.length));
  const out: ParamFace[] = [];
  for (let i = 0; i < arity; i++) {
    const parts = domainCases.map((c) => c.argAbs[i]).filter((a): a is Abs => !!a);
    if (parts.length === 0) continue;
    const joined = parts.reduce((a, b) => joinAbs(a, b));
    out.push({ name: fn.paramNames[i] ?? `arg${i}`, abs: joined });
  }
  return out;
}

/**
 * 统一返回面：契约返回面优先；缺契约返回时回落**带断言的 case**。
 *
 * 兜底只吃**带断言**的 case（`=> expected`）：无断言 case 是见证，不是域声明
 * ——拿它当返回面会把产物收窄成单个调用点的字面量（Bug 511）。
 */
export function unifiedReturnFace(
  fn: FunctionAnalysis,
  eff: EffectiveInterface | undefined,
  caseResults: readonly CaseResult[],
): Abs | undefined {
  const contractReturn = contractReturnFace(eff);
  if (evidencePathOf(contractReturn !== undefined) === "contract") return contractReturn;
  const asserted = caseResults.filter((c) => c.expected !== undefined);
  return fn.combinedAbs ?? asserted[0]?.abs;
}

/**
 * 观测返回面（**不含契约**）：`fn.combinedAbs` 优先，缺省回落带断言 case。
 *
 * guard 面专用：守卫反映**实际会发生什么**，不是契约允许什么——契约放宽的域
 * 不改变既有调用的返回值形态。
 */
export function observedReturnFace(
  fn: FunctionAnalysis,
  caseResults: readonly CaseResult[],
): Abs | undefined {
  const asserted = caseResults.filter((c) => c.expected !== undefined);
  return fn.combinedAbs ?? asserted[0]?.abs;
}
