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

export { isPositive, MemoryStore };
