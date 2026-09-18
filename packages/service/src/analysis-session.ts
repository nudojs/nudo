/**
 * B5：workspace 级 AnalysisSession——LSP 与 CLI（同进程）共享的分析 memo 面。
 *
 * core/service 的 analyzeFile / B-path / generalize / checkSource 都是
 * 进程级模块缓存；本模块把「清空 / 定向逐出 / 依赖变更」收成一个显式
 * session 对象，避免宿主各接一套失效逻辑，也便于测试隔离。
 *
 * 宿主契约：
 * - 依赖内容变更 → `session.evictForDependents(files)`
 * - 全量重置（watch 批前 / vite buildStart）→ `session.clear()`
 * - LSP validate 与 agent check/hover/interface 在同一进程共用默认 session
 */

import {
  evictAnalysisCachesForFiles,
  clearAnalysisSessionCaches,
  resetAllAnalysisCaches,
} from "./session-cache.ts";
import { analyzeFile, type AnalysisResult } from "./analyzer.ts";

export type AnalysisSession = {
  /** 依赖变更：按「以这些文件为入口」的路径定向逐出 */
  evictForDependents(files: string[]): void;
  /** 清空 service+core 会话 memo（不含 AST LRU） */
  clear(): void;
  /** 彻底重置（含 AST LRU） */
  reset(): void;
  /**
   * 与 analyzeFile 同源，但强制走本 session 的 memo（进程内默认即共享）。
   * LSP / CLI / agent 工具都应调用这里，而不是旁路第二套缓存。
   */
  analyze(
    filePath: string,
    source: string,
    activeCases?: Map<string, number>,
    externalCallRecords?: unknown,
  ): AnalysisResult;
};

function createDefaultSession(): AnalysisSession {
  return {
    evictForDependents(files: string[]): void {
      evictAnalysisCachesForFiles(files);
    },
    clear(): void {
      clearAnalysisSessionCaches();
    },
    reset(): void {
      resetAllAnalysisCaches();
    },
    analyze(filePath, source, activeCases, externalCallRecords) {
      return analyzeFile(
        filePath,
        source,
        activeCases,
        externalCallRecords as never,
      );
    },
  };
}

let defaultSession: AnalysisSession | undefined = undefined;

/** 进程内默认 AnalysisSession（LSP server / CLI watch / agent tools 共用） */
export function getAnalysisSession(): AnalysisSession {
  if (!defaultSession) defaultSession = createDefaultSession();
  return defaultSession;
}

/** 测试：替换默认 session（返回旧值以便恢复） */
export function setAnalysisSession(session: AnalysisSession | undefined): AnalysisSession | undefined {
  const prev = defaultSession;
  defaultSession = session;
  return prev;
}
