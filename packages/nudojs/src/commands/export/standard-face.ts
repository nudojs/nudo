/**
 * export — standard 产物面：每函数一份 Standard Schema 模块。
 *
 * 入参面口径与 zod 面对齐（Bug 539）：`<fn>Input` 校验**整个入参对象**；整参
 * 另出 `<fn>_<param>`；**解构形参的字段不提升为顶层整参校验器**（字段级校验器
 * 与整参校验器同名同形、语义却不同，消费方必然误用）。
 */
import { type Abs, type EffectiveInterface } from "@nudojs/core";
import { absToStandardSchemaFunction } from "@nudojs/service/emit";
import type { FunctionAnalysis } from "@nudojs/service";
import { effectiveContractReturnFace, type FaceContext, type ParamFace } from "./contract-face.ts";

/** standard 面的一个函数块（源码 + 丢失的谓词说明）。 */
export type StandardFaceChunk = {
  /** 源码块（`\n// === <fn> Standard Schema ===\n…`） */
  source: string;
  /** 未能投影进本面的谓词说明（每条以 `<fn> ` 前缀） */
  dropped: string[];
};

/**
 * standard 面的函数块：无入参、无契约返回、无观测返回 ⇒ 不出块（undefined）。
 *
 * `returns` 取**契约返回面**（不是统一返回面）——契约声明的返回形态与实际观测
 * 的返回形态是两条不同的证据线：契约面与观测面**都**进 `<fn>Output`（导出名不再
 * 随符号来源翻转；此前契约面叫 `<fn>Return`，下游 `import { <fn>Return }` 会断）。
 *
 * 契约返回面取**已复核**口径（`effectiveContractReturnFace`）：实现违约时不投影
 * 契约（Bug 626）、async 时保留 `promise<…>` 包装（Bug 618）。
 */
export function standardFaceChunk(
  fn: FunctionAnalysis,
  baseName: string,
  paramExps: readonly ParamFace[],
  eff: EffectiveInterface | undefined,
  outputAbs: Abs | undefined,
  ctx?: FaceContext,
): StandardFaceChunk | undefined {
  // 顶层形参可选性透传（族 17 · Bug 627）：契约允许的 `undefined` 在 standard
  // 面必须是**可选槽**（否则消费方拿它当必填 ⇒ 契约允许的调用被判非法）。
  const stdInputs = paramExps.map((p) => ({
    name: p.name,
    abs: p.abs,
    ...(p.optional === true ? { optional: true } : {}),
  }));
  const stdReturns = effectiveContractReturnFace(fn, eff, ctx);
  if (stdInputs.length === 0 && stdReturns === undefined && outputAbs === undefined) {
    return undefined;
  }
  const mod = absToStandardSchemaFunction({
    fn: baseName,
    inputs: stdInputs,
    formals: fn.formals,
    returns: stdReturns,
    output: outputAbs,
  });
  return {
    source: `\n// === ${baseName} Standard Schema ===\n${mod.source}`,
    dropped: mod.dropped.map((note) => `${baseName} ${note}`),
  };
}
