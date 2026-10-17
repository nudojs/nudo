/**
 * 真实包语料清单单源 —— 供 scripts/scan-real-packages.ts（生成 docs/check-real-packages.md）
 * 与 scripts/check-corpus-freshness.mjs（registry 新鲜度提醒）共用。
 *
 * 语料 = packages/core/src/algebra/__tests__/check-real-packages.test.ts 扫描的
 * 真实 npm 包（zero-FP 金标）。增删/升级语料须同步四处：
 *   1. packages/core/package.json devDependencies（安装位）
 *   2. check-real-packages.test.ts（金标断言）
 *   3. docs/check-real-packages.md 语料表（版本 + 上次刷新列，手工维护节）
 *   4. 本文件 CORPUS（与测试套件同序）
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 与 check-real-packages.test.ts / docs/check-real-packages.md 语料表同序 */
export const CORPUS = [
  "commander",
  "escape-string-regexp",
  "is-plain-obj",
  "debug",
  "yocto-queue",
  "p-limit",
  "kleur",
  "eventemitter3",
  "ms",
  "lodash",
];

/** 语料安装位（packages/core devDependencies → packages/core/node_modules） */
export function corpusPkgDir(pkg) {
  return join(repoRoot, "packages", "core", "node_modules", pkg);
}

/** 安装版本（manifest 缺失返回 undefined；调用方决定是否视为环境错误） */
export function installedCorpusVersion(pkg) {
  try {
    return JSON.parse(readFileSync(join(corpusPkgDir(pkg), "package.json"), "utf-8")).version;
  } catch {
    return undefined;
  }
}
