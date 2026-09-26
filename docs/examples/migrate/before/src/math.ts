/**
 * before/ — TypeScript 起点（样板包 checkout-demo）。
 * 迁移目标：nudo migrate strip → verify → retire tsc（见 ../README.md）。
 */
export function lineTotal(price: number, qty: number): number {
  return price * qty;
}

export function applyCoupon(total: number, percent: number): number {
  if (percent < 0 || percent > 100) {
    throw new RangeError("percent");
  }
  return total * (1 - percent / 100);
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
