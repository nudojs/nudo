/**
 * Per-function FunctionAnalysis cache (body-edit: recompute only dirty fns).
 * Cleared together with evaluator / whole-file analysis caches.
 *
 * Keys are `filePath\0…`; the filePath segment is normalized through
 * `stablePathKey` so `/c:/x` / `c:\x` / `file:///c:/x` share one entry with
 * `c:/x` (FIX-RESIDUAL-4 — same identity as analysis-file-cache / L0 memo).
 */
import type { Abs } from "@nudojs/core";
import { stablePathKey } from "@nudojs/core/internal";
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

const fnAnalysisCache = new Map<string, CachedFnAnalysis>();

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
  const max = getSessionCacheLimits().maxFns;
  while (fnAnalysisCache.size > max) {
    const oldest = fnAnalysisCache.keys().next().value;
    if (oldest === undefined) break;
    fnAnalysisCache.delete(oldest);
  }
}

export function fnAnalysisCacheGet(key: string): CachedFnAnalysis | undefined {
  // 0 = 关闭：读路径也 miss（与 BoundedLruMap max<=0 口径一致）
  if (getSessionCacheLimits().maxFns <= 0) return undefined;
  const k = normalizeFnCacheKey(key);
  const hit = fnAnalysisCache.get(k);
  if (hit !== undefined) {
    fnAnalysisCache.delete(k);
    fnAnalysisCache.set(k, hit);
  }
  return hit;
}

export function fnAnalysisCacheSet(key: string, value: CachedFnAnalysis): void {
  const max = getSessionCacheLimits().maxFns;
  if (max <= 0) return;
  const k = normalizeFnCacheKey(key);
  // Only evict when inserting a new key; overwrite of an existing key keeps LRU size
  while (fnAnalysisCache.size >= max && !fnAnalysisCache.has(k)) {
    const oldest = fnAnalysisCache.keys().next().value;
    if (oldest === undefined) break;
    fnAnalysisCache.delete(oldest);
  }
  // 覆盖已有键先 delete 再 set：刷新为最近使用（与 BoundedLruMap.set 一致）
  fnAnalysisCache.delete(k);
  fnAnalysisCache.set(k, value);
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
