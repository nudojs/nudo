export function isPositive(n) {
  return n > 0;
}

export function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
