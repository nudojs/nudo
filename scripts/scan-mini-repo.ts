#!/usr/bin/env tsx
/**
 * 替换可行性扫描（脚本，不属于库源码）。
 * 用法：npx tsx scripts/scan-mini-repo.ts
 */
import {
  analyzeFn,
  numLit,
  numVar,
  gtNum,
  v,
  formatAbs,
  formatShape,
  predToString,
} from "../packages/core/src/index.ts";
import { collectStaticImports } from "../packages/service/src/static-imports.ts";
import { resolve } from "node:path";

const entry = resolve("docs/examples/mini-repo/user-service.js");

console.log("=== Nudo kernel 替换可行性扫描 ===\n");
console.log("入口:", entry);

const graph = collectStaticImports(entry);
console.log(`\n[静态 import 图] ${graph.size} 文件（host 侧，非 bundler）:`);
for (const p of graph.keys()) {
  const short = p.split("/").slice(-2).join("/");
  const mod = graph.get(p)!;
  console.log(`  - ${short}  exports: ${[...mod.named.keys()].join(", ") || "(none)"}`);
}

console.log("\n[内涵签名]");
for (const mod of graph.values()) {
  for (const [name, g] of mod.poly) {
    if (["score", "fetchUser", "add", "clamp"].includes(name)) {
      console.log(`  ${g.display}`);
    }
  }
}

const phi = gtNum(v("x"), 0);
const r = analyzeFn(
  `function score(x) { return x + 1; }`,
  "score",
  [numVar("x", gtNum(v("x"), 0))],
  phi,
);
console.log("\n[约束算术] score(x) where x>0");
console.log(" ", formatAbs(r));
if (r.pred && r.pred.op !== "true") console.log("  pred:", predToString(r.pred));

const r2 = analyzeFn(
  `async function fetchUser(id) { return { id: id + 1, name: "u" }; }`,
  "fetchUser",
  [numLit(3)],
);
console.log("\n[async] fetchUser(3):", formatShape(r2), r2.shape.k === "eff" ? `inner=${formatShape((r2.shape as any).inner)}` : "");

const r3 = analyzeFn(
  `class MemoryStore { constructor() { this.items = {}; } }\nfunction make() { return new MemoryStore(); }`,
  "make",
  [],
);
console.log("[class] new MemoryStore():", formatShape(r3), r3.shape.k === "brand" ? (r3.shape as any).name : "");
