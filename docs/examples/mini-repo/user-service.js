import { isPositive, clamp } from "./validators.js";
import { MemoryStore } from "./store.js";

/**
 * @nudo:throws TypeError
 * 关系运算 ToPrimitive：Symbol 操作数原生抛 TypeError（对齐原生语义）。
 */
export function normalizeId(id) {
  return clamp(id, 1, 9999);
}

/**
 * @nudo:throws TypeError
 * 关系运算 ToPrimitive：Symbol 操作数原生抛 TypeError（对齐原生语义）。
 */
export function validateAge(age) {
  if (age > 0 && age < 150) return true;
  return false;
}

/**
 * @nudo:throws TypeError
 * 体内 normalizeId 的 coercion 抛错沿调用链传播（对齐原生语义）。
 */
export async function fetchUser(id) {
  const nid = normalizeId(id);
  return { id: nid, name: "u" + nid };
}

/**
 * HOF 精度需要具体数组：case 指令逐元素累加 → 60 #exact
 * （C0.1：不再因 body 访问 ages.reduce 报 arg-structure）
 * @nudo:case "ages" ([10, 20, 30])
 */
export function sumAges(ages) {
  return ages.reduce((acc, a) => acc + a, 0);
}

export function createService() {
  const store = new MemoryStore();
  return {
    store,
    load: (id) => fetchUser(id),
  };
}

/**
 * @nudo:throws TypeError
 * x + 1 的 ToNumeric：Symbol 操作数原生抛 TypeError（对齐原生语义）。
 */
export function score(x) {
  return x + 1;
}

// 顶层调用点：async 无 I/O、跨文件 clamp 逐位收窄、score 字面量
fetchUser(7);     // → promise<{ id: 7, name: "u7" }>
normalizeId(5);   // → 5（clamp 跨文件收窄：5 在 [1, 9999]）
score(4);         // → 5

export { isPositive, MemoryStore };
