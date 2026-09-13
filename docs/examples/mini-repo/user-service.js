import { isPositive, clamp } from "./validators.js";
import { MemoryStore } from "./store.js";

export function normalizeId(id) {
  return clamp(id, 1, 9999);
}

export function validateAge(age) {
  if (age > 0 && age < 150) return true;
  return false;
}

export async function fetchUser(id) {
  const nid = normalizeId(id);
  return { id: nid, name: "u" + nid };
}

/**
 * HOF 精度需要具体数组：case 指令逐元素累加 → 60 #exact
 * （顶层调用会触发 check 的 arg-structure 门禁：body 访问 ages.reduce，
 *  实参数组 ⊭ 对象形状 { reduce }，报错而非演示）
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

export function score(x) {
  return x + 1;
}

// 顶层调用点：async 无 I/O、跨文件 clamp 逐位收窄、score 字面量
fetchUser(7);     // → Promise<{ id: 7, name: "u7" }>
normalizeId(5);   // → 5（clamp 跨文件收窄：5 在 [1, 9999]）
score(4);         // → 5

export { isPositive, MemoryStore };
