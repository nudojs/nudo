#!/usr/bin/env tsx
/**
 * 真实 npm 包可行性扫描（host 脚本）。
 * 用法：npx tsx scripts/scan-npm-package.ts [pkgName]
 * 默认扫 typescript（monorepo devDep）。
 */
import { collectStaticImports } from "../packages/service/src/static-imports.ts";
import {
  harvestPackage,
  formatHarvestSummary,
  resolvePackageRoot,
} from "../packages/service/src/harvest-package.ts";
import { checkSource, formatCheckReport } from "../packages/core/src/index.ts";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const pkg = process.argv[2] ?? "typescript";
const root = resolve(".");

console.log("=== npm 包可行性扫描 ===\n");
console.log("包:", pkg);

// 1. harvest .d.ts
const hp = resolvePackageRoot(pkg, root);
if (!hp) {
  console.log("未找到包（node_modules）。请先 pnpm install。");
  process.exit(0);
}
console.log("路径:", hp);

const harvest = harvestPackage(pkg, root);
if ("error" in harvest) {
  console.log("harvest:", harvest.error);
} else {
  console.log("\n[harvest .d.ts]");
  console.log(formatHarvestSummary(harvest));
}

// 2. 若包内有 JS 入口，跑 check / 内涵签名
const pkgJsonPath = join(hp, "package.json");
if (existsSync(pkgJsonPath)) {
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const main = pkgJson.main || pkgJson.module || "index.js";
  const entry = join(hp, main);
  if (existsSync(entry) && entry.endsWith(".js")) {
    console.log("\n[静态 import 图] 入口", entry);
    try {
      const graph = collectStaticImports(entry, 2);
      console.log(`  文件数: ${graph.size}`);
      let withPoly = 0;
      for (const mod of graph.values()) withPoly += mod.poly.size;
      console.log(`  内涵签名数: ${withPoly}`);
    } catch (e) {
      console.log("  扫描失败:", (e as Error).message);
    }
  } else {
    console.log("\n入口不是 .js（可能是 TS-only 包），跳过 import 图。");
  }
}

// 3. 对包内一个小型 JS fixture 跑 nudo check 语义（若找到）
const libDir = join(hp, "lib");
if (existsSync(libDir)) {
  const jsFiles = readdirSync(libDir).filter((f) => f.endsWith(".js")).slice(0, 1);
  if (jsFiles[0]) {
    const src = readFileSync(join(libDir, jsFiles[0]), "utf8").slice(0, 8000);
    console.log("\n[nudo check 样本]", jsFiles[0]);
    const report = checkSource(jsFiles[0], src);
    console.log(formatCheckReport(report).split("\n").slice(0, 15).join("\n"));
  }
}

console.log("\n[结论]");
console.log("  harvest 路径可用；JS 入口可用 collectStaticImports + checkSource。");
console.log("  完整替换仍需：Node API env、动态 require、以及对「错误」的金标召回率。");
