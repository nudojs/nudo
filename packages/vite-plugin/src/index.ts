import { analyzeFile, type AnalysisResult } from "@nudojs/service";

export type NudoPluginOptions = {
  include?: string[];
  exclude?: string[];
  failOnError?: boolean;
};

const DEFAULT_INCLUDE = ["**/*.js"];
const DEFAULT_EXCLUDE = ["**/node_modules/**"];

type Matcher = (id: string) => boolean;

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

// Compile a glob pattern into an anchored RegExp. Supported syntax:
// - a `**` segment: zero or more path segments, e.g. `**` + `/*.mjs` or `**` + `/node_modules/**`
// - `*` / `?` inside a segment, never crossing `/`
// - all other characters matched literally (regex specials are escaped)
// Patterns without wildcards are treated as literal substrings by the caller.
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

function compilePattern(pattern: string): Matcher {
  if (!/[*?]/.test(pattern)) return (id) => id.includes(pattern);
  const regExp = patternToRegExp(pattern);
  return (id) => regExp.test(id);
}

/** Compile a pattern list into a matcher that is true when any pattern matches. */
function compileAnyMatcher(patterns: string[]): Matcher {
  const matchers = patterns.map(compilePattern);
  return (id) => matchers.some((match) => match(id));
}

export default function nudoPlugin(options: NudoPluginOptions = {}): any {
  const includeMatch = compileAnyMatcher(options.include ?? DEFAULT_INCLUDE);
  const excludeMatch = compileAnyMatcher(options.exclude ?? DEFAULT_EXCLUDE);
  const failOnError = options.failOnError ?? false;

  const analysisCache = new Map<string, AnalysisResult>();

  return {
    name: "vite-plugin-nudo",

    buildStart() {
      analysisCache.clear();
    },

    transform(code: string, id: string) {
      if (excludeMatch(id)) return null;
      if (!includeMatch(id)) return null;
      if (!/@nudo:(case|mock|pure|skip|sample|returns|env|mock-module|as|replace)\b/.test(code)) return null;

      try {
        const result = analyzeFile(id, code);
        analysisCache.set(id, result);

        for (const diag of result.diagnostics) {
          const loc = `${id}:${diag.range.start.line}:${diag.range.start.column}`;
          const msg = `[nudo] ${loc} ${diag.severity}: ${diag.message}`;

          if (diag.severity === "error") {
            if (failOnError) {
              (this as any).error(msg);
            } else {
              (this as any).warn(msg);
            }
          } else if (diag.severity === "warning") {
            (this as any).warn(msg);
          }
        }
      } catch (err) {
        (this as any).warn(`[nudo] Failed to analyze ${id}: ${(err as Error).message}`);
      }

      return null;
    },

    buildEnd() {
      const totalDiags = Array.from(analysisCache.values())
        .reduce((sum, r) => sum + r.diagnostics.length, 0);
      if (totalDiags > 0) {
        const errorCount = Array.from(analysisCache.values())
          .reduce((sum, r) => sum + r.diagnostics.filter((d) => d.severity === "error").length, 0);
        const warnCount = totalDiags - errorCount;
        console.log(`[nudo] Analysis complete: ${errorCount} error(s), ${warnCount} warning(s)`);
      }
    },
  };
}
