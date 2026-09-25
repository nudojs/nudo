/**
 * 会话缓存失效入口（宿主契约的唯一接线点）。
 * 契约文档：docs/design/cache-invalidation.md；测试锚 cache-invalidation-contract.test.ts。
 *
 * 内容指纹已进 analysisFileCacheKey / bpath depKey / fnDepSeg（常规编辑自然 miss）；
 * 宿主主动逐出仍是义务——path-env 进程全局须清、abs-module 的 mtime+size 指纹
 * 盖不住「同 size + 同 mtime」编辑、自定义 loader / 截断指纹需要安全网。
 * LSP 走定向逐出；CLI watch / vite-plugin 走这里。
 */
import {
  resetGeneralizeMemo,
  resetCheckSourceMemo,
  resetNudoModuleExecCache,
  resetParseSourceCache,
} from "@nudojs/core";
import { clearAbsModuleCache, evictAbsModuleCacheFiles } from "./abs-modules-graph.ts";
import { clearBPathCache, evictBPathCacheForFiles, trimBPathCache } from "./bpath-run.ts";
import {
  clearAnalysisFileCache,
  evictAnalysisFileCacheForFiles,
  trimAnalysisFileCache,
} from "./analysis-file-cache.ts";
import {
  clearFnAnalysisCache,
  evictFnAnalysisCacheForFiles,
  trimFnAnalysisCache,
} from "./fn-analysis-cache.ts";
import { clearPathEnvCaches } from "./evaluator/env-loader.ts";
import {
  getSessionCacheLimits,
  setSessionCacheFromProject,
  type SessionCacheLimits,
} from "./session-cache-limits.ts";
import type { NudoConfig } from "./evaluator/config.ts";

/**
 * 依赖内容变更后：按入口文件定向逐出 service 层缓存。
 * 调用方应传「以这些文件为入口」的路径（脏集里的 dependents），
 * 而不是变更的 dep 文件本身——dep 自己 source 变了会自然 miss。
 * 残余缺口：absModuleCache 按 dep 路径 + mtime/size 键控；「同 size + 同 mtime」
 * 编辑需再 evictAbsModuleCacheFiles([depPath]) 或 clearAnalysisSessionCaches。
 */
export function evictAnalysisCachesForFiles(files: string[]): void {
  if (files.length === 0) return;
  evictBPathCacheForFiles(files);
  evictAnalysisFileCacheForFiles(files);
  evictFnAnalysisCacheForFiles(files);
  evictAbsModuleCacheFiles(files);
  // path-env factory 进程全局且 sync analyze 不 mtime 失效：定向逐出若不
  // 清它，新 dep-hash 键会被旧 defineEnv 投毒（只 follow evictForDependents
  // 的宿主契约必须安全）。下次 async preload 会按 mtime 重建。
  clearPathEnvCaches();
}

/**
 * 清空全部会话级分析缓存（service + core）。
 * 适用于：CLI watch 增量批前、vite buildStart / watchChange、测试隔离。
 * 比定向逐出重，但保证无陈旧命中；单次 analyze 内部的 per-fn / generalize
 * memo 不受影响（它们在同一轮里先写后读）。
 */
export function clearAnalysisSessionCaches(): void {
  clearBPathCache(); // cascades analysis-file + fn-analysis
  clearAbsModuleCache();
  clearPathEnvCaches();
  resetGeneralizeMemo();
  resetCheckSourceMemo();
  resetNudoModuleExecCache();
}

/**
 * 接线 package.json#nudo.sessionCache（进程内 LRU 上限）并立刻 trim。
 * env `NUDO_CACHE_MAX_FILES|FNS|BRUNS` 仍优先（多项目内存封顶）。
 */
export function applySessionCacheConfig(config: NudoConfig | null | undefined): SessionCacheLimits {
  setSessionCacheFromProject(config?.sessionCache);
  const limits = getSessionCacheLimits();
  trimAnalysisFileCache();
  trimFnAnalysisCache();
  trimBPathCache();
  return limits;
}

/** 比 clearAnalysisSessionCaches 更彻底：再丢 AST LRU（测试 / 进程复用场景） */
export function resetAllAnalysisCaches(): void {
  clearAnalysisSessionCaches();
  resetParseSourceCache();
}
