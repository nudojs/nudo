/**
 * A6：把侧车里 fn/param 上的数值谓词放宽为基类型（保守文本改写）。
 * 只动 `number().gt(N)` / `.lt` / `.int` / `.min` / `.max` 等可识别片段。
 * 抽出为独立模块：server code action 与单测共用，避免实现漂移。
 */
export function relaxSidecarConstraint(
  sidecarSource: string,
  fnName: string,
  param?: string,
  constraintText?: string,
): string | undefined {
  let src = sidecarSource;
  // 优先：整段 constraintText → 基类型
  if (constraintText && constraintText.length > 0) {
    const base = constraintText
      .replace(/\.(gt|ge|lt|le|min|max|int|positive|negative)\s*\([^)]*\)/g, "")
      .replace(/\(\)/g, "()");
    if (base && base !== constraintText && src.includes(constraintText)) {
      return src.split(constraintText).join(base);
    }
  }
  // 次选：fnName 附近 param: number().…() → number()
  if (param) {
    const re = new RegExp(`(\\b${param}\\s*:\\s*)number(\\(\\)(?:\\.[A-Za-z]+(?:\\([^)]*\\))?)*)`, "g");
    const next = src.replace(re, (_m, p1) => `${p1}number()`);
    if (next !== src) return next;
  }
  // 兜底：导出绑定名附近的 number().pred()
  const fnRe = new RegExp(`(\\b${fnName}\\s*=\\s*)number(\\(\\)(?:\\.[A-Za-z]+(?:\\([^)]*\\))?)*)`, "g");
  const next = src.replace(fnRe, (_m, p1) => `${p1}number()`);
  return next !== src ? next : undefined;
}
