#!/usr/bin/env node
/**
 * 真实包语料新鲜度检查：安装版本（packages/core/node_modules）↔ npm registry latest。
 *
 * 用法（手动 / 可选 nightly，不进 CI）：
 *   node scripts/check-corpus-freshness.mjs
 *
 * 语义：
 * - 语料 = check-real-packages.test.ts 扫描的真实包（docs/check-real-packages.md
 *   语料表）。增删/升级语料须同步四处：packages/core/package.json devDependencies、
 *   测试套件、docs 语料表（版本 + 上次刷新列）、本脚本 CORPUS。
 * - 提醒档：installed 与 latest 的 **major** 不一致才提醒（major 落后 = 语料
 *   代际陈旧）；minor/patch 漂移仅信息性列出。提醒不红门禁（exit 0）。
 * - 离线/registry 不可达：打印 skip 提示，exit 0（无网络不是失败）。
 * - 本地语料未安装（node_modules 缺 manifest）：exit 1（dev 环境问题，非网络）。
 */
import { CORPUS, installedCorpusVersion, repoRoot } from "./lib/corpus.mjs";

/** 严格 semver 主版本（容忍 prerelease/build 后缀，如 8.0.0-beta.1 → 8）。 */
function majorOf(version) {
  const m = /^(\d+)\./.exec(version);
  if (!m) return undefined;
  return Number(m[1]);
}

const installed = CORPUS.map((pkg) => ({ pkg, version: installedCorpusVersion(pkg) }));
const missing = installed.filter((e) => !e.version);
if (missing.length > 0) {
  for (const { pkg } of missing) console.error(`error: ${pkg} 未安装（先 pnpm install）`);
  process.exit(1);
}

const FETCH_TIMEOUT_MS = 10_000;
const results = await Promise.allSettled(
  CORPUS.map(async (pkg) => {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`registry HTTP ${res.status}`);
    const body = (await res.json())?.version;
    if (typeof body !== "string") throw new Error("registry 响应缺 version 字段");
    return { pkg, latest: body };
  }),
);

const latestByPkg = new Map();
const failed = [];
for (const r of results) {
  if (r.status === "fulfilled") latestByPkg.set(r.value.pkg, r.value.latest);
  else failed.push(String(r.reason?.cause?.message ?? r.reason?.message ?? r.reason));
}

// 全部请求失败视为离线：优雅跳过（exit 0），不阻塞无网络环境
if (latestByPkg.size === 0) {
  console.log("skip: registry 不可达（offline？），本次不检查语料新鲜度");
  console.log(`  首个失败原因: ${failed[0] ?? "unknown"}`);
  process.exit(0);
}

const nameWidth = Math.max(...CORPUS.map((p) => p.length));
let majorBehind = 0;
console.log(`语料新鲜度（installed ↔ registry.npmjs.org/latest，${new Date().toISOString().slice(0, 10)} 检查）`);
for (const { pkg, version } of installed) {
  const latest = latestByPkg.get(pkg);
  if (!latest) {
    console.log(`  ${pkg.padEnd(nameWidth)}  ${version.padEnd(10)}  ? latest 获取失败（跳过）`);
    continue;
  }
  const majI = majorOf(version);
  const majL = majorOf(latest);
  if (majI !== undefined && majL !== undefined && majL > majI) {
    majorBehind++;
    console.log(`  ${pkg.padEnd(nameWidth)}  ${version.padEnd(10)}  ⚠ major 落后 ${majL - majI}（latest ${latest}）`);
  } else if (latest === version) {
    console.log(`  ${pkg.padEnd(nameWidth)}  ${version.padEnd(10)}  ok（= latest）`);
  } else {
    console.log(`  ${pkg.padEnd(nameWidth)}  ${version.padEnd(10)}  ok（latest ${latest}，同 major）`);
  }
}

if (majorBehind > 0) {
  console.log(
    `\n${majorBehind} 个语料 major 落后：升级后须同步 packages/core/package.json devDependencies、` +
      `check-real-packages.test.ts、docs/check-real-packages.md 语料表（版本 + 上次刷新）与本脚本 CORPUS。`,
  );
} else {
  console.log("\n全部语料与 registry latest 同 major 代际。");
}
