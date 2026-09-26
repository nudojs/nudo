/**
 * before/ — 购物车（依赖 math.ts）。
 */
import { lineTotal, applyCoupon, formatMoney } from "./math.js";

export type Item = { sku: string; price: number; qty: number };

export function cartTotal(items: Item[], couponPercent = 0): number {
  let total = 0;
  for (const it of items) {
    total += lineTotal(it.price, it.qty);
  }
  return applyCoupon(total, couponPercent);
}

export function receipt(items: Item[], couponPercent = 0): string {
  const total = cartTotal(items, couponPercent);
  return formatMoney(total);
}
