import {
  analyzeFileAsync,
  analysisConfig,
  defaultLoadModule as loadModule,
  clearAnalysisSessionCaches,
  shouldAnalyzeFile,
  filterDiagnosticsByLevel,
  findProjectConfig,
  collectSkipReturns,
  interfaceConfig,
  type AnalysisResult,
  type Diagnostic,
  type DiagnosticsLevel,
} from "@nudojs/service";
import { dirname } from "node:path";
import { checkSource, pTrue } from "@nudojs/core";
import type { Plugin } from "vite";

export type NudoPluginOptions = {
  include?: string[] | string;
  exclude?: string[] | string;
  /**
   * error 级诊断是否让构建失败。
   * 默认 false（E3 / docs）：构建期诊断先 warn，避免无指令/隐式推断误伤 CI。
   * 契约门禁请用 `nudo check`（CI gate）或显式 `failOnError: true`。
   * 项目可用 `nudo.analysis.diagnostics` 控制噪声档；显式契约 error 仍会打出。
   */
  failOnError?: boolean;
};

/**
 * checkSource 面结果：`diagnostics` = 契约门禁诊断（L1 actual ⊭ expected /
 * L2 entry-may-throw，与 evaluator 诊断同管道进 vite warn/error）；
 * `failure` = check 管线自身崩溃（装配/注入失败）。二者互斥：崩溃时不
 * 产出诊断，由宿主按 failOnError 档 warn / error（BUG-023：注入/装配
 * 失败必须可见，不得吞成空诊断让 `nudo check` 红、`vite build` 绿）。
 */
type CheckProjection = { diagnostics: Diagnostic[]; failure?: string };

