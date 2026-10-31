/**
 * orchestrate：analyzeFile / analyzeFileAsync / collectCallRecords 主编排。
 * 自 analyzer.ts 机械拆出；语义未改。
 *
 * 职责已按缝拆出（机械搬移，语义未改）：
 *   - analyzer-orchestrate-calls.ts     env 名收集 + 调用点发现
 *   - analyzer-orchestrate-uncached.ts  analyzeFileUncached / UncachedInner
 */
import { dirname } from "node:path";
import { setEvalFallbackCollector, type EvalFallback } from "@nudojs/core";
import { DIAG, getEvalFallbackStats, runWithCollectorScope } from "@nudojs/core/internal";
import { findProjectConfig, interfaceConfig, analysisConfig } from "./evaluator/config.ts";
import { noteEnvPathDeps } from "./env-path-deps.ts";
import { absolutizeEnvSpec, preloadPathEnvs } from "./evaluator/env-loader.ts";
import { analysisCacheGet, analysisCacheSet } from "./analysis-file-cache.ts";
import { analysisFileCacheKey, cloneAnalysisResult } from "./analyzer-cache.ts";
import type {
  AnalysisResult,
  AnalyzeLoadModule,
  Diagnostic,
  DirectiveCaseMode,
} from "./analyzer-types.ts";
import type { CallRecord } from "./evaluator/call-record.ts";
import { collectEnvNames } from "./analyzer-orchestrate-calls.ts";
import { analyzeFileUncached } from "./analyzer-orchestrate-uncached.ts";

export { collectEnvNames, collectCallRecords, expandTestCallbacks } from "./analyzer-orchestrate-calls.ts";
export {
  analyzeFileUncached,
  analyzeFileUncachedInner,
} from "./analyzer-orchestrate-uncached.ts";

/**
 * 分析前的 env 预载（项目级 `package.json#nudo.env` + 文件级 `/// @nudo:env`）。
 *
 * Bug 647（两层基准）：项目级 env 按**项目根**解析，文件级 env 按**被分析
 * 文件所在目录**解析。此前两族一律按文件目录解析 ⇒ 项目级 env 在「项目根
 * 之外的文件」上解析到不存在的路径 ⇒ env 全局对那些文件不可见（分析面退化
 * unknown）。口径与 CLI 的 `packages/nudojs/src/commands/check.ts`
 * （`projectEnvSpec` + 两次 `preloadPathEnvs`）同款。
 */
async function preloadAnalysisEnvs(filePath: string, source: string): Promise<void> {
  const fileEnvBaseDir = dirname(filePath);
  const proj = findProjectConfig(fileEnvBaseDir);
  const projectEnvBaseDir = proj?.projectDir ?? fileEnvBaseDir;
  const rawProjectEnv = proj?.config.env;
  const projectEnvNames = Array.isArray(rawProjectEnv)
    ? rawProjectEnv.filter((n): n is string => typeof n === "string")
    : [];
  // 相对说明符先按项目根**绝对化**（与 CLI 同款）⇒ preload 时基准不再歧义
  const projectEnvSpec = absolutizeEnvSpec(projectEnvNames, projectEnvBaseDir);
  const fileEnvNames = collectEnvNames(filePath, source, false);
  // path-based @nudo:env / mock-module 反向边（watch 失效）
  noteEnvPathDeps(filePath, source);
  if (projectEnvSpec.length > 0) {
    await preloadPathEnvs(projectEnvSpec, projectEnvBaseDir);
  }
  if (fileEnvNames.length > 0) {
    await preloadPathEnvs(fileEnvNames, fileEnvBaseDir);
  }
}

/**
 * Async entry to analyzeFile: preloads path-based env files
 * (`/// @nudo:env ./nudo-harvest-node.ts`) via dynamic import — impossible
 * synchronously in ESM — then runs the sync analysis, which picks the
 * preloaded factories up from the env-loader cache.
 * `loadModule` is optional; when provided it is used for relative imports /
 * sidecar ambient bindings (LSP buffer-aware path). Default remains
 * `defaultLoadModule` (disk).
 */
export async function analyzeFileAsync(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: AnalyzeLoadModule,
  /** 默认 all（库/测试兼容）；check/IDE 宿主应传 none（惰性 case） */
  caseMode: DirectiveCaseMode = "all",
): Promise<AnalysisResult> {
  // collector 作用域须在 await preloadPathEnvs 之前打开：预载触发的诊断/collector
  // 落进本次分析的 store，不与 await 窗口交错的其它分析串台（幂等：嵌套复用）。
  return runWithCollectorScope(async () => {
    await preloadAnalysisEnvs(filePath, source);
    return analyzeFile(filePath, source, activeCases, externalCallRecords, loadModule, caseMode);
  });
}

