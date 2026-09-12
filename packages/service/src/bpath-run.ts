/**
 * B 路径能力判定 + 进程内 transpile 执行（service 入口）。
 *
 * 约束：runTranspiled 会执行模块顶层（副作用可能触发）。
 * analyzeFile 不得用 B 路径短路 evaluateFunctionFull——
 * throws / unreachable / builtin-unknown 诊断依赖 TypeValue 路径。
 * B 路径用于 case 结果润色（tryEvalAbsRaw 优先）与 call@ Abs 记录。
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

/** 同文件多次 case/call 共享一次 transpile */
const bRunCache = new Map<string, BPathRunResult | null>();

export function clearBPathCache(): void {
  bRunCache.clear();
}

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
  const key = `${filePath}::${source.length}::${source.slice(0, 200)}`;
  if (bRunCache.has(key)) return bRunCache.get(key) ?? undefined;
  let out: BPathRunResult | null = null;
  try {
    const { modules } = evalAbsModuleGraph(source, filePath);
    const exports = runTranspiled(source, {
      modules: modules as never,
      maxLoopIters: opts.maxLoopIters,
    });
    out = { exports, modules };
  } catch {
    out = null;
  }
  bRunCache.set(key, out);
  return out ?? undefined;
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
  if (r.shape.k === "unknown" && !r.term) return undefined;
  return r;
}
