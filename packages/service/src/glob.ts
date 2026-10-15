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
 */
export function compilePattern(pattern: string): Matcher {
  if (!/[*?]/.test(pattern)) return (id) => id.includes(pattern);
  const regExp = patternToRegExp(pattern);
  return (id) => regExp.test(id);
}

/** Compile a pattern list into a matcher that is true when any pattern matches. */
export function compileAnyMatcher(patterns: string[] | string): Matcher {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  const matchers = list.map(compilePattern);
  return (id) => matchers.some((match) => match(id));
}