/**
 * 引擎内部回落（`internal` fallback）→ **error 级 `nudo:internal` 诊断**
 * （1145 / BUG-140）。
 *
 * CLI 的 check 编排在**包装层**（`packages/nudojs/src/commands/check.ts`）用
 * `setEvalFallbackCollector` 观测本文件的 `internal` 回落，并据此产出一条
 * error 级 `nudo:internal`（「the gate could not decide this file」）⇒ exit 1。
 * 但那条通道**只存在于 CLI 包装层**：不经过它的消费方（LSP 的
 * `validateText`、agent 工具、vite-plugin 的 evaluator 面）拿不到**任何**
 * 信号 ⇒ 同一个文件 **CI 红 / IDE 零诊断**（编辑器里看起来干干净净）。
 *
 * ⇒ 把「分析失败」提升为 **service 层**的诊断：所有消费方都从
 * `AnalysisResult.diagnostics` 拿 ⇒ CLI / IDE / 构建期**同源**地看到
 * 「这个文件没分析成功」。
 *
 * 观测手段是 core 的 `getEvalFallbackStats()`（**始终累计**的进程级计数器，
 * 与 `setEvalFallbackCollector` 的单槽 collector 无关）⇒ 本函数**不抢占**
 * 宿主的 collector（CLI 包装层那条通道照常工作，插件 / IDE 不再假绿）。
 * `analyzeFile` 是**同步**的 ⇒ 前后两次快照之间不会插进别的分析。
 */
function internalEvalFailureDiagnostic(
  filePath: string,
  count: number,
): Diagnostic {
  return {
    severity: "error",
    code: DIAG.internal,
    message:
      `analysis failed: module evaluation failed (engine internal fallback ×${count}) — ` +
      `${filePath} could not be evaluated, so the gate could not decide this file`,
    suggestions: [
      "fix the cause reported for this module, or file it as an engine bug together with the analysed file",
    ],
    // 无源位置：service 的占位约定（与 `analyzer-diagnose.ts` 同款）——
    // 引擎内部回落定位不到某一行，编造第 1 行会把读者引向错误的源码位置。
    range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
  };
}

/**
 * 整文件分析。同 (path, source, cases, external) 命中 memo → O(1)。
 * 不再每次 clearEvalCache：求值引擎按本文件 source 键控。
 *
 * `loadModule`：可选；提供时用于相对 import / 侧车 ambient（LSP
 * buffer-aware）。未提供时走 defaultLoadModule（磁盘）。
 *
 * 宿主契约：入口 source 未变但依赖模块内容变了时，必须调用
 * `evictEvalCacheForFiles` / `evictAnalysisFileCacheForFiles` /
 * `evictFnAnalysisCacheForFiles`（LSP 已接好）。非 LSP 宿主
 * （CLI watch / vite-plugin）在 dep 变更时应 `clearEvalCache()` 或上述逐出。
 */
export function analyzeFile(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: AnalyzeLoadModule,
  caseMode: DirectiveCaseMode = "all",
): AnalysisResult {
  // collector 作用域（幂等）：分析的 collector 安装点在此内层——同步入口同样
  // 先开作用域；嵌套（checkSource / analyzeFileAsync 外层）零开销复用。
  return runWithCollectorScope(() => {
    const projectConfig = findProjectConfig(dirname(filePath));
    const cfg = analysisConfig(projectConfig?.config);
    // 项目级 env 名**绝对化**（按项目根）——与收集期（`analyzeFileUncachedInner`）
    // 同一套规则：缓存键里的 env 维度必须是**解析后**的名字，否则「项目根之外的
    // 文件」与「项目根的文件」对同一 env 名给出不同键（Bug 1098 同源）。
    const projectEnvBaseDir = projectConfig?.projectDir ?? dirname(filePath);
    const rawProjectEnv = projectConfig?.config.env;
    const projectEnvNames = absolutizeEnvSpec(
      Array.isArray(rawProjectEnv) ? rawProjectEnv : [],
      projectEnvBaseDir,
    );
    const autoBind = interfaceConfig(projectConfig?.config).autoBind;
    const k = analysisFileCacheKey(
      filePath,
      source,
      activeCases,
      externalCallRecords,
      cfg,
      loadModule,
      projectEnvNames,
      autoBind !== false,
      caseMode,
    );
    if (!k.noCache) {
      const hit = analysisCacheGet<AnalysisResult>(k.filePath, k.source, k.auxKey);
      if (hit !== undefined) {
        return cloneAnalysisResult(hit);
      }
    }
    // BUG-140：本文件求值期间的 `internal` 回落观测起点（见
    // `internalEvalFailureDiagnostic`）。同步窗口 ⇒ 快照不会串台。
    const internalBefore = getEvalFallbackStats().internal;
    let result = analyzeFileUncached(
      filePath,
      source,
      activeCases,
      externalCallRecords,
      loadModule,
      caseMode,
    );
    // 引擎内部回落 = 该模块求值失败 ⇒ 闸门无法裁决（CLI 面 exit 1）。
    // 不追加 ⇒ 不经过 CLI 包装层的消费方（LSP / agent / 插件）零诊断
    // ⇒ IDE 面假绿（BUG-140）。
    const internalFallbacks = Math.max(
      0,
      getEvalFallbackStats().internal - internalBefore,
    );
    if (internalFallbacks > 0) {
      result = {
        ...result,
        diagnostics: [
          ...result.diagnostics,
          internalEvalFailureDiagnostic(filePath, internalFallbacks),
        ],
      };
    }
    if (!k.noCache) {
      analysisCacheSet(k.filePath, k.source, k.auxKey, result);
    }
    return cloneAnalysisResult(result);
  });
}

