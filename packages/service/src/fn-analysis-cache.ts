/**
 * Per-function FunctionAnalysis cache (body-edit: recompute only dirty fns).
 * Cleared together with B-path / whole-file analysis caches.
 */
import type { TypeValue } from "@nudojs/core";

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
  // opaque; cloned shallowly
  [k: string]: unknown;
};

export type CachedFnAnalysis = {
  analysis: {
    name: string;
    loc: CachedSourceLocation;
    paramNames: string[];
    cases: Array<{
      name: string;
      args: TypeValue[];
      result: TypeValue;
      throws: TypeValue;
      throwLoc?: CachedSourceLocation;
      source?: string;
      expected?: TypeValue;
      aggregatedFrom?: number;
      intension?: Record<string, unknown>;
    }>;
    combined?: TypeValue;
    entryOnly?: boolean;
    skipped?: boolean;
    noDeclaration?: boolean;
    fromModule?: string;
  };
  diagnostics: CachedDiagnostic[];
  caseHints: CachedCaseHint[];
  callRecords: CachedCallRecord[];
};

const fnAnalysisCache = new Map<string, CachedFnAnalysis>();
const MAX_FN_ANALYSIS_CACHE = 1024;

export function clearFnAnalysisCache(): void {
  fnAnalysisCache.clear();
}

export function fnAnalysisCacheGet(key: string): CachedFnAnalysis | undefined {
  const hit = fnAnalysisCache.get(key);
  if (hit !== undefined) {
    fnAnalysisCache.delete(key);
    fnAnalysisCache.set(key, hit);
  }
  return hit;
}

export function fnAnalysisCacheSet(key: string, value: CachedFnAnalysis): void {
  // Only evict when inserting a new key; overwrite of an existing key keeps LRU size
  if (fnAnalysisCache.size >= MAX_FN_ANALYSIS_CACHE && !fnAnalysisCache.has(key)) {
    const oldest = fnAnalysisCache.keys().next().value;
    if (oldest !== undefined) fnAnalysisCache.delete(oldest);
  }
  fnAnalysisCache.set(key, value);
}

/**
 * Dependency content changed: drop every per-fn entry for these entry files.
 * Keys are `filePath\0...`, so a prefix scan is sound and cheap at LRU size.
 */
export function evictFnAnalysisCacheForFiles(files: string[]): number {
  if (files.length === 0 || fnAnalysisCache.size === 0) return 0;
  const prefixes = files.map((f) => `${f}\0`);
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
  directives: Array<{ kind: string; name?: string; args?: TypeValue[] }>,
  typeValueToString: (t: TypeValue) => string,
): string {
  return directives
    .map((d) => {
      if (d.kind === "case") {
        const args = (d.args ?? []).map((a) => typeValueToString(a)).join(",");
        return `c:${d.name ?? ""}:${args}`;
      }
      return d.kind;
    })
    .join("|");
}
