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
import { lowerCjsExportAssignments, stripTypes } from "../strip-types.ts";

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

/** `/` 在这些词之后是正则开始，否则按除法（与 code-text 同口径） */
const MASK_REGEX_KEYWORDS = new Set([
  "await", "case", "delete", "do", "else", "in", "instanceof", "new",
  "of", "return", "throw", "typeof", "void", "yield",
]);

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
/**
 * 等长掩码：注释与字符串/模板**内容**替换为空格（换行保留），模板插值
 * `${…}` 里的代码保持可见（插值是代码岛——`${require(…)}` /
 * `${import.meta.url}` 必须参与分类）。
 *
 * 为什么不复用 `format/code-text.ts` 的 `stripCommentsAndStrings`：该模块
 * import 本文件（`parseSource`），反向 import 会成环。故这里保留一份**小**
 * 词法器，只服务模块类型判定（不需要字符串区间等完整信息）。正则字面量按
 * 「前一有效字符」启发式识别并掩码（`/(?:export\s+)?/` 里的 export 不是
 * 代码；与 code-text 同口径，`if (x) /re/` 这类极端写法按除法处理）。
 */
function maskCommentsAndStrings(source: string): string {
  const out = source.split("");
  const n = source.length;
  // 正则字面量里的词（`/(?:export\s+)?/`）不是代码——打包产物里常见，必须
  // 掩码。`/` 是除法还是正则按前一有效字符启发。
  const regexAllowedAt = (idx: number): boolean => {
    let j = idx - 1;
    while (j >= 0 && /\s/.test(source[j]!)) j--;
    if (j < 0) return true;
    const c = source[j]!;
    if (c === ")" || c === "]" || c === "}") return false;
    if (!/[A-Za-z0-9_$]/.test(c)) return true;
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(source[k]!)) k--;
    return MASK_REGEX_KEYWORDS.has(source.slice(k + 1, j + 1));
  };
  const mask = (i: number): void => {
    const c = out[i];
    if (c !== undefined && c !== "\n" && c !== "\r") out[i] = " ";
  };
  // 模板内容面 → `${` 进入插值代码面（braceDepth 配对 `}` 后回模板）。
  type Ctx = { template: boolean; braceDepth: number };
  const stack: Ctx[] = [];
  let i = 0;
  while (i < n) {
    const ch = source[i]!;
    const top = stack[stack.length - 1];
    if (top?.template === true) {
      // 模板内容：除插值定界符外全部掩码
      if (ch === "\\") {
        mask(i);
        if (i + 1 < n) mask(i + 1);
        i += 2;
        continue;
      }
      if (ch === "`") {
        stack.pop();
        i++;
        continue;
      }
      if (ch === "$" && source[i + 1] === "{") {
        stack.push({ template: false, braceDepth: 0 });
        i += 2;
        continue;
      }
      mask(i);
      i++;
      continue;
    }
    // 代码面：注释 / 字符串 / 模板
    if (ch === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") {
        mask(i);
        i++;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      mask(i);
      mask(i + 1);
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        mask(i);
        i++;
      }
      if (i < n) {
        mask(i);
        mask(i + 1);
        i += 2;
      }
      continue;
    }
    if (ch === "/" && regexAllowedAt(i)) {
      // 正则体 + flags 全掩码（char class 内的 `/` 不结束正则）
      mask(i);
      i++;
      let inClass = false;
      while (i < n) {
        const c = source[i]!;
        if (c === "\\") {
          mask(i);
          if (i + 1 < n) mask(i + 1);
          i += 2;
          continue;
        }
        if (c === "\n") break; // 未闭合：按行截断
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        mask(i);
        i++;
        if (c === "/" && !inClass) {
          while (i < n && /[a-z]/i.test(source[i]!)) {
            mask(i);
            i++;
          }
          break;
        }
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      mask(i);
      i++;
      while (i < n) {
        const c = source[i]!;
        if (c === "\\") {
          mask(i);
          if (i + 1 < n) mask(i + 1);
          i += 2;
          continue;
        }
        mask(i);
        i++;
        if (c === ch || c === "\n") break; // 未闭合按行截断
      }
      continue;
    }
    if (ch === "`") {
      stack.push({ template: true, braceDepth: 0 });
      i++;
      continue;
    }
    if (top !== undefined && !top.template) {
      if (ch === "{") {
        top.braceDepth++;
      } else if (ch === "}") {
        if (top.braceDepth === 0) stack.pop(); // 插值结束 → 回模板内容面
        else top.braceDepth--;
      }
    }
    i++;
  }
  return out.join("");
}

