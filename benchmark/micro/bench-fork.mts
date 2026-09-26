/**
 * $fork 单次成本微基准（集合 overlay / Φ 臂包裹热路径）。
 * 用法：npx tsx benchmark/micro/bench-fork.mts
 */
import { performance } from "node:perf_hooks";
import {
  $fork,
  abs,
  makeMapAbs,
  mapSetEntry,
  mapGetEntry,
  numLit,
  strLit,
  resetAbsCallBudget,
} from "../../packages/core/src/index.ts";

function abstractBool() {
  return abs({ k: "prim", type: "boolean" } as never, undefined, undefined, "path" as never);
}
function absUndef() {
  return abs({ k: "unknown" } as never, { op: "lit", value: undefined as never }, undefined, "exact" as never);
}

function med(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function bench(name: string, n: number, fn: () => void) {
  // warm
  resetAbsCallBudget();
  for (let i = 0; i < 200; i++) fn();
  const runs: number[] = [];
  for (let r = 0; r < 7; r++) {
    resetAbsCallBudget();
    const t = performance.now();
    for (let i = 0; i < n; i++) fn();
    runs.push((performance.now() - t) / n);
  }
  const us = med(runs) * 1000;
  console.log(`${name}: ${us.toFixed(2)}µs / fork (${n} forks)`);
  return us;
}

const flag = abstractBool();

// 1) 空臂 if-else：无 Map/Set、无 pred（最常见热路径）
bench("empty if-else", 20_000, () => {
  $fork(flag, () => absUndef(), () => absUndef());
});

// 2) 空臂 if（隐式 else）：假臂 Φ 应完全跳过
bench("empty if-only", 20_000, () => {
  $fork(flag, () => absUndef());
});

// 3) 带 pred 的条件（Φ 拼接）
const x = abs(
  { k: "prim", type: "number" } as never,
  { op: "var", id: "x" } as never,
  { op: "gt", a: { op: "var", id: "x" }, b: { op: "lit", value: 0 } } as never,
  "path" as never,
);
bench("pred if-else", 20_000, () => {
  $fork(x, () => absUndef(), () => absUndef());
});

// 4) 单侧 Map 写入（触发惰性 overlay 物化 + merge）
const m = makeMapAbs();
mapSetEntry(m, strLit("a"), numLit(1));
bench("map-write one arm", 5_000, () => {
  $fork(flag, () => {
    mapSetEntry(m, strLit("k"), numLit(2));
    return absUndef();
  }, () => absUndef());
  mapGetEntry(m, strLit("k"));
});

// 5) 嵌套空 fork
bench("nested empty", 10_000, () => {
  $fork(flag, () => {
    $fork(flag, () => absUndef(), () => absUndef());
    return absUndef();
  }, () => absUndef());
});
