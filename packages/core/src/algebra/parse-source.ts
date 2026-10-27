/**
 * AST 源码解析入口（core 层）。
 * 不依赖 @nudojs/parser，避免 core ↔ parser 包环。
 * 与 parser.parse 同插件集 + 统一 TS 剥除。
 *
 * 进程内 LRU：同一 source 字符串只 parse 一次（check / generalize / eval 共享）。
 *
 * `opts.filename`（可选）：**知道扩展名**的调用方（如 check 面）传文件名 ⇒
 * 解析插件集按扩展名选（`.js` 不开 typescript 插件——Bug 633）。缺省 = 旧行为。
 *
 * Bug 451：插件集**硬失败**时去掉 `jsx` **重试一次**（`.ts` 的 `<T>x` 尖括号
 * 断言在 TS+JSX 下被当 JSX ⇒ 整文件解析失败）。见 `parseWithJsxFallback`。
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

/**
 * 去掉 `jsx` 的降级插件集（Bug 451）。
 *
 * `.ts`（非 `.tsx`）里**合法**的尖括号类型断言 `<T>x` 在 **TS+JSX** 双插件下
 * 被 Babel **优先按 JSX** 解析 ⇒ 整文件**硬失败**（check / test / export /
 * migrate strip 全废）。去掉 `jsx` 后 `<T>x` 回到 TS 语法（`TSTypeAssertion`）。
 */
function withoutJsx(plugins: readonly ParsePlugin[]): ParsePlugin[] {
  return plugins.filter((p) => p !== "jsx");
}

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

/**
 * 解析本体（插件集给定）。
 *
 * Bug 451：TS+JSX 双插件下 `<T>x`（`.ts` 合法尖括号断言）被当 JSX ⇒ **硬失败**。
 * ⇒ **硬失败时去掉 `jsx` 重试一次**（路线 A：单文件、零调用面改动、
 * `parseSource` 签名不变 ⇒ 公共 API 冻结面零变更）。
 *
 * 口径：
 * - 只在**抛错**（硬失败）时重试 ⇒ `errorRecovery: true` 的「软失败」路径不变。
 * - 重试也失败 ⇒ 报**首次**错误（更贴近真实原因，不换措辞）。
 * - 插件集**不随调用方变化**（重试与否只由源码文本决定）⇒ AST LRU 缓存键
 *   （mode + source）**不动**，不存在 `.ts` / `.js` 串味。
 */
function parseWithJsxFallback(
  source: string,
  plugins: readonly ParsePlugin[],
  opts?: { errorRecovery?: boolean; keepTs?: boolean; filename?: string },
): File {
  const parseWith = (ps: readonly ParsePlugin[]): File =>
    babelParse(source, {
      sourceType: "module",
      plugins: [...ps],
      attachComment: true,
      errorRecovery: opts?.errorRecovery === true,
    });
  try {
    return parseWith(plugins);
  } catch (err) {
    const fallback = withoutJsx(plugins);
    if (fallback.length === plugins.length) throw err; // 本就没有 jsx ⇒ 无可降级
    try {
      return parseWith(fallback);
    } catch {
      throw err; // 降级也失败 ⇒ 报首次错误
    }
  }
}

function parseUncached(
  source: string,
  opts?: { errorRecovery?: boolean; keepTs?: boolean; filename?: string },
): File {
  const mode = parseModeFor(opts?.filename);
  const ast = parseWithJsxFallback(source, PLUGINS_BY_MODE[mode], opts);
  // keepTs：保留 TS 节点（侧车 .nudo.ts 的语句级文本改写需要未剥除的
  // 区间——rewriteSidecarSource 据此切掉类型注解/声明）
  // 剥除时把**类型注解文本**留在节点上（nudoTypeText / nudoReturnTypeText）——
  // .ts 源的形参声明类型据此进推断（Bug 479）；纯 JS 源无注解 ⇒ 结构性 no-op。
  //
  // **js 模式整趟跳过**：js 模式只挂 `jsx` 插件，Babel 产不出任何 TS-only
  // 节点/字段（TSAsExpression / typeAnnotation / enum / 参数属性 … 结构上
  // 不可能出现）⇒ 剥除 pass 是严格 no-op，却要付两趟全 AST 遍历
  // （collectValueReferences + transformNode）。实测 OSS 语料（79 个纯 JS
  // 文件）：strip-types 占 `nudo check` 自身耗时 ~11%、占每次 parse 的近半。
  if (opts?.keepTs === true || mode === "js") return ast;
  return stripTypes(ast, source);
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
