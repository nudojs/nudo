/**
 * AST 源码解析入口（core 层）。
 * 不依赖 @nudojs/parser，避免 core ↔ parser 包环。
 * 与 parser.parse 同插件集 + 统一 TS 剥除。
 *
 * 进程内 LRU：同一 source 字符串只 parse 一次（check / generalize / eval 共享）。
 */
import { parse as babelParse } from "@babel/parser";
import type { File } from "@babel/types";
import { stripTypes } from "../strip-types.ts";

/**
 * 会话内 AST 缓存上限。key 是完整 source——碰撞安全（SameValueZero），
 * 但每个条目都钉住一份源码文本，故 cap 必须远小于「随便缓存」：
 * 16 × 1MB ≈ 16MB 源码 key 上界（File 本体另计）。
 */
const MAX_AST_CACHE = 16;
/** Skip caching sources whose text alone would dominate session memory. */
const MAX_AST_SOURCE_CHARS = 1_000_000;
const astCache = new Map<string, File>();

export function resetParseSourceCache(): void {
  astCache.clear();
}

export function getParseSourceCacheSize(): number {
  return astCache.size;
}

function parseUncached(source: string, opts?: { errorRecovery?: boolean }): File {
  const ast = babelParse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    attachComment: true,
    errorRecovery: opts?.errorRecovery === true,
  });
  return stripTypes(ast);
}

export function parseSource(
  source: string,
  opts?: { errorRecovery?: boolean },
): File {
  // errorRecovery 是兜底路径，不进缓存（可能产出不完整 AST）
  if (opts?.errorRecovery === true) {
    return parseUncached(source, opts);
  }
  if (source.length > MAX_AST_SOURCE_CHARS) {
    return parseUncached(source, opts);
  }
  const hit = astCache.get(source);
  if (hit !== undefined) {
    astCache.delete(source);
    astCache.set(source, hit);
    return hit;
  }
  const ast = parseUncached(source, opts);
  if (astCache.size >= MAX_AST_CACHE) {
    const oldest = astCache.keys().next().value;
    if (oldest !== undefined) astCache.delete(oldest);
  }
  astCache.set(source, ast);
  return ast;
}
