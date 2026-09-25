/**
 * 预置 Node API env：从 @types/node 的 .d.ts harvest。
 * 与 packages/env 的手写 env 并行；此路径自动、可刷新。
 *
 * Productization (P0-B B2/B7):
 * - In-process cache keyed by package root + package.json mtime/size.
 * - **Disk cache** (HarvestJson under `~/.cache/nudo/deps`) — cross-session reuse.
 * - Terminal failures (`not-found`/`no-dts`/`failed`) also cache — no retry storm.
 *   `disabled` is never cached (env var can flip mid-process).
 * - **Degrade chain**: harvest miss/fail → handwritten `@nudojs/env` node face
 *   (`loadEnvs(["node"])`), flagged `degraded`. Handwritten still wins on overlap
 *   via `mergeHarvestUnderEnv`.
 * - `clearNodeHarvestCache()` for tests / watch invalidation.
 * - `NUDO_HARVEST_NODE=off` disables harvest (explicit skip, not silent).
 * - Defaults stay IDE-budgeted: maxFiles=12, maxMs=2500.
 */

import { existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { harvestDts, type HarvestedEnv } from "./harvest-dts.ts";
import { createEnvironment, type Abs } from "@nudojs/core";
import { defineEnv as defineNodeEnv } from "@nudojs/env/node";
import { defineEnv as defineEsEnv } from "@nudojs/env/es";
import { collectDtsFiles, resolvePackageRoot } from "./harvest-package.ts";
import {
  depsCacheRoot,
  dtsClosureHash,
  readHarvestDisk,
  writeHarvestDisk,
} from "./harvest-disk.ts";
import {
  harvestCacheKey,
  materializeHarvestJson,
  serializeHarvestJson,
} from "./harvest-json.ts";
import { BoundedLruMap } from "./lru-map.ts";

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
      /** true when this result is handwritten `@nudojs/env` fallback (harvest miss/fail) */
      degraded?: boolean;
    }
  | {
      ok: false;
      error: string;
      reason: "disabled" | "not-found" | "no-dts" | "failed";
      /** true when this failure came from the in-process cache */
      cached?: boolean;
    };

/**
 * Process-level harvest cache (documented first step; disk cache is follow-up).
 *
 * 上限 NODE_HARVEST_CACHE_MAX（32 条 root×budget×package.json 指纹条目）+ LRU：
 * 命中/写入移到队尾，超限删最旧。条目是整份 HarvestedEnv（globals+modules），
 * 32 足够多项目/多 budget 组合并把 retained 内存钉在上界内。
 */
const NODE_HARVEST_CACHE_MAX = 32;
const nodeHarvestCache = new BoundedLruMap<NodeEnvResult>(NODE_HARVEST_CACHE_MAX);

/** Cache key for "root not resolvable" — avoids re-walking node_modules on every analysis. */
function notFoundCacheKey(fromDir: string | undefined): string {
  return `not-found|@types/node|${fromDir ?? ""}`;
}

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
 * Drops **success and terminal-failure** entries (including `not-found`), so
 * a mid-session `@types/node` install becomes visible without process restart.
 * Tests, watch-mode dep-hash invalidation, and package-manager hooks should
 * call this when `node_modules/@types/node` changes underneath the process.
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

function readPkgVersion(root: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      version?: string;
    };
    return raw.version;
  } catch {
    return undefined;
  }
}

/**
 * 手写 `@nudojs/env` node 面（B2 降级链）：harvest 未命中/失败时仍给出
 * 可分析的 Node API 声明；与 harvest 重叠处由 mergeHarvestUnderEnv 让手写 wins。
 */