/**
 * 源码的模块类型（BUG-085）。
 *
 * Babel 的 `sourceType: "module"` 会在**语法层**禁掉顶层重复声明（ESM 的
 * 静态语义），但 CJS 允许 `function f(){} function f(x){}` / `function g(){}
 * var g = 2`（`node --check` 通过、运行时后者覆盖前者）。旧口径恒按 module
 * 解析 ⇒ 合法 `.cjs` 在 `check` / `test` / `export` 三面整份被判 syntax
 * error（零签名、零产物）。
 *
 * core 不读文件系统（不能在 core 层查 `package.json#type`），因此按
 * **扩展名 + 源码标记**判定：`.cjs` / `.cts` 恒是 CJS；其余只在「源码有明显
 * CJS 标记且没有 ESM 语法」时按 script 解析 ⇒ ESM 行为逐字不变。
 *
 * 标记探测先做**等长掩码**（注释 / 字符串 / 模板内容不可见）：注释里提到
 * `require(`、模板里一行以 `export` 开头都不得改变分类。ESM 探针按保留字
 * 位置判（`module.exports` 的属性位 `.export` 与对象键 `export:` 排除），
 * 不要求 `export` 在行首/分号后——`function f() {} export { f }` 这类同行
 * 写法同样是合法 ESM。
 */
type SourceType = "module" | "script";
function sourceTypeFor(filename: string | undefined, source: string): SourceType {
  const lower = (filename ?? "").toLowerCase();
  const code = maskCommentsAndStrings(source);
  // ESM 语法（含 `import.meta`）显式优先——`.cts` / `.cjs` 里也常写
  // `export function …`（tsc 会降级成 CJS 产物，nudo 的门禁同样按模块解析）。
  // 若对这些文件强制 script，会把合法 ESM 语法判成 syntax error（反噬）。
  // import/export 是保留字：代码区出现且不在属性位 / 对象键位即模块语法；
  // `import(` 是动态导入（CJS 合法）⇒ 排除；`\b` 排除 `import_vscode` 这类
  // 打包器生成的普通标识符（esbuild 产物，曾被误判成静态 import）。
  if (/(?<![\w$.])import\b(?!\s*[(:])/.test(code) || /(?<![\w$.])export\b(?!:)/.test(code)) {
    return "module";
  }
  if (lower.endsWith(".cjs") || lower.endsWith(".cts")) return "script";
  if (lower.endsWith(".mjs") || lower.endsWith(".mts")) return "module";
  return /\bmodule\.exports\b|\bexports\.[A-Za-z_$]|\brequire\s*\(/.test(code)
    ? "script"
    : "module";
}

function parseWithJsxFallback(
  source: string,
  plugins: readonly ParsePlugin[],
  sourceType: SourceType,
  opts?: { errorRecovery?: boolean; keepTs?: boolean; filename?: string },
): File {
  const parseWith = (ps: readonly ParsePlugin[]): File =>
    babelParse(source, {
      sourceType,
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
  // 模块类型只算一次（掩码分类是 O(source)；parseWithJsxFallback 的重试共用）
  const ast = parseWithJsxFallback(
    source,
    PLUGINS_BY_MODE[mode],
    sourceTypeFor(opts?.filename, source),
    opts,
  );
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
  if (opts?.keepTs === true) {
    // BUG-160：`export = X` 在 keepTs 树上是**未剥除**的 TS 语句，而所有导出
    // 面消费方（dts 的 dtsModuleSurface / 侧车改写）只认 ESM 声明与 CJS 赋值
    // 两种形态 ⇒ 出口名整条不可见。这里只把这一条语句归一成等价的 CJS 出口
    // `module.exports = X`（带标记 ⇒ 发射路径随后的 strip 仍按旧口径删除）。
    if (mode === "ts") lowerCjsExportAssignments(ast);
    return ast;
  }
  if (mode === "js") return ast;
  // 分析面（非发射面）：`export = X` 降级成等价的 CJS 出口（BUG-160）。
  // 发射面（migrate strip）走 stripTypes 的默认值 "drop" ⇒ 产物面零变化。
  return stripTypes(ast, source, { exportAssignment: "cjs" });
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
  // 缓存键必须含**插件模式 + 模块类型**：同一段源码在 `.js`（无 typescript
  // 插件）与 `.ts`（有）下是两棵不同的 AST，在 ESM / CJS 下也是 ⇒ 只按
  // source 做键会让两棵树串味。
  const key = `${parseModeFor(opts?.filename)}:${sourceTypeFor(opts?.filename, source)}\u0000${source}`;
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
