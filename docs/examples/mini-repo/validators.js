/**
 * @nudo:throws TypeError
 * 关系运算 ToPrimitive：Symbol 操作数原生抛 TypeError（对齐原生语义）。
 */
export function isPositive(n) {
  return n > 0;
}

/**
 * @nudo:throws TypeError
 * 关系运算 ToPrimitive：Symbol 操作数原生抛 TypeError（对齐原生语义）。
 */
export function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
