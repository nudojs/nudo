/**
 * after/ — 同一真实依赖 `ms`；tsc 已退役，门禁是 nudo check。
 * 契约来自 contract --from-dts 审阅后接受（age.nudo.js）。
 */
import ms from "ms";

/**
 * @nudo:refine return string
 */
export function formatAge(durationMs) {
  return ms(durationMs, { long: true });
}

/**
 * @nudo:refine return number
 */
export function parseAge(text) {
  return ms(text);
}

formatAge(90_000);
parseAge("2d");