// ---------------------------------------------------------------------------
// 1145：模块级求值失败（闸门无法裁决该文件）——**按文件**观测
// ---------------------------------------------------------------------------

/**
 * 闸门**无法裁决该文件**的引擎回落的**按文件**观测结果。
 *
 * core 的回落两维（`packages/core/src/algebra/exec/run.ts` 的 `evalFallbackOf`
 * / `gateFatalOf`）：
 * - **标签（谁的责任）**：`unsupported:*`（能力边界）/ `module-throw`（程序
 *   自身抛：建模内抛 NudoThrow，或用户代码求值时逃逸的原生异常——BUG-073）/
 *   `internal`（引擎 / 宿主边界自身违约）；
 * - **可见性（闸门能不能裁决）**：`gateFatal` —— 装载期逃逸 ⇒ 该模块装载
 *   失败（导出全丢）⇒ 闸门看不到任何入口 ⇒ 零诊断 + exit 0 ⇒ **闸门假绿**
 *   （1145 / BUG-072）。
 *
 * ⇒ 进失败信号的是**可见性**（`gateFatal`），不是标签：
 * `internal`（引擎缺陷）恒进；`module-throw` 仅**装载期**逃逸时进（调用期的
 * 逃逸由该次调用的 throws 面承载）；`unsupported:*`（能力边界）**不进**
 * （不得大面积假红）。
 */
export type FileEvalFailure = {
  /** 被分析文件（绝对路径） */
  file: string;
  /** 回落原因（`internal` = 引擎缺陷 / `module-throw` = 装载期逃逸） */
  reason: string;
  /** 回落消息（引擎给出的失败详情） */
  message: string;
};

/**
 * 是否进失败信号（闸门必须 fail-closed）。
 *
 * `gateFatal` 是 core 侧算好的**可见性**维度（标签 ≠ 可见性）；`internal`
 * 兜底（老事件无 `gateFatal` 字段时仍按引擎缺陷处理）。
 */
function isGateFatalFallback(f: EvalFallback): boolean {
  if (f.reason === "internal") return true;
  return f.gateFatal === true;
}

/**
 * 分析一个文件 + 观测**该文件**的引擎内部回落（1145 观测面）。
 *
 * 与 {@link analyzeFile} 的差别：
 * 1. **不共享**整文件分析 memo（`analysisCacheGet/Set`）——memo 命中 ⇒ 不求值
 *    ⇒ 无回落可观测 ⇒ 「没看到失败」≠「没失败」（观测面会**假绿**）。
 *    观测面每次真求值（uncached 路径）。
 * 2. 额外返回 `evalFailures`（本次分析期间的 `internal` 回落，按文件定位）。
 *
 * ⚠ collector 是**进程级单槽**（core 的 `setEvalFallbackCollector`）：本函数
 * 安装期间**不得**有别的回落观察者（否则互相覆盖）。CLI 的 check 编排走自己
 * 的 per-file collector（`commands/check.ts`），不调用本函数。
 */
export function analyzeFileWithEvalFailures(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: AnalyzeLoadModule,
  /** 默认 all（库/测试兼容）；check/IDE 宿主应传 none（惰性 case） */
  caseMode: DirectiveCaseMode = "all",
): { analysis: AnalysisResult; evalFailures: FileEvalFailure[] } {
  const evalFailures: FileEvalFailure[] = [];
  setEvalFallbackCollector((f: EvalFallback) => {
    if (!isGateFatalFallback(f)) return;
    evalFailures.push({ file: filePath, reason: f.reason, message: f.message });
  });
  try {
    const analysis = analyzeFileUncached(
      filePath,
      source,
      activeCases,
      externalCallRecords,
      loadModule,
      caseMode,
    );
    return { analysis, evalFailures };
  } finally {
    setEvalFallbackCollector(null);
  }
}

/**
 * {@link analyzeFileAsync} 的观测面版本（1145）：env 预载 + 同步分析 +
 * **按文件**的引擎内部回落观测。
 */
export async function analyzeFileAsyncWithEvalFailures(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: AnalyzeLoadModule,
  /** 默认 all（库/测试兼容）；check/IDE 宿主应传 none（惰性 case） */
  caseMode: DirectiveCaseMode = "all",
): Promise<{ analysis: AnalysisResult; evalFailures: FileEvalFailure[] }> {
  // collector 作用域须在 await preloadPathEnvs 之前打开（与 analyzeFileAsync 同口径）。
  return runWithCollectorScope(async () => {
    await preloadAnalysisEnvs(filePath, source);
    return analyzeFileWithEvalFailures(
      filePath,
      source,
      activeCases,
      externalCallRecords,
      loadModule,
      caseMode,
    );
  });
}

