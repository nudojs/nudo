/**
 * 极简 glob → RegExp 编译器（自 vite-plugin 内联实现抽取，语义不变）。
 *
 * 支持的语法：
 * - `**` 段：零或多段路径——`**` 段后跟 `/`，或结尾 `**`，如 `**` + `/*.mjs`、
 *   `**` + `/node_modules/**`
 * - 段内 `*` / `?`：单段通配，不跨 `/`
 * - 其余字符按字面量匹配（正则特殊字符转义）
 * - 无通配符的模式按**字面量子串**处理（见 compilePattern）
 *
 * 相对/绝对语义由调用方决定：vite-plugin 传完整模块 id；
 * analysis-scope 的 exclude 优先传 projectDir 相对路径。
 */

export type Matcher = (id: string) => boolean;

const REGEX_SPECIALS = /[\\^$.|?*+(){}\[\]]/;

function escapeRegExpChar(ch: string): string {
  return REGEX_SPECIALS.test(ch) ? `\\${ch}` : ch;
}

/** Translate one path segment (`**` segments are handled by the caller). */
function segmentToRegExpSource(segment: string): string {
  let source = "";
  for (const ch of segment) {
    if (ch === "*") source += "[^/]*";
    else if (ch === "?") source += "[^/]";
    else source += escapeRegExpChar(ch);
  }
  return source;
}

/**
 * Compile a glob pattern into an anchored RegExp. Supported syntax:
 * - a `**` segment: zero or more path segments, e.g. `**` + `/*.mjs` or `**` + `/node_modules/**`
 * - `*` / `?` inside a segment, never crossing `/`
 * - all other characters matched literally (regex specials are escaped)
 * Patterns without wildcards are treated as literal substrings by the caller.
 */
function patternToRegExp(pattern: string): RegExp {
  const segments = pattern.split("/");
  let source = "";
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    if (segment === "**") {
      if (isLast) {
        source = source.endsWith("/")
          ? `${source.slice(0, -1)}(?:/.*)?`
          : `${source}.*`;
      } else {
        source += "(?:.*/)?";
      }
    } else {
      source += segmentToRegExpSource(segment);
      if (!isLast) source += "/";
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * 单模式编译：无通配符（`*` / `?`）→ 字面量子串匹配；有 → 锚定正则。
 * 编译是全函数——任何字符串都能编译，不存在「无法解析需退化」的模式；
 * 匹配不到（如相对 glob 对绝对路径）就是不命中。
 *
 * ⚠ 字面量的**子串**语义是**黑名单**（exclude）的口径：`exclude: ["snapshots"]`
 * 要命中任意深度的 `snapshots/`。白名单（include）反过来——字面量表示**这个
 * 文件 / 这个目录**，用 {@link compileIncludeMatcher}（见 literalPathHit）。
 */
export function compilePattern(pattern: string): Matcher {
  if (!/[*?]/.test(pattern)) return (id) => id.includes(pattern);
  const regExp = patternToRegExp(pattern);
  return (id) => regExp.test(id);
}

/** 路径形态归一：反斜杠 → `/`，剥 `./` 前缀（两侧同口径）。 */
export function normalizeScopePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * 字面量**路径形态**命中：精确相等，或目录前缀（`src` 命中 `src/a.js`，
 * `src/a.js` 只命中它自己）。
 *
 * 这是白名单（include）的字面量语义，与黑名单的**子串**语义刻意不同：
 * 子串会把 `src-other/x.js` 一并放进 `include: ["src"]` 的白名单（把
 * 「要分析哪些」偷换成「哪些路径含这个字串」）。
 */
export function literalPathHit(pattern: string, path: string): boolean {
  const pat = normalizeScopePath(pattern);
  const p = normalizeScopePath(path);
  if (p === pat) return true;
  return p.startsWith(pat.endsWith("/") ? pat : `${pat}/`);
}

/**
 * 白名单（include）的单模式编译：通配符 → 锚定 glob（与 exclude 同编译器）；
 * 无通配符 → **路径形态**（见 {@link literalPathHit}）。
 */
export function compileIncludePattern(pattern: string): Matcher {
  const pat = normalizeScopePath(pattern);
  if (/[*?]/.test(pat)) return compilePattern(pat);
  return (id) => literalPathHit(pat, id);
}

/** Compile a pattern list into a matcher that is true when any pattern matches. */
export function compileAnyMatcher(patterns: string[] | string): Matcher {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  const matchers = list.map(compilePattern);
  return (id) => matchers.some((match) => match(id));
}

/**
 * 白名单（include）模式表编译 —— `nudo.analysis.include` 与 vite-plugin 的
 * `include` 选项共用这一条语义（两侧同名同语法必须给同一个命中集）。
 */
export function compileIncludeMatcher(patterns: string[] | string): Matcher {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  const matchers = list.map(compileIncludePattern);
  return (id) => matchers.some((match) => match(id));
}
