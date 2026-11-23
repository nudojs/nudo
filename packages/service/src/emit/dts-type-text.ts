/** dts 类型文本的通用判据（无信息域）。 */

export function isNoInfoType(ts: string): boolean {
  return ts === "unknown" || ts === "any";
}
