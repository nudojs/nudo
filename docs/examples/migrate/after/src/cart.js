/**
 * after/ — 购物车 JS（import 同 math.js）。
 */
import { lineTotal, applyCoupon, formatMoney } from "./math.js";

export function cartTotal(items, couponPercent = 0) {
  let total = 0;
  for (const it of items) {
    total += lineTotal(it.price, it.qty);
  }
  return applyCoupon(total, couponPercent);
}

export function receipt(items, couponPercent = 0) {
  const total = cartTotal(items, couponPercent);
  return formatMoney(total);
}