export function handwrittenNodeEnv(): HarvestedEnv | null {
  try {
    // Mirrors service `loadEnvs(["node"], …)`: resolveEnvNames(["node"]) is
    // ["es","node"], so es merges first and node wins on overlap (globals
    // overwrite; module exports spread-overwrite per key).
    const globalEnv = createEnvironment();
    const allModules: Record<string, Record<string, Abs>> = {};
    const allGlobals: Record<string, Abs> = {};
    for (const def of [defineEsEnv(), defineNodeEnv()]) {
      for (const [key, value] of Object.entries(def.globals)) {
        allGlobals[key] = value;
        globalEnv.bind(key, value);
      }
      if (def.modules) {
        for (const [modName, exports] of Object.entries(def.modules)) {
          allModules[modName] = { ...allModules[modName], ...exports };
        }
      }
    }
    return {
      modules: allModules,
      globals: allGlobals,
      stats: {
        files: 0,
        symbols: Object.keys(allGlobals).length,
        skipped: 0,
      },
    };
  } catch {
    return null;
  }
}

function degradeToHandwritten(
  error: string,
  reason: "not-found" | "no-dts" | "failed",
  cached = false,
): NodeEnvResult {
  const env = handwrittenNodeEnv();
  if (env) {
    return {
      ok: true,
      env,
      root: "@nudojs/env",
      files: 0,
      stats: env.stats,
      cached,
      degraded: true,
    };
  }
  return { ok: false, error, reason, ...(cached ? { cached: true } : {}) };
}

/**
 * harvest @types/node（限制文件数 + 时间预算，避免拖垮启动）。
 * Success **and** terminal failures (`not-found` / `no-dts` / `failed`) are
 * cached in-process so IDE analysis does not re-walk / re-timeout every file.
 * `disabled` is never cached — the env var can flip mid-process.
 * Call `clearNodeHarvestCache()` after `@types/node` changes.
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
    const missKey = notFoundCacheKey(fromDir);
    const miss = nodeHarvestCache.get(missKey);
    if (miss) {
      return miss.ok
        ? { ...miss, cached: true }
        : { ...miss, cached: true };
    }
    // B2 降级：@types/node 缺失 → 手写 node env
    const result = degradeToHandwritten("@types/node not found", "not-found");
    nodeHarvestCache.set(missKey, result);
    return result;
  }
  const key = nodeHarvestCacheKey(root, maxFiles, maxMs);
  const hit = nodeHarvestCache.get(key);
  if (hit) {
    return hit.ok ? { ...hit, cached: true } : { ...hit, cached: true };
  }
  // 优先 index.d.ts 等入口
  const dts = collectDtsFiles(root, maxFiles);
  if (dts.length === 0) {
    const result = degradeToHandwritten(`no .d.ts under ${root}`, "no-dts");
    nodeHarvestCache.set(key, result);
    return result;
  }

  // B2 磁盘层：HarvestJson 跨会话复用（键含 dts 内容哈希）
  const diskRoot = depsCacheRoot();
  const dtsHash = dtsClosureHash(dts);
  const pkgVersion = readPkgVersion(root);
  const diskKey = harvestCacheKey("@types/node", {
    dtsHash,
    maxFiles,
    ...(pkgVersion !== undefined ? { pkgVersion } : {}),
  });
  if (diskRoot) {
    const diskHit = readHarvestDisk(diskRoot, diskKey);
    const env = diskHit ? materializeHarvestJson(diskHit) : null;
    if (env) {
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
        cached: true,
      };
      nodeHarvestCache.set(key, result);
      return result;
    }
  }

  try {
    const env = harvestDts(dts, { maxMs });
    const stats: HarvestNodeStats = {
      files: env.stats.files,
      symbols: env.stats.symbols,
      skipped: env.stats.skipped,
    };
    if (diskRoot) {
      writeHarvestDisk(
        diskRoot,
        diskKey,
        serializeHarvestJson("@types/node", env, {
          dtsHash,
          maxFiles,
          ...(pkgVersion !== undefined ? { pkgVersion } : {}),
        }),
      );
    }
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
    // B2 降级：harvest 失败 → 手写 node env
    const result = degradeToHandwritten(
      `harvest failed: ${(e as Error).message}`,
      "failed",
    );
    nodeHarvestCache.set(key, result);
    return result;
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
