import {
  analyzeFileAsync,
  analysisConfig,
  defaultLoadModule as loadModule,
  clearAnalysisSessionCaches,
  shouldAnalyzeFile,
  filterDiagnosticsByLevel,
  findProjectConfig,
  collectSkipReturns,
  compileAnyMatcher,
  interfaceConfig,
  collectEnvNames,
  getPathEnvLoadErrors,
  type AnalysisResult,
  type Diagnostic,
  type DiagnosticsLevel,
} from "@nudojs/service";
import { dirname, resolve as resolvePath } from "node:path";
import { checkSource, pTrue } from "@nudojs/core";
import { DIAG } from "@nudojs/core/internal";
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
 * path env 加载失败 → `nudo:env-unresolved` warning（Bug 474）。
 *
 * path-env 的失败信息只存在于 service `getPathEnvLoadErrors` 这一个旁路
 * 收集器里；CLI check / CLI test / LSP 都订阅了它，**vite-plugin 从未订阅**
 * ⇒ `@nudo:env ./missing.js` 加载失败零诊断：env 静默不生效，该 env 提供的
 * 全局退化成 unknown / 宿主真身，而构建日志里没有任何一行提示。
 *
 * 与 CLI / LSP 同源同码同文案（`path env failed to load: <path> — <error>`）：
 * - 只报**本文件** env 名单解析出的路径（env 项被移除后进程级错误表里的
 *   陈旧条目不得继续误报）——与 LSP `envUnresolvedDiags` 同口径；
 * - `seen` 去重：同 baseDir 多文件构建时同一条失败只报一次。
 */
function envUnresolvedDiagnostics(
  id: string,
  code: string,
  seen: Set<string>,
): Diagnostic[] {
  let envNames: string[];
  try {
    envNames = collectEnvNames(id, code, true);
  } catch {
    // env 名单解析失败不拖垮构建（分析器自身已 fail-closed）
    return [];
  }
  if (envNames.length === 0) return [];
  const baseDir = dirname(id);
  // preloadPathEnvs 记录的 path = resolve(baseDir, name)——同式过滤陈旧条目
  const candidates = new Set(envNames.map((n) => resolvePath(baseDir, n)));
  // **按名字**发的诊断（未知 env 名 / 非字符串 env 项）记录的 path 是
  // **名字本身**（不是解析后的路径）——只按 candidates 过滤 ⇒ 这类条目
  // 永远匹配不上 ⇒ 构建日志里零诊断（与 LSP 面同一个洞，#470/#937）。
  // 按**本文件自己的 env 名单**匹配 ⇒ 同目录别的文件的无 path 诊断
  // 不会误吸进来（getPathEnvLoadErrors(baseDir) 已按 baseDir 收窄）。
  const byName = new Set<string>(envNames);
  for (const raw of envNames as unknown[]) {
    if (typeof raw === "string") continue;
    const rendered = JSON.stringify(raw);
    if (typeof rendered === "string") byName.add(rendered);
  }
  const diags: Diagnostic[] = [];
  for (const e of getPathEnvLoadErrors(baseDir)) {
    if (!candidates.has(e.path) && !byName.has(e.path)) continue;
    const key = `${e.baseDir}\0${e.path}\0${e.error}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diags.push({
      severity: "warning",
      // 文案 = CLI check/test 面的同一句 + 诊断码后缀（与本插件 check 面诊断
      // 的既有格式一致：`(nudo:xxx)` 随行可见——构建日志是纯文本面，不带码
      // 等于把「env 静默不生效」这条线索又藏回诊断对象里）。
      message: `path env failed to load: ${e.path} — ${e.error} (${DIAG.envUnresolved})`,
      code: DIAG.envUnresolved,
      range: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
    });
  }
  return diags;
}

/**
 * 与 isNudoTargetPath 对齐：分析目标仅为 `.js` / `.mjs` / `.ts`。
 * `.cjs` / `.cts` / `.mts` / `.d.ts` / `.tsx` 不是分析目标（exclude
 * 已挡 `.d.ts` 与 `node_modules`；`*.nudo.js` 由 shouldAnalyzeFile 拒绝）。
 */
const DEFAULT_INCLUDE = ["**/*.js", "**/*.mjs", "**/*.ts"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/*.d.ts"];

/** Single named sink for the build-summary line (keeps it greppable / swappable). */
function logAnalysisSummary(errorCount: number, warnCount: number): void {
  console.log(`[nudo] Analysis complete: ${errorCount} error(s), ${warnCount} warning(s)`);
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

  // path-env 加载失败去重表（同 baseDir 多文件构建只报一次；buildStart /
  // watchChange 随其它缓存整表丢弃——新一轮构建必须重新上报）。
  const envErrorSeen = new Set<string>();

  return {
    name: "vite-plugin-nudo",

    buildStart() {
      analysisCache.clear();
      checkOutcomeCache.clear();
      envErrorSeen.clear();
      // 全新构建：丢掉上一轮会话 memo，避免跨 build 陈旧命中
      clearAnalysisSessionCaches();
    },

    /** 任一文件变更后，未改 source 的 importer 再 transform 时可能命中陈旧会话缓存 */
    watchChange() {
      analysisCache.clear();
      checkOutcomeCache.clear();
      envErrorSeen.clear();
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
        // path env 加载失败（@nudo:env ./missing.js）必须可见：此前 vite-plugin
        // 从不读 getPathEnvLoadErrors ⇒ env 静默不生效且零诊断（Bug 474）。
        const envDiags = envUnresolvedDiagnostics(id, code, envErrorSeen);
        const level = viteDiagnosticsLevel(id);
        const merged = {
          ...result,
          diagnostics: filterDiagnosticsByLevel(
            [...result.diagnostics, ...checkDiags, ...envDiags],
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
