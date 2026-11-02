/**
 * Per-function FunctionAnalysis cache (body-edit: recompute only dirty fns).
 * Cleared together with evaluator / whole-file analysis caches.
 *
 * Keys are `filePath\0…`; the filePath segment is normalized through
 * `stablePathKey` so `/c:/x` / `c:\x` / `file:///c:/x` share one entry with
 * `c:/x` (FIX-RESIDUAL-4 — same identity as analysis-file-cache / L0 memo).
 */
import type { Abs } from "@nudojs/core";
import { BoundedLruMap, stablePathKey } from "@nudojs/core/internal";
// 单一真值源：analysis 面直接取 analyzer-types 的 FunctionAnalysis（此前
// 手工镜像全字段，已两次漂移：externalEvidence / CaseResult.source）。
// 两处均为 types-only 导入——emit 后消失，本模块运行时仍是叶子（不环入
// analyzer / evaluator）。
import type { CaseHint, Diagnostic, FunctionAnalysis } from "./analyzer-types.ts";
import type { CallRecord } from "./evaluator/call-record.ts";
import { getSessionCacheLimits } from "./session-cache-limits.ts";

export type CachedFnAnalysis = {
  /** cloneFunctionAnalysis 的深拷贝产物——形状即 FunctionAnalysis，同源同步 */
  analysis: FunctionAnalysis;
  diagnostics: Diagnostic[];
  caseHints: CaseHint[];
  // CallRecord opaque; cloned shallowly. Position fields that need lineDelta
  // shift (currently only callLoc) are listed on CallRecord in
  // evaluator/call-record.ts — keep shiftCallRecordLines in sync when adding
  // any.
  callRecords: CallRecord[];
};

const fnAnalysisCache = new BoundedLruMap<CachedFnAnalysis>(getSessionCacheLimits().maxFns);

/** 键首段（filePath）过 stablePathKey：跨盘符形态命中/逐出一致 */
function normalizeFnCacheKey(key: string): string {
  const i = key.indexOf("\0");
  const filePath = i < 0 ? key : key.slice(0, i);
  const rest = i < 0 ? "" : key.slice(i);
  return stablePathKey(filePath) + rest;
}

/** 测试/诊断：当前条目数（≤ getSessionCacheLimits().maxFns） */
export function getFnAnalysisCacheSize(): number {
  return fnAnalysisCache.size;
}

export function clearFnAnalysisCache(): void {
  fnAnalysisCache.clear();
}

/** 立刻压到当前 maxFns（调低上限时收内存） */
export function trimFnAnalysisCache(): void {
  fnAnalysisCache.setMax(getSessionCacheLimits().maxFns);
}

export function fnAnalysisCacheGet(key: string): CachedFnAnalysis | undefined {
  // 0 = 关闭：读路径也 miss（上限可动态调低而未触发 trim，条目仍在表里）
  if (getSessionCacheLimits().maxFns <= 0) return undefined;
  // BoundedLruMap.get：命中刷新 MRU
  return fnAnalysisCache.get(normalizeFnCacheKey(key));
}

export function fnAnalysisCacheSet(key: string, value: CachedFnAnalysis): void {
  const max = getSessionCacheLimits().maxFns;
  if (max <= 0) return;
  // 上限动态（env / 显式层随时可变）：写前对齐（setMax 幂等，顺带压超限）
  fnAnalysisCache.setMax(max);
  fnAnalysisCache.set(normalizeFnCacheKey(key), value);
}

/**
 * Dependency content changed: drop every per-fn entry for these entry files.
 * Keys are `filePath\0...`, so a prefix scan is sound and cheap at LRU size.
 * Prefixes go through `stablePathKey` — same identity as get/set.
 */
export function evictFnAnalysisCacheForFiles(files: string[]): number {
  if (files.length === 0 || fnAnalysisCache.size === 0) return 0;
  const prefixes = files.map((f) => `${stablePathKey(f)}\0`);
  let n = 0;
  for (const key of [...fnAnalysisCache.keys()]) {
    if (prefixes.some((p) => key.startsWith(p))) {
      fnAnalysisCache.delete(key);
      n++;
    }
  }
  return n;
}

export function caseDirectiveKey(
  directives: Array<{ kind: string; name?: string; argsAbs?: Abs[] }>,
  formatAbs: (a: Abs) => string,
): string {
  return directives
    .map((d) => {
      if (d.kind === "case") {
        const args = (d.argsAbs ?? []).map((a) => formatAbs(a)).join(",");
        return `c:${d.name ?? ""}:${args}`;
      }
      return d.kind;
    })
    .join("|");
}
