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
import { getSessionCacheLimits } from "./session-cache-limits.ts";

// Structural types — avoid importing analyzer (cycle).
export type CachedSourceLocation = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

export type CachedDiagnostic = {
  range: CachedSourceLocation;
  severity: "error" | "warning" | "info";
  message: string;
  tags?: string[];
  code?: string;
  suggestions?: string[];
  data?: unknown;
  origin?: { line: number; column: number };
};

export type CachedCaseHint = {
  line: number;
  label: string;
  ok: boolean;
};

export type CachedCallRecord = {
  // opaque; cloned shallowly. Position fields that need lineDelta shift
  // (currently only callLoc) are listed on CallRecord in evaluator.ts —
  // keep shiftCallRecordLines in sync when adding any.
  [k: string]: unknown;
};

export type CachedFnAnalysis = {
  analysis: {
    name: string;
    loc: CachedSourceLocation;
    paramNames: string[];
    cases: Array<{
      name: string;
      argAbs: Abs[];
      abs: Abs;
      throwsAbs: Abs;
      throwLoc?: CachedSourceLocation;
      source?: string;
      expected?: Abs;
      aggregatedFrom?: number;
      intension?: Record<string, unknown>;
    }>;
    combinedAbs?: Abs;
    entryOnly?: boolean;
    skipped?: boolean;
    noDeclaration?: boolean;
    fromModule?: string;
    hof?: {
      fnRels?: Array<{ param: string; abs: Abs }>;
      entryShapes?: Array<{ param: string; abs: Abs }>;
      symbolic?: Abs;
    };
    /** C4.1 formal param surface（draft 解构槽依赖；与 cloneFunctionAnalysis 同步） */
    formals?: Array<{
      kind: string;
      name?: string;
      display?: string;
      placeholder?: string;
      bound?: string[];
      propKey?: Record<string, string>;
      nested?: string[];
      index: number;
    }>;
  };
  diagnostics: CachedDiagnostic[];
  caseHints: CachedCaseHint[];
  callRecords: CachedCallRecord[];
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
