/**
 * export — guard 产物面：`is<fn>Output` 类型守卫。
 *
 * 守卫反映**实际会发生什么**（观测面），不是契约允许什么——契约放宽的域不改变
 * 既有调用的返回值形态（否则 data === 3 这类合法调用会被判非法，Bug 511）。
 */
import { generateGuardFunctionFromAbs } from "@nudojs/service/emit";
import type { CaseResult, FunctionAnalysis } from "@nudojs/service";
import { observedReturnFace } from "./contract-face.ts";

/**
 * guard 面的函数块：`\n// === <fn> Type Guards ===` 标题 + 守卫源码。
 *
 * 兜底只吃**带断言**的 case（同上：无断言 case 是见证，不是域声明 —— Bug 511：
 * guard 面收窄成 data === 3 会把合法调用判非法）。
 */
export function guardFaceChunk(
  fn: FunctionAnalysis,
  baseName: string,
  caseResults: readonly CaseResult[],
): string {
  const lines: string[] = [`\n// === ${baseName} Type Guards ===`];
  const absForGuard = observedReturnFace(fn, caseResults);
  if (absForGuard) {
    lines.push(generateGuardFunctionFromAbs(`is${baseName}Output`, absForGuard));
  }
  return lines.join("\n");
}
