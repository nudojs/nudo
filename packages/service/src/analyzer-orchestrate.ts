/**
 * orchestrate：analyzeFile / analyzeFileAsync / collectCallRecords 主编排。
 * 自 analyzer.ts 机械拆出；语义未改。
 *
 * 职责已按缝拆出（机械搬移，语义未改）：
 *   - analyzer-orchestrate-calls.ts     env 名收集 + 调用点发现
 *   - analyzer-orchestrate-uncached.ts  analyzeFileUncached / UncachedInner
 */
import { dirname } from "node:path";
import { findProjectConfig, interfaceConfig, analysisConfig } from "./evaluator/config.ts";
import { noteEnvPathDeps } from "./env-path-deps.ts";
import { preloadPathEnvs } from "./evaluator/env-loader.ts";
import { analysisCacheGet, analysisCacheSet } from "./analysis-file-cache.ts";
import { analysisFileCacheKey, cloneAnalysisResult } from "./analyzer-cache.ts";
import type {
  AnalysisResult,
  AnalyzeLoadModule,
  DirectiveCaseMode,
} from "./analyzer-types.ts";
import type { CallRecord } from "./evaluator/call-record.ts";
import { collectEnvNames } from "./analyzer-orchestrate-calls.ts";
import { analyzeFileUncached } from "./analyzer-orchestrate-uncached.ts";

export { collectEnvNames, collectCallRecords, expandTestCallbacks } from "./analyzer-orchestrate-calls.ts";
export {
  analyzeFileUncached,
  analyzeFileUncachedInner,
} from "./analyzer-orchestrate-uncached.ts";

/**
 * Async entry to analyzeFile: preloads path-based env files
 * (`/// @nudo:env ./nudo-harvest-node.ts`) via dynamic import — impossible
 * synchronously in ESM — then runs the sync analysis, which picks the
 * preloaded factories up from the env-loader cache.
 * `loadModule` is optional; when provided it is used for relative imports /
 * sidecar ambient bindings (LSP buffer-aware path). Default remains
 * `defaultLoadModule` (disk).
 */
export async function analyzeFileAsync(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: AnalyzeLoadModule,
  /** 默认 all（库/测试兼容）；check/IDE 宿主应传 none（惰性 case） */
  caseMode: DirectiveCaseMode = "all",
): Promise<AnalysisResult> {
  const envNames = collectEnvNames(filePath, source, true);
  // path-based @nudo:env / mock-module 反向边（watch 失效）
  noteEnvPathDeps(filePath, source);
  if (envNames.length > 0) {
    await preloadPathEnvs(envNames, dirname(filePath));
  }
  return analyzeFile(filePath, source, activeCases, externalCallRecords, loadModule, caseMode);
}

/**
 * 整文件分析。同 (path, source, cases, external) 命中 memo → O(1)。
 * 不再每次 clearBPathCache：B 路径按本文件 source 键控。
 *
 * `loadModule`：可选；提供时用于相对 import / 侧车 ambient（LSP
 * buffer-aware）。未提供时走 defaultLoadModule（磁盘）。
 *
 * 宿主契约：入口 source 未变但依赖模块内容变了时，必须调用
 * `evictBPathCacheForFiles` / `evictAnalysisFileCacheForFiles` /
 * `evictFnAnalysisCacheForFiles`（LSP 已接好）。非 LSP 宿主
 * （CLI watch / vite-plugin）在 dep 变更时应 `clearBPathCache()` 或上述逐出。
 */
export function analyzeFile(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: AnalyzeLoadModule,
  caseMode: DirectiveCaseMode = "all",
): AnalysisResult {
  const projectConfig = findProjectConfig(dirname(filePath));
  const cfg = analysisConfig(projectConfig?.config);
  const projectEnvNames = projectConfig?.config.env ?? [];
  const autoBind = interfaceConfig(projectConfig?.config).autoBind;
  const k = analysisFileCacheKey(
    filePath,
    source,
    activeCases,
    externalCallRecords,
    cfg,
    loadModule,
    projectEnvNames,
    autoBind !== false,
    caseMode,
  );
  if (!k.noCache) {
    const hit = analysisCacheGet<AnalysisResult>(k.filePath, k.source, k.auxKey);
    if (hit !== undefined) {
      return cloneAnalysisResult(hit);
    }
  }
  const result = analyzeFileUncached(
    filePath,
    source,
    activeCases,
    externalCallRecords,
    loadModule,
    caseMode,
  );
  if (!k.noCache) {
    analysisCacheSet(k.filePath, k.source, k.auxKey, result);
  }
  return cloneAnalysisResult(result);
}

