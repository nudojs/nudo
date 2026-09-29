/**
 * after/ — 同一真实依赖 `ms`；tsc 已退役，门禁是 nudo check。
 * 契约来自 contract --from-dts 审阅后接受（age.nudo.js）。
 */
import ms from "ms";

/**
 * @nudo:contract return string
 */
export function formatAge(durationMs) {
  return ms(durationMs, { long: true });
}

/**
 * @nudo:contract return number
 * 注：ms 对非法时长可返回 undefined；侧车契约是 nullable(number())。
 * 此 JSDoc 名仅作显示（无 @nudo:import 同名约束时不执法）。
 */
export function parseAge(text) {
  return ms(text);
}

formatAge(90_000);
parseAge("2d");
