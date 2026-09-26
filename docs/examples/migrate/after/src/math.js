/**
 * after/ — retire tsc 后的 JS（行为不变，注解已剥）。
 * 门禁：nudo check .（见 package.json scripts）
 */
export function lineTotal(price, qty) {
  return price * qty;
}

export function applyCoupon(total, percent) {
  if (percent < 0 || percent > 100) {
    throw new RangeError("percent");
  }
  return total * (1 - percent / 100);
}

export function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
