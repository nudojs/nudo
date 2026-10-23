/**
 * AST 源码解析入口（core 层）。
 * 不依赖 @nudojs/parser，避免 core ↔ parser 包环。
 * 与 parser.parse 同插件集 + 统一 TS 剥除。
 *
 * 进程内 LRU：同一 source 字符串只 parse 一次（check / generalize / eval 共享）。
 *
 * `opts.filename`（可选）：**知道扩展名**的调用方（如 check 面）传文件名 ⇒
 * 解析插件集按扩展名选（`.js` 不开 typescript 插件——Bug 633）。缺省 = 旧行为。
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

/**
 * 解析插件集（**按文件扩展名**选）。
 *
 * - `.js` / `.mjs` / `.cjs` / `.jsx`：**纯 JS** ⇒ **不开** typescript 插件
 * - 其余（`.ts` / `.mts` / `.cts` / `.tsx` / 未知扩展名 / 无文件名）：旧行为
 *   （typescript + jsx）
 *
 * 为什么（Bug 633）：`.js` 里的 TS-only 语法（`private x = 0` / `as T` /
 * `interface` / `enum` …）此前被**静默接受** ⇒ 门禁对一个 **Node 自己都
 * 拒绝**（`node --check` 报 SyntaxError）的文件判绿 ⇒ CI 门禁假绿。
 * 按扩展名关掉 typescript 插件后，「语法 Node 拒绝」与「check 判绿」
 * 不可能再同时成立。
 *
 * 缺省（无文件名）保持旧行为：调用方（parser 包 / generalize / scan…）
 * 未必知道被解析物的扩展名 ⇒ 不得凭猜测收紧（收紧只由**知道扩展名**的
 * 入口做，见 `parseSource` 的 `filename` 选项）。
 */
type ParsePlugin = "typescript" | "jsx";
type ParseMode = "ts" | "js";
const PLUGINS_BY_MODE: Record<ParseMode, readonly ParsePlugin[]> = {
  ts: ["typescript", "jsx"],
  js: ["jsx"],
};

function parseModeFor(filename: string | undefined): ParseMode {
  if (!filename) return "ts";
  const lower = filename.toLowerCase();
  return lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs") ||
    lower.endsWith(".jsx")
    ? "js"
    : "ts";
}

export function resetParseSourceCache(): void {
  astCache.clear();
}

export function getParseSourceCacheSize(): number {
  return astCache.size;
}

function parseUncached(
  source: string,
  opts?: { errorRecovery?: boolean; keepTs?: boolean; filename?: string },
): File {
  const mode = parseModeFor(opts?.filename);
  const ast = babelParse(source, {
    sourceType: "module",
    plugins: [...PLUGINS_BY_MODE[mode]],
    attachComment: true,
    errorRecovery: opts?.errorRecovery === true,
  });
  // keepTs：保留 TS 节点（侧车 .nudo.ts 的语句级文本改写需要未剥除的
  // 区间——rewriteSidecarSource 据此切掉类型注解/声明）
  // 剥除时把**类型注解文本**留在节点上（nudoTypeText / nudoReturnTypeText）——
  // .ts 源的形参声明类型据此进推断（Bug 479）；纯 JS 源无注解 ⇒ 结构性 no-op。
  return opts?.keepTs === true ? ast : stripTypes(ast, source);
}

export function parseSource(
  source: string,
  opts?: { errorRecovery?: boolean; keepTs?: boolean; filename?: string },
): File {
  // keepTs 与 errorRecovery 同属兜底/特殊路径，不进缓存（缓存条目是剥除后的 AST）
  if (opts?.keepTs === true || opts?.errorRecovery === true) {
    return parseUncached(source, opts);
  }
  if (source.length > MAX_AST_SOURCE_CHARS) {
    return parseUncached(source, opts);
  }
  // 缓存键必须含**插件模式**：同一段源码在 `.js`（无 typescript 插件）与
  // `.ts`（有）下是两棵不同的 AST ⇒ 只按 source 做键会让两棵树串味。
  const key = `${parseModeFor(opts?.filename)}\u0000${source}`;
  const hit = astCache.get(key);
  if (hit !== undefined) {
    astCache.delete(key);
    astCache.set(key, hit);
    return hit;
  }
  const ast = parseUncached(source, opts);
  if (astCache.size >= MAX_AST_CACHE) {
    const oldest = astCache.keys().next().value;
    if (oldest !== undefined) astCache.delete(oldest);
  }
  astCache.set(key, ast);
  return ast;
}
