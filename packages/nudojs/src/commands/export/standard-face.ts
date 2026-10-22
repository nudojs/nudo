/**
 * export — standard 产物面：每函数一份 Standard Schema 模块。
 *
 * 入参面口径与 zod 面对齐（Bug 539）：`<fn>Input` 校验**整个入参对象**；整参
 * 另出 `<fn>_<param>`；**解构形参的字段不提升为顶层整参校验器**（字段级校验器
 * 与整参校验器同名同形、语义却不同，消费方必然误用）。
 */
import { constraintToEntryAbs, type Abs, type EffectiveInterface } from "@nudojs/core";
import { absToStandardSchemaFunction } from "@nudojs/service/emit";
import type { FunctionAnalysis } from "@nudojs/service";
import type { ParamFace } from "./contract-face.ts";

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
 * 的返回形态是两条不同的证据线：契约面进 `<fn>Return`，观测面进 `<fn>Output`。
 */
export function standardFaceChunk(
  fn: FunctionAnalysis,
  baseName: string,
  paramExps: readonly ParamFace[],
  eff: EffectiveInterface | undefined,
  outputAbs: Abs | undefined,
): StandardFaceChunk | undefined {
  const stdInputs = paramExps.map((p) => ({ name: p.name, abs: p.abs }));
  const stdReturns = eff?.returns ? constraintToEntryAbs(eff.returns.constraint, "return") : undefined;
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
