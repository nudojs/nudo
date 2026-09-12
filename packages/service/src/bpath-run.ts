/**
 * B 路径能力判定 + 进程内 transpile 执行（service 入口）。
 *
 * 分析默认 mode="analyze"：不执行顶层副作用，只保留函数定义。
 * throws 经 callTranspiledExportFull 捕获 $throw。
 */

import {
  runTranspiled,
  callTranspiledExport,
  callTranspiledExportFull,
  setBCallCollector,
  type BCallRecord,
  type TranspiledCallResult,
  type Abs,
  type AbsModuleExports,
} from "@nudojs/core";
import { evalAbsModuleGraph } from "./abs-modules-graph.ts";

/** 可走 transpile+exec：无 require/@nudo:env；class/async 已支持 */
export function isBPathCapable(source: string, envNames: string[] = []): boolean {
  if (envNames.length > 0) return false;
  if (/\brequire\s*\(/.test(source)) return false;
  // 顶层 this. 仍不支持（方法内 this 由 transpile 处理）
  if (/(^|[^.\w$])this\s*\./.test(source) && !/\bclass\s+/.test(source)) return false;
  return true;
}

export type BPathRunResult = {
  exports: Record<string, unknown>;
  modules: Record<string, AbsModuleExports>;
};

const bRunCache = new Map<string, BPathRunResult | null>();

export function clearBPathCache(): void {
  bRunCache.clear();
}

/** 模块图 + runTranspiled（默认 analyze 模式） */
export function tryRunBPath(
  source: string,
  filePath: string,
  opts: { maxLoopIters?: number; mode?: "exec" | "analyze" } = {},
): BPathRunResult | undefined {
  if (!isBPathCapable(source)) return undefined;
  const key = `${filePath}::${source.length}::${source.slice(0, 200)}::${opts.mode ?? "analyze"}`;
  if (bRunCache.has(key)) return bRunCache.get(key) ?? undefined;
  let out: BPathRunResult | null = null;
  try {
    const { modules } = evalAbsModuleGraph(source, filePath);
    const exports = runTranspiled(source, {
      modules: modules as never,
      maxLoopIters: opts.maxLoopIters,
      mode: opts.mode ?? "analyze",
    });
    out = { exports, modules };
  } catch {
    out = null;
  }
  bRunCache.set(key, out);
  return out ?? undefined;
}

/** B 路径求值具名导出（结果 + throws）；opts.collectCalls 时附带调用点记录 */
export function tryBPathCallFull(
  source: string,
  filePath: string,
  fnName: string,
  args: Abs[],
  opts: { collectCalls?: boolean } = {},
): (TranspiledCallResult & { calls?: BCallRecord[] }) | undefined {
  const run = tryRunBPath(source, filePath);
  if (!run) return undefined;
  if (!(fnName in run.exports)) return undefined;
  const collected: BCallRecord[] = [];
  if (opts.collectCalls) {
    setBCallCollector((r) => collected.push(r));
  }
  try {
    const full = callTranspiledExportFull(run.exports, fnName, args);
    return opts.collectCalls ? { ...full, calls: collected } : full;
  } finally {
    if (opts.collectCalls) setBCallCollector(null);
  }
}

/** B 路径求值具名导出（仅成功结果） */
export function tryBPathCall(
  source: string,
  filePath: string,
  fnName: string,
  args: Abs[],
): Abs | undefined {
  const full = tryBPathCallFull(source, filePath, fnName, args);
  if (!full) return undefined;
  const r = full.result;
  if (!r) return undefined;
  if (r.shape.k === "never" && full.throws.shape.k !== "never") {
    return undefined;
  }
  if (r.shape.k === "unknown" && !r.term) return undefined;
  return r;
}

export { callTranspiledExport, callTranspiledExportFull };
