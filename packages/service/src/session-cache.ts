/**
 * 会话缓存失效入口（宿主契约的唯一接线点）。
 * 契约文档：docs/design/cache-invalidation.md；测试锚 cache-invalidation-contract.test.ts。
 *
 * 内容指纹已进 analysisFileCacheKey / eval depKey / fnDepSeg / abs-module 子树
 * 指纹（常规编辑——含传递依赖——自然 miss，DESIGN-002）；宿主主动逐出仍是义务
 * ——path-env 进程全局须清、abs-module 条目**自身**的 mtime+size 指纹盖不住
 * 「同 size + 同 mtime」编辑、自定义 loader / 截断指纹需要安全网。
 * LSP 走定向逐出；CLI watch / vite-plugin 走这里。
 */
import {
  resetGeneralizeMemo,
  resetCheckSourceMemo,
  resetNudoModuleExecCache,
  resetParseSourceCache,
} from "@nudojs/core";
import { clearPureCallMemo, clearPureMemo } from "@nudojs/core/internal";
import { clearAbsModuleCache, evictAbsModuleCacheFiles } from "./abs-modules-graph.ts";
import { clearEvalCache, evictEvalCacheForFiles, trimEvalCache } from "./eval-run.ts";
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
import { evictProjectConfigMemo } from "./evaluator/config.ts";
import {
  getSessionCacheLimits,
  setSessionCacheFromProject,
  type SessionCacheLimits,
} from "./session-cache-limits.ts";
import type { NudoConfig } from "./evaluator/config.ts";

/**
 * 依赖内容变更后：按入口文件定向逐出 service 层缓存。
 * 调用方应传「以这些文件为入口」的路径（脏集里的 dependents），
 * 而不是变更的 dep 文件本身——dep 自己 source 变了会自然 miss；
 * 中间模块的传递依赖变更由 absModuleCache 条目自带的子树内容指纹
 * 复核兜住（DESIGN-002），宿主无需逐出中间模块。
 * 残余缺口：absModuleCache 条目自身仍按 mtime/size 键控——「同 size + 同 mtime」
 * 编辑需再 evictAbsModuleCacheFiles([depPath]) 或 clearAnalysisSessionCaches。
 */
export function evictAnalysisCachesForFiles(files: string[]): void {
  if (files.length === 0) return;
  evictEvalCacheForFiles(files);
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
  clearEvalCache(); // cascades analysis-file + fn-analysis
  clearAbsModuleCache();
  clearPathEnvCaches();
  // findProjectConfig 目录链 memo（mtime 自校验；显式清覆盖「同 size+同 mtime」写入）
  evictProjectConfigMemo();
  resetGeneralizeMemo();
  resetCheckSourceMemo();
  resetNudoModuleExecCache();
  // pure memo 同会话生命周期（防 LSP 长会话无界膨胀）
  clearPureMemo();
  clearPureCallMemo();
}

/**
 * 接线 package.json#nudo.sessionCache（进程内 LRU 上限）并立刻 trim。
 * 优先级：显式 setSessionCacheLimits > env `NUDO_CACHE_MAX_FILES|FNS|EVALRUNS`
 * > 此层 > 默认（见 session-cache-limits）。
 */
export function applySessionCacheConfig(config: NudoConfig | null | undefined): SessionCacheLimits {
  setSessionCacheFromProject(config?.sessionCache);
  const limits = getSessionCacheLimits();
  trimAnalysisFileCache();
  trimFnAnalysisCache();
  trimEvalCache();
  return limits;
}

/** 比 clearAnalysisSessionCaches 更彻底：再丢 AST LRU（测试 / 进程复用场景） */
export function resetAllAnalysisCaches(): void {
  clearAnalysisSessionCaches();
  resetParseSourceCache();
}
