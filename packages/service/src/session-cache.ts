/**
 * 会话缓存失效入口（宿主契约的唯一接线点）。
 *
 * analyzeFile / tryRunBPath / generalize L0 的键都不含「依赖模块内容」——
 * 入口 source 未变但 dep 变了时，必须由宿主主动逐出，否则会命中陈旧结果。
 * LSP 走定向逐出；CLI watch / vite-plugin 走这里。
 */
import {
  resetGeneralizeMemo,
  resetCheckSourceMemo,
  resetNudoModuleExecCache,
  resetParseSourceCache,
} from "@nudojs/core";
import { clearAbsModuleCache, evictAbsModuleCacheFiles } from "./abs-modules-graph.ts";
import { clearBPathCache, evictBPathCacheForFiles } from "./bpath-run.ts";
import { clearAnalysisFileCache, evictAnalysisFileCacheForFiles } from "./analysis-file-cache.ts";
import { clearFnAnalysisCache, evictFnAnalysisCacheForFiles } from "./fn-analysis-cache.ts";
import { clearPathEnvCaches } from "./evaluator/env-loader.ts";

/**
 * 依赖内容变更后：按入口文件定向逐出 service 层缓存。
 * 调用方应传「以这些文件为入口」的路径（脏集里的 dependents），
 * 而不是变更的 dep 文件本身——dep 自己 source 变了会自然 miss。
 */
export function evictAnalysisCachesForFiles(files: string[]): void {
  if (files.length === 0) return;
  evictBPathCacheForFiles(files);
  evictAnalysisFileCacheForFiles(files);
  evictFnAnalysisCacheForFiles(files);
  evictAbsModuleCacheFiles(files);
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

/** 比 clearAnalysisSessionCaches 更彻底：再丢 AST LRU（测试 / 进程复用场景） */
export function resetAllAnalysisCaches(): void {
  clearAnalysisSessionCaches();
  resetParseSourceCache();
}
