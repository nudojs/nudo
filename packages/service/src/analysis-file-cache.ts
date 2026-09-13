/**
 * 整文件 AnalysisResult 会话缓存（service 层，泛型避免与 analyzer 环依赖）。
 *
 * 按 filePath 键控 + source 字符串相等比较：
 * - LSP 同一 buffer 复用 getText() 同一字符串 → SameValueZero O(1)
 * - 编辑后 source 变化 → miss，覆盖旧条目（每文件一份，内存有界）
 * 与 B-path 缓存同生命周期：宿主清 B-path 时一并失效。
 */
type Entry = {
  source: string;
  auxKey: string;
  value: unknown;
};

const analysisByFile = new Map<string, Entry>();
const MAX_ANALYSIS_FILE_CACHE = 64;

export function clearAnalysisFileCache(): void {
  analysisByFile.clear();
}

export function getAnalysisFileCacheSize(): number {
  return analysisByFile.size;
}

export function analysisCacheGet<T>(filePath: string, source: string, auxKey: string): T | undefined {
  const e = analysisByFile.get(filePath);
  if (!e) return undefined;
  if (e.source !== source || e.auxKey !== auxKey) return undefined;
  // LRU：命中移到队尾
  analysisByFile.delete(filePath);
  analysisByFile.set(filePath, e);
  return e.value as T;
}

export function analysisCacheSet(filePath: string, source: string, auxKey: string, value: unknown): void {
  if (analysisByFile.size >= MAX_ANALYSIS_FILE_CACHE && !analysisByFile.has(filePath)) {
    const oldest = analysisByFile.keys().next().value;
    if (oldest !== undefined) analysisByFile.delete(oldest);
  }
  analysisByFile.set(filePath, { source, auxKey, value });
}

/** 依赖变更后：按入口文件逐出 */
export function evictAnalysisFileCacheForFiles(files: string[]): number {
  let n = 0;
  for (const f of files) {
    if (analysisByFile.delete(f)) n++;
  }
  return n;
}
