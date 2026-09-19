/**
 * 预置 Node API env：从 @types/node 的 .d.ts harvest。
 * 与 packages/env 的手写 env 并行；此路径自动、可刷新。
 *
 * Productization (P0-B B2/B7):
 * - In-process cache keyed by package root + package.json mtime/size.
 * - `clearNodeHarvestCache()` for tests / watch invalidation.
 * - `NUDO_HARVEST_NODE=off` disables harvest (explicit skip, not silent).
 * - Defaults stay IDE-budgeted: maxFiles=12, maxMs=2500.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { harvestDts, type HarvestedEnv } from "@nudojs/harvester";
import { collectDtsFiles, resolvePackageRoot } from "./harvest-package.ts";

/** IDE-startup budgets for @types/node harvest. Do not raise casually. */
export const HARVEST_NODE_DEFAULT_MAX_FILES = 12;
export const HARVEST_NODE_DEFAULT_MAX_MS = 2500;

export type HarvestNodeStats = {
  files: number;
  symbols: number;
  skipped: number;
};

export type NodeEnvResult =
  | {
      ok: true;
      env: HarvestedEnv;
      root: string;
      files: number;
      stats: HarvestNodeStats;
      /** true when this result came from the in-process cache */
      cached: boolean;
    }
  | { ok: false; error: string; reason: "disabled" | "not-found" | "no-dts" | "failed" };

/** Process-level harvest cache (documented first step; disk cache is follow-up). */
const nodeHarvestCache = new Map<string, NodeEnvResult>();

/** Stable cache key: root + budgets + package.json mtime/size signature. */
function nodeHarvestCacheKey(
  root: string,
  maxFiles: number,
  maxMs: number,
): string {
  let sig = "nostat";
  try {
    const st = statSync(join(root, "package.json"));
    sig = `${st.size}:${Math.floor(st.mtimeMs)}`;
  } catch {
    // package.json missing — fall back to root identity only
  }
  return `${root}|${maxFiles}|${maxMs}|${sig}`;
}

/**
 * Clear the in-process @types/node harvest cache.
 * Tests and watch-mode dep-hash invalidation should call this when
 * node_modules/@types/node changes underneath the process.
 */
export function clearNodeHarvestCache(): void {
  nodeHarvestCache.clear();
}

/** Number of cached harvest results (diagnostics / tests). */
export function getNodeHarvestCacheSize(): number {
  return nodeHarvestCache.size;
}

export function isHarvestNodeDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NUDO_HARVEST_NODE === "off";
}

/**
 * harvest @types/node（限制文件数 + 时间预算，避免拖垮启动）。
 * Results are cached in-process per (root, budgets, package.json fingerprint).
 */
export function harvestNodeTypes(
  fromDir?: string,
  maxFiles: number = HARVEST_NODE_DEFAULT_MAX_FILES,
  maxMs: number = HARVEST_NODE_DEFAULT_MAX_MS,
): NodeEnvResult {
  if (isHarvestNodeDisabled()) {
    return {
      ok: false,
      error: "harvest disabled via NUDO_HARVEST_NODE=off",
      reason: "disabled",
    };
  }
  // @types/node 在 node_modules/@types/node
  const root =
    resolvePackageRoot("@types/node", fromDir) ??
    resolvePackageRoot("node", fromDir);
  if (!root || !existsSync(root)) {
    return { ok: false, error: "@types/node not found", reason: "not-found" };
  }
  const key = nodeHarvestCacheKey(root, maxFiles, maxMs);
  const hit = nodeHarvestCache.get(key);
  if (hit && hit.ok) {
    return { ...hit, cached: true };
  }
  // 优先 index.d.ts 等入口
  const dts = collectDtsFiles(root, maxFiles);
  if (dts.length === 0) {
    return { ok: false, error: `no .d.ts under ${root}`, reason: "no-dts" };
  }
  try {
    const env = harvestDts(dts, { maxMs });
    const stats: HarvestNodeStats = {
      files: env.stats.files,
      symbols: env.stats.symbols,
      skipped: env.stats.skipped,
    };
    const result: NodeEnvResult = {
      ok: true,
      env,
      root,
      files: stats.files,
      stats,
      cached: false,
    };
    nodeHarvestCache.set(key, result);
    return result;
  } catch (e) {
    return {
      ok: false,
      error: `harvest failed: ${(e as Error).message}`,
      reason: "failed",
    };
  }
}

/** 把 harvest 结果压成「模块名 → 导出名列表」摘要，便于日志/测试 */
export function summarizeNodeEnv(env: HarvestedEnv): {
  modules: string[];
  globals: string[];
  symbolCount: number;
} {
  return {
    modules: Object.keys(env.modules).sort(),
    globals: Object.keys(env.globals).sort().slice(0, 50),
    symbolCount: env.stats.symbols,
  };
}
