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

function parseUncached(
  source: string,
  opts?: { errorRecovery?: boolean; keepTs?: boolean },
): File {
  const ast = babelParse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    attachComment: true,
    errorRecovery: opts?.errorRecovery === true,
  });
  // keepTs：保留 TS 节点（侧车 .nudo.ts 的语句级文本改写需要未剥除的
  // 区间——rewriteSidecarSource 据此切掉类型注解/声明）
  return opts?.keepTs === true ? ast : stripTypes(ast);
}

export function parseSource(
  source: string,
  opts?: { errorRecovery?: boolean; keepTs?: boolean },
): File {
  // keepTs 与 errorRecovery 同属兜底/特殊路径，不进缓存（缓存条目是剥除后的 AST）
  if (opts?.keepTs === true || opts?.errorRecovery === true) {
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
