import {
  analyzeFileAsync,
  analysisConfig,
  defaultLoadModule as loadModule,
  clearAnalysisSessionCaches,
  shouldAnalyzeFile,
  filterDiagnosticsByLevel,
  findProjectConfig,
  type AnalysisResult,
  type Diagnostic,
  type DiagnosticsLevel,
} from "@nudojs/service";
import { dirname } from "node:path";
import { checkSource, pTrue } from "@nudojs/core";

export type NudoPluginOptions = {
  include?: string[];
  exclude?: string[];
  /**
   * error 级诊断是否让构建失败。
   * 默认 false（E3 / docs）：构建期诊断先 warn，避免无指令/隐式推断误伤 CI。
   * 契约门禁请用 `nudo check`（CI gate）或显式 `failOnError: true`。
   * 项目可用 `nudo.analysis.diagnostics` 控制噪声档；显式契约 error 仍会打出。
   */
  failOnError?: boolean;
};

/** Abs check issues → service Diagnostic（与 evaluator 诊断同管道进 vite warn/error） */
function checkIssuesToDiagnostics(id: string, code: string): Diagnostic[] {
  try {
    const report = checkSource(id, code, pTrue, { loadModule, fromFile: id });
    return report.issues
      .filter((i) => i.severity === "error" || i.severity === "warning")
      .map((i) => {
        const line = i.line ?? 1;
        const column = i.column ?? 0;
        const parts = [i.message];
        if (i.actual) parts.push(`actual: ${i.actual}`);
        if (i.expected) parts.push(`expected: ${i.expected}`);
        if (i.suggestion) parts.push(i.suggestion);
        if (i.code) parts.push(`(${i.code})`);
        return {
          severity: i.severity === "error" ? ("error" as const) : ("warning" as const),
          message: parts.join(" · "),
          code: i.code,
          range: {
            start: { line, column },
            end: { line, column: column + 1 },
          },
        };
      });
  } catch {
    return [];
  }
}

/**
 * 构建期噪声档：
 * - 项目显式 `nudo.analysis.diagnostics` 优先（与 LSP 同源）。
 * - 有 project config 时跟随 `analysisConfig`（与 LSP 默认档对齐：
 *   mode=directives→errors，exports/all→default）。
 * - 无 project config 时保留 vite 历史默认 `default`（error+warning），
 *   避免 ad-hoc 文件构建日志被 directives→errors 整档抹掉 warning。
 */
function viteDiagnosticsLevel(id: string): DiagnosticsLevel {
  const proj = findProjectConfig(dirname(id));
  const raw = proj?.config?.analysis?.diagnostics;
  if (
    raw === "off" ||
    raw === "errors" ||
    raw === "default" ||
    raw === "verbose"
  ) {
    return raw;
  }
  if (proj) return analysisConfig(proj.config).diagnostics;
  return "default";
}

const DEFAULT_INCLUDE = ["**/*.js", "**/*.mjs", "**/*.ts", "**/*.mts"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/*.d.ts"];

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
  // failOnError 默认 false（E3 有意保留）：构建期诊断先 warn；契约 CI 门禁
  // 走 `nudo check`。要让 error 阻断构建请显式 failOnError: true。
  const failOnError = options.failOnError ?? false;

  const analysisCache = new Map<string, AnalysisResult>();

  return {
    name: "vite-plugin-nudo",

    buildStart() {
      analysisCache.clear();
      // 全新构建：丢掉上一轮会话 memo，避免跨 build 陈旧命中
      clearAnalysisSessionCaches();
    },

    /** 任一文件变更后，未改 source 的 importer 再 transform 时可能命中陈旧会话缓存 */
    watchChange() {
      analysisCache.clear();
      clearAnalysisSessionCaches();
    },

    async transform(code: string, id: string) {
      if (excludeMatch(id)) return null;
      if (!includeMatch(id)) return null;
      // A1/A2：与 LSP 同门禁——analysis.mode=directives|exports|all，
      // 不再用硬编码 @nudo 正则挡掉无指令文件。
      if (!shouldAnalyzeFile(id, code)) return null;

      try {
        // async 以便 path 型 @nudo:env 预加载（与 LSP analyzeFileAsync 对齐）
        const result = await analyzeFileAsync(id, code);
        const checkDiags = checkIssuesToDiagnostics(id, code);
        const level = viteDiagnosticsLevel(id);
        const merged = {
          ...result,
          diagnostics: filterDiagnosticsByLevel(
            [...result.diagnostics, ...checkDiags],
            level,
          ),
        };
        analysisCache.set(id, merged);

        for (const diag of merged.diagnostics) {
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
