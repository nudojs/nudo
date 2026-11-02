/**
 * 整文件 AnalysisResult 会话缓存（service 层，泛型避免与 analyzer 环依赖）。
 *
 * 按 filePath 键控 + source 字符串相等比较：
 * - LSP 同一 buffer 复用 getText() 同一字符串 → SameValueZero O(1)
 * - 编辑后 source 变化 → miss，覆盖旧条目（每文件一份，内存有界）
 * 与 evaluator 缓存同生命周期：宿主清 evaluator 时一并失效。
 * 上限可配（session-cache-limits：多项目内存封顶 / 大仓调高）。
 *
 * 键统一走 `stablePathKey`：`/c:/x` / `c:\x` / `file:///c:/x` 与 `c:/x`
 * 同键命中/逐出（FIX-RESIDUAL-4；与 L0 memo / computeDirtySet 同口径）。
 */
import { BoundedLruMap, stablePathKey } from "@nudojs/core/internal";
import { getSessionCacheLimits } from "./session-cache-limits.ts";

type Entry = {
  source: string;
  auxKey: string;
  value: unknown;
};

const analysisByFile = new BoundedLruMap<Entry>(getSessionCacheLimits().maxFiles);

export function clearAnalysisFileCache(): void {
  analysisByFile.clear();
}

export function getAnalysisFileCacheSize(): number {
  return analysisByFile.size;
}

/** 立刻压到当前 maxFiles（调低上限时收内存） */
export function trimAnalysisFileCache(): void {
  analysisByFile.setMax(getSessionCacheLimits().maxFiles);
}

export function analysisCacheGet<T>(filePath: string, source: string, auxKey: string): T | undefined {
  // 0 = 关闭：读路径也 miss（上限可动态调低而未触发 trim，条目仍在表里）
  if (getSessionCacheLimits().maxFiles <= 0) return undefined;
  // BoundedLruMap.get：命中刷新 MRU
  const e = analysisByFile.get(stablePathKey(filePath));
  if (!e || e.source !== source || e.auxKey !== auxKey) return undefined;
  return e.value as T;
}

export function analysisCacheSet(filePath: string, source: string, auxKey: string, value: unknown): void {
  const max = getSessionCacheLimits().maxFiles;
  if (max <= 0) return;
  // 上限动态（env / 显式层随时可变）：写前对齐（setMax 幂等，顺带压超限）
  analysisByFile.setMax(max);
  analysisByFile.set(stablePathKey(filePath), { source, auxKey, value });
}

/** 依赖变更后：按入口文件逐出（查找与写入同走 stablePathKey） */
export function evictAnalysisFileCacheForFiles(files: string[]): number {
  let n = 0;
  for (const f of files) {
    if (analysisByFile.delete(stablePathKey(f))) n++;
  }
  return n;
}