/** Abs check issues → service Diagnostic（与 evaluator 诊断同管道进 vite warn/error） */
function checkIssuesToDiagnostics(id: string, code: string): CheckProjection {
  try {
    // 与 CLI/LSP/agent 同源：package.json#nudo.contract.autoBind=false 时
    // 不得强制 ambient 手写契约（避免构建期误报）。
    const autoBind = interfaceConfig(findProjectConfig(dirname(id))?.config).autoBind;
    const report = checkSource(id, code, pTrue, {
      loadModule,
      fromFile: id,
      ...(autoBind === false ? { autoBind: false } : {}),
      skips: collectSkipReturns(code),
    });
    return {
      diagnostics: report.issues
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
        }),
    };
  } catch (err) {
    // 不静默：崩溃以 failure 上抛给宿主（默认 this.warn，failOnError 时
    // this.error），且不进 viteDiagnosticsLevel 过滤——管线故障不是源码
    // 诊断，diagnostics 档位（off/errors/…）无权把它抹掉。
    return {
      diagnostics: [],
      failure: `check failed for ${id}: ${(err as Error).message}`,
    };
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

/**
 * 与 isNudoTargetPath 对齐：分析目标仅为 `.js` / `.mjs` / `.ts`。
 * `.cjs` / `.cts` / `.mts` / `.d.ts` / `.tsx` 不是分析目标（exclude
 * 已挡 `.d.ts` 与 `node_modules`；`*.nudo.js` 由 shouldAnalyzeFile 拒绝）。
 */
const DEFAULT_INCLUDE = ["**/*.js", "**/*.mjs", "**/*.ts"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/*.d.ts"];

type Matcher = (id: string) => boolean;

/** Single named sink for the build-summary line (keeps it greppable / swappable). */
function logAnalysisSummary(errorCount: number, warnCount: number): void {
  console.log(`[nudo] Analysis complete: ${errorCount} error(s), ${warnCount} warning(s)`);
}

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
function compileAnyMatcher(patterns: string[] | string): Matcher {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  const matchers = list.map(compilePattern);
  return (id) => matchers.some((match) => match(id));
}

export default function nudoPlugin(options: NudoPluginOptions = {}): Plugin {
  const includeMatch = compileAnyMatcher(options.include ?? DEFAULT_INCLUDE);
  const excludeMatch = compileAnyMatcher(options.exclude ?? DEFAULT_EXCLUDE);
  // failOnError 默认 false（E3 有意保留）：构建期诊断先 warn；契约 CI 门禁
  // 走 `nudo check`。要让 error 阻断构建请显式 failOnError: true。
  const failOnError = options.failOnError ?? false;

  // buildEnd 汇总统计用（诊断计数）；分析复用走 service 会话缓存，不读本表
  const analysisCache = new Map<string, AnalysisResult>();

  // checkSource 面的会话缓存：check 诊断无法从 analyzeFileAsync 的
  // AnalysisResult 投影（其 diagnostics 是 evaluator 面，不含 L1
  // constraint-violated / L2 entry-may-throw 门禁 issue），checkSource 链
  // 必须保留；本缓存按 (id, source 内容) 恒等命中，消除同一 build 会话内
  // 对未变文件的重复 check 推断（如 client/SSR 双环境各 transform 一遍）。
  // 失效与 analysisCache 同生命周期：任一文件变更（watchChange）或全新
  // 构建（buildStart）即整表丢弃——check 诊断是 (id, code, 磁盘侧车/依赖)
  // 的纯函数，磁盘变化必然先过 watchChange。
  const checkOutcomeCache = new Map<string, { source: string; outcome: CheckProjection }>();

  return {
    name: "vite-plugin-nudo",

    buildStart() {
      analysisCache.clear();
      checkOutcomeCache.clear();
      // 全新构建：丢掉上一轮会话 memo，避免跨 build 陈旧命中
      clearAnalysisSessionCaches();
    },

    /** 任一文件变更后，未改 source 的 importer 再 transform 时可能命中陈旧会话缓存 */
    watchChange() {
      analysisCache.clear();
      checkOutcomeCache.clear();
      clearAnalysisSessionCaches();
    },

    async transform(code: string, id: string) {
      if (excludeMatch(id)) return null;
      if (!includeMatch(id)) return null;
      // A1/A2：与 LSP 同门禁——analysis.mode=directives|exports|all，
      // 不再用硬编码 @nudo 正则挡掉无指令文件。
      if (!shouldAnalyzeFile(id, code)) return null;

      let fatal: string | undefined;
      try {
        // async 以便 path 型 @nudo:env 预加载（与 LSP analyzeFileAsync 对齐）
        const result = await analyzeFileAsync(id, code, undefined, undefined, undefined, "none");
        let check = checkOutcomeCache.get(id);
        if (!check || check.source !== code) {
          check = { source: code, outcome: checkIssuesToDiagnostics(id, code) };
          checkOutcomeCache.set(id, check);
        }
        const checkDiags = check.outcome.diagnostics;
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
              // 先收集，try 外再抛——this.error 会 throw，不能被 catch 吞
              fatal = fatal ?? msg;
            } else {
              this.warn(msg);
            }
          } else if (diag.severity === "warning") {
            this.warn(msg);
          }
        }
        // check 管线崩溃：默认 warn（不静默、不 fail 构建）；failOnError
        // 时收集到 fatal 走 this.error（与源诊断同一档位语义）
        if (check.outcome.failure) {
          const crashMsg = `[nudo] ${check.outcome.failure}`;
          if (failOnError) {
            fatal = fatal ?? crashMsg;
          } else {
            this.warn(crashMsg);
          }
        }
      } catch (err) {
        this.warn(`[nudo] Failed to analyze ${id}: ${(err as Error).message}`);
      }
      // try 外抛：Rollup/Vite 的 this.error 会 throw，不能被上面的 catch 吞掉
      if (fatal) this.error(fatal);

      return null;
    },

    buildEnd() {
      const totalDiags = Array.from(analysisCache.values())
        .reduce((sum, r) => sum + r.diagnostics.length, 0);
      if (totalDiags > 0) {
        const errorCount = Array.from(analysisCache.values())
          .reduce((sum, r) => sum + r.diagnostics.filter((d) => d.severity === "error").length, 0);
        const warnCount = totalDiags - errorCount;
        logAnalysisSummary(errorCount, warnCount);
      }
    },
  };
}
