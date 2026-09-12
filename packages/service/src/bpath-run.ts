/**
 * B 路径能力判定 + 进程内 transpile 执行（service 入口）。
 */

import {
  runTranspiled,
  callTranspiledExport,
  type Abs,
  type AbsModuleExports,
} from "@nudojs/core";
import { evalAbsModuleGraph } from "./abs-modules-graph.ts";

/** 可走 transpile+exec 子集：无 class/async/await/this./require/@nudo:env */
export function isBPathCapable(source: string, envNames: string[] = []): boolean {
  if (envNames.length > 0) return false;
  if (/\brequire\s*\(/.test(source)) return false;
  if (/\bclass\s+[A-Za-z_$]/.test(source)) return false;
  if (/\basync\s+function\b|\basync\s*\(/.test(source)) return false;
  if (/\bawait\s+/.test(source)) return false;
  if (/\bthis\s*\./.test(source)) return false;
  return true;
}

export type BPathRunResult = {
  exports: Record<string, unknown>;
  modules: Record<string, AbsModuleExports>;
};

/**
 * 模块图 + runTranspiled：返回可调用导出。
 * 失败返回 undefined（调用方回退 ast-eval / TypeValue）。
 */
export function tryRunBPath(
  source: string,
  filePath: string,
  opts: { maxLoopIters?: number } = {},
): BPathRunResult | undefined {
  if (!isBPathCapable(source)) return undefined;
  try {
    const { modules } = evalAbsModuleGraph(source, filePath);
    const exports = runTranspiled(source, {
      modules: modules as never,
      maxLoopIters: opts.maxLoopIters,
    });
    return { exports, modules };
  } catch {
    return undefined;
  }
}

/** B 路径求值具名导出函数 */
export function tryBPathCall(
  source: string,
  filePath: string,
  fnName: string,
  args: Abs[],
): Abs | undefined {
  const run = tryRunBPath(source, filePath);
  if (!run) return undefined;
  if (!(fnName in run.exports)) return undefined;
  const r = callTranspiledExport(run.exports, fnName, args);
  if (!r) return undefined;
  // 与 tryEvalAbsRaw 一致：unknown 无 term 视为失败
  if (r.shape.k === "unknown" && !r.term) return undefined;
  return r;
}
