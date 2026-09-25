/**
 * orchestrate：analyzeFile / analyzeFileAsync / collectCallRecords 主编排。
 * 自 analyzer.ts 机械拆出；语义未改。
 */
import { realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Node } from "@babel/types";
import { createEnvironment, type Environment, generalizeFromAst, setBCallCollector, getBCallCollector, getFnImpl, markPureFn, $call, unknown as absUnknown, anyAbs, formatAbs, formatShape, leqAbs, localNamedExports, effectiveInterface, abs as makeAbsVal, formalParamsFromNodes, type Abs, type BCallRecord } from "@nudojs/core";
import { setMayThrowCollector, runWithMayThrowSession, mayThrowEffectsToAbs, formatThrowsAbs, type MayThrowEffect, checkInjectedDomainEvidence, runWithEvalMissingSlot, fnFingerprints, loadModuleDepsFingerprint, hashSource } from "@nudojs/core/internal";
import { parse, extractDirectives, extractFileDirectives } from "@nudojs/parser";
import {
  collapseAbsLits,
  isLeakedCallRecord,
  neverAbs,
  undefAbs,
  widenJoinAbs,
  type CallRecord,
} from "./evaluator/call-record.ts";
import { loadEnvs, preloadPathEnvs } from "./evaluator/env-loader.ts";
import { findProjectConfig, interfaceConfig, analysisConfig } from "./evaluator/config.ts";
import { mockDirectivesToAbsSeeds, mockSeedsToAbsMocks, mockSeedsForSource } from "./mock-abs.ts";
import { applyMockModuleDirectives } from "./mock-module.ts";
import { defaultLoadModule } from "./load-module.ts";
import { noteEnvPathDeps } from "./env-path-deps.ts";
import { evalAbsModuleGraph, collectAbsBindingsFromGraph } from "./abs-modules-graph.ts";
import {
  tryBPathCall,
  tryBPathCallFull,
  tryRunBPath,
  isBPathCapable,
  mockSeedFingerprint,
  collectEnvGlobals,
  collectEnvModules,
  mergeHarvestUnderEnv,
  setEnvHarvestConflictCollector,
  type EnvHarvestConflict,
} from "./bpath-run.ts";
import { collectBPathDiagnostics } from "./bpath-diagnostics.ts";
import { dualEntryForFile, dualEntryMessage, dualEntrySuggestion } from "./dual-entry.ts";
import { setAbsTruncationCollector } from "@nudojs/core/internal";
import { analysisCacheGet, analysisCacheSet } from "./analysis-file-cache.ts";
import {
  fnAnalysisCacheGet,
  fnAnalysisCacheSet,
  caseDirectiveKey,
  type CachedFnAnalysis,
} from "./fn-analysis-cache.ts";
import type {
  AnalysisResult,
  AnalyzeLoadModule,
  BindingInfo,
  CaseHint,
  CaseResult,
  Diagnostic,
  DirectiveCaseMode,
  FunctionAnalysis,
  SourceLocation,
} from "./analyzer-types.ts";
import {
  locFromNode,
  extractParamNames,
  resolveFunctionNode,
  fnNameLoc,
  collectTopLevelFunctions,
  findSingleModuleExportsFunction,
  collectBindings,
  buildNodeTypeMap,
} from "./analyzer-ast.ts";
import {
  validateMockDirectives,
  dedupeCallRecords,
  synthesizeExternalFunctions,
  findModuleImportLoc,
  DEFAULT_CALLSITE_BUDGET,
  COLLAPSE_LITERAL_THRESHOLD,
} from "./analyzer-diagnose.ts";
import { analysisFileCacheKey, cloneAnalysisResult, cloneFunctionAnalysis, shiftSourceLoc, shiftDiagnosticLines, shiftCallRecordLines } from "./analyzer-cache.ts";
import {
  buildAbsImportLocalMap,
  callRecordFromAbsCall,
  tryEvalAbsRaw,
  tryEvalAbsFull,
  tryEvalEntryAbs,
  tryAttachIntension,
  attachHofSnapshot,
  attachAbsToIntension,
  absIsBetter,
  isSelfContainedSource,
  absModulesOk,
} from "./analyzer-abs-eval.ts";

export function collectEnvNames(filePath: string, source: string, includeProject: boolean): string[] {
  const ast = parse(source);
  const fileDirectives = extractFileDirectives(ast);
  const fileEnvNames = fileDirectives
    .filter((d) => d.kind === "env")
    .flatMap((d) => d.envs);
  if (!includeProject) return fileEnvNames;
  const projectConfig = findProjectConfig(dirname(filePath));
  const projectEnvNames = projectConfig?.config.env ?? [];
  return [...new Set([...projectEnvNames, ...fileEnvNames])];
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
  const envNames = collectEnvNames(filePath, source, true);
  // path-based @nudo:env / mock-module 反向边（watch 失效）
  noteEnvPathDeps(filePath, source);
  if (envNames.length > 0) {
    await preloadPathEnvs(envNames, dirname(filePath));
  }
  return analyzeFile(filePath, source, activeCases, externalCallRecords, loadModule, caseMode);
}

/**
 * 调用点发现（阶段一）：在"使用现场"文件（测试 / 上层应用）中求值
 * 顶层代码，收集它对（外部模块导出的）函数的调用记录。每条记录带
 * 真实的实参类型与结果类型——后续 analyzeFile 将其注入合成 case，
 * 使被使用方从 entry-only（参数全 unknown）升级为真实调用形态。
 *
 * Abs 路径（TypeValue evaluateProgram 已删）：evalAbsModuleGraph + AbsCallRecord。
 * 只做求值与记录，不产出诊断；求值异常不抛出（使用现场文件可能
 * 依赖未 mock 的全局，收集不到就收集不到，不能拖垮主分析）。
 */
export function collectCallRecords(filePath: string, source: string): CallRecord[] {
  // 统一 B（exec 模式）：顶层调用 + 测试回调展开（it/describe/test 的
  // 回调体才是真实调用点——以 unknown 实参 $call 展开，队列自然处理
  // describe 嵌套）。Abs 通道仅兜底（B 失败/历史语法）。
  if (filePath) {
    try {
      const mocks = mockSeedsForSource(source, {
        fromFile: filePath || undefined,
      });
      const run = tryRunBPath(source, filePath, {
        mode: "exec",
        lenientGlobals: true,
        ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
      });
      if (run?.calls?.length) {
        const importLocals = buildAbsImportLocalMap(source, filePath);
        return expandTestCallbacks(run.calls).map((r) => callRecordFromAbsCall(r, importLocals));
      }
    } catch {
      /* B 失败 fail-closed */
    }
  }
  // fail-closed：B 失败（历史语法/B-incapable 构造）→ 无记录（旧 Abs 兜底已删）
  return [];
}

/** 测试回调展开：describe 队列展开（预算 + 对象去重防自注册死循环） */
export function expandTestCallbacks(calls: BCallRecord[]): BCallRecord[] {
  const out = [...calls];
  const seenDescribe = new Set<object>();
  let cursor = 0;
  let expanded = 0;
  while (cursor < out.length && expanded < 500) {
    const rec = out[cursor++]!;
    if (rec.fnName !== "it" && rec.fnName !== "test" && rec.fnName !== "describe") continue;
    for (const a of rec.args) {
      if (!a || typeof a !== "object" || !("shape" in (a as object))) continue;
      const abs = a as Abs;
      if (abs.shape.k !== "fn") continue;
      if (rec.fnName === "describe") {
        if (seenDescribe.has(abs)) continue;
        seenDescribe.add(abs);
      }
      const impl = getFnImpl(abs);
      const params = impl?.params ?? [];
      // 以 unknown 执行回调体——内部调用点经 BCallCollector 追加
      const collected: BCallRecord[] = [];
      const prev = getBCallCollector();
      setBCallCollector((r) => collected.push(r));
      try {
        $call(abs, params.map(() => absUnknown));
      } catch {
        /* 单个回调失败不影响其余 */
      } finally {
        setBCallCollector(prev);
      }
      out.push(...collected);
      expanded++;
    }
  }
  return out;
}

const TEST_CALLBACK_NAMES = new Set(["it", "test", "describe"]);

/**
 * 整文件分析。同 (path, source, cases, external) 命中 memo → O(1)。
 * 不再每次 clearBPathCache：B 路径按本文件 source 键控。
 *
 * `loadModule`：可选；提供时用于相对 import / 侧车 ambient（LSP
 * buffer-aware）。未提供时走 defaultLoadModule（磁盘）。
 *
 * 宿主契约：入口 source 未变但依赖模块内容变了时，必须调用
 * `evictBPathCacheForFiles` / `evictAnalysisFileCacheForFiles` /
 * `evictFnAnalysisCacheForFiles`（LSP 已接好）。非 LSP 宿主
 * （CLI watch / vite-plugin）在 dep 变更时应 `clearBPathCache()` 或上述逐出。
 */
export function analyzeFile(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: AnalyzeLoadModule,
  caseMode: DirectiveCaseMode = "all",
): AnalysisResult {
  const projectConfig = findProjectConfig(dirname(filePath));
  const cfg = analysisConfig(projectConfig?.config);
  const projectEnvNames = projectConfig?.config.env ?? [];
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
  const result = analyzeFileUncached(
    filePath,
    source,
    activeCases,
    externalCallRecords,
    loadModule,
    caseMode,
  );
  if (!k.noCache) {
    analysisCacheSet(k.filePath, k.source, k.auxKey, result);
  }
  return cloneAnalysisResult(result);
}

export function analyzeFileUncached(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: AnalyzeLoadModule,
  caseMode: DirectiveCaseMode = "all",
): AnalysisResult {
  // C0.5：per-analysis 作用域（ALS），禁止分析间 flag 粘滞 / 并发串档
  const projectConfig = findProjectConfig(dirname(filePath));
  const missingSlotOn = analysisConfig(projectConfig?.config).evalMissingSlot === "warning";
  return runWithEvalMissingSlot(missingSlotOn, () =>
    analyzeFileUncachedInner(
      filePath,
      source,
      activeCases,
      externalCallRecords,
      loadModule,
      caseMode,
    ),
  );
}

export function analyzeFileUncachedInner(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: AnalyzeLoadModule,
  caseMode: DirectiveCaseMode = "all",
): AnalysisResult {
  const ast = parse(source);
  const functions = extractDirectives(ast);
  const diagnostics: Diagnostic[] = [];
  const bindings = new Map<string, BindingInfo>();
  const nodeAbsMap = new Map<Node, Abs>();
  const functionResults: FunctionAnalysis[] = [];
  const caseHints: CaseHint[] = [];
  const envHarvestConflicts: EnvHarvestConflict[] = [];
  // Save/restore so nested analyzeFile calls do not clobber each other's sink.
  const prevHarvestConflictCollector = setEnvHarvestConflictCollector((c) => {
    if (!envHarvestConflicts.some((x) => x.module === c.module)) {
      envHarvestConflicts.push(c);
    } else {
      const prev = envHarvestConflicts.find((x) => x.module === c.module)!;
      for (const e of c.exports) {
        if (!prev.exports.includes(e)) prev.exports.push(e);
      }
      prev.defaultOverwritten ||= c.defaultOverwritten;
    }
  });

  const fileDirectives = extractFileDirectives(ast);
  const fileEnvNames = fileDirectives
    .filter((d) => d.kind === "env")
    .flatMap((d) => d.envs);

  const projectConfig = findProjectConfig(dirname(filePath));
  const projectEnvNames = projectConfig?.config.env ?? [];
  const envNames = [...new Set([...projectEnvNames, ...fileEnvNames])];
  const analysisCfg = analysisConfig(projectConfig?.config);
  const callSiteBudget = analysisCfg.callSiteBudget;

  const callRecords: CallRecord[] = [];
  // Environment 绑定 Abs（BindingInfo.abs）；nodeAbsMap 另走 absBinds
  const globalEnv = createEnvironment();

  /** B 路径已报告的 method/property 名（避免双报） */
  const bMemberDiagNames = new Set<string>();
  const bMemberDiagSeen = new Set<string>();
  const pushBMemberDiag = (d: { kind: string; name: string; receiver: string; line?: number; column?: number; origin?: { line: number; column: number }; code?: string }, fallbackLine: number) => {
    bMemberDiagNames.add(d.name);
    const key = `${d.kind}:${d.name}:${d.receiver}:${d.line ?? fallbackLine}:${d.column ?? 0}:${d.code ?? ""}`;
    if (bMemberDiagSeen.has(key)) return;
    bMemberDiagSeen.add(key);
    // C0.5：求值命中闭 shape 缺槽（默认 off；per-analysis ALS 已就绪）
    if (d.code === "nudo:missing-slot") {
      diagnostics.push({
        range: {
          start: { line: d.line ?? fallbackLine, column: d.column ?? 0 },
          end: { line: d.line ?? fallbackLine, column: (d.column ?? 0) + d.name.length },
        },
        severity: "warning",
        message: `Field '${d.name}' is missing on the evaluated object shape`,
        code: "nudo:missing-slot",
        ...(d.origin ? { origin: d.origin } : {}),
      });
      return;
    }
    // unknown 接收者 → unknown-recv（与 TypeValue 口径一致，warning）
    if (d.receiver === "unknown") {
      diagnostics.push({
        range: {
          start: { line: d.line ?? fallbackLine, column: d.column ?? 0 },
          end: { line: d.line ?? fallbackLine, column: (d.column ?? 0) + d.name.length },
        },
        severity: "warning",
        message: `Cannot resolve '${d.name}' on unknown value`,
        code: "nudo:unknown-recv",
        ...(d.origin ? { origin: d.origin } : {}),
      });
      return;
    }
    diagnostics.push({
      range: {
        start: { line: d.line ?? fallbackLine, column: d.column ?? 0 },
        end: { line: d.line ?? fallbackLine, column: (d.column ?? 0) + d.name.length },
      },
      severity:
        d.receiver === "number" || d.receiver === "boolean" || d.receiver === "bigint" || d.receiver === "symbol"
          ? "error"
          : "warning",
      message:
        d.kind === "method"
          ? `Method '${d.name}' does not exist on type '${d.receiver}'`
          : `Property '${d.name}' does not exist on type '${d.receiver}'`,
      code: "nudo:no-method",
      ...(d.origin ? { origin: d.origin } : {}),
    });
  };

  // @nudo:mock 静态校验始终执行（B hosted 也要报 mock-invalid）
  for (const fn of functions) {
    validateMockDirectives(fn.directives, diagnostics);
  }

  // @nudo:mock 已编译为 Abs seed 注入（mockDirectivesToAbsSeeds）；无 TypeValue applyMocks。
  const selfContained = isSelfContainedSource(source, envNames);
  const canAbsModules = absModulesOk(source, envNames);
  const bCapable = isBPathCapable(source, envNames);

  /** B 已上报的模块加载问题种类 + 递归截断函数名（压 TypeValue 叠报） */
  const bModuleIssueKinds = new Set<"cycle" | "depth" | "missing">();
  const bTruncatedFns = new Set<string>();
  /** B 静态 builtin-unknown 名（压 TypeValue unknown-global 叠报） */
  const bBuiltinUnknownNames = new Set<string>();
  /** B 成功跑通本文件 → TypeValue method/property 诊断整类让位 */
  let bHostedEval = false;

  const pushBModuleIssues = (
    issues: Array<{ kind: "cycle" | "depth" | "missing"; label: string; reason: string }> | undefined,
  ) => {
    if (!issues) return;
    for (const iss of issues) {
      bModuleIssueKinds.add(iss.kind);
      const code =
        iss.kind === "cycle"
          ? "nudo:module-cycle"
          : iss.kind === "depth"
            ? "nudo:module-depth"
            : "nudo:module-missing";
      diagnostics.push({
        range: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
        severity: iss.kind === "missing" ? "error" : "warning",
        message: iss.reason,
        code,
      });
    }
  };

  const seeds = mockDirectivesToAbsSeeds(functions, {
    fromFile: filePath || undefined,
    ...(loadModule ? { loadModule } : {}),
  });
  // @nudo:mock name from "path" 解析失败 → 明确诊断（缺文件/缺绑定/求值失败），不静默丢弃
  for (const fe of seeds.fromErrors ?? []) {
    diagnostics.push({
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
      severity: "error",
      message: fe.message,
      code: "nudo:module-missing",
      suggestions: [
        `Create the mock file or fix the path in @nudo:mock ${fe.name} from "${fe.fromPath}"`,
        "The mock module must define a binding with the same name as the mock",
      ],
    });
  }
  let absCallRecords: CallRecord[] = [];
  /** B 顶层 $callNamed 记录（call@ 合成；TypeValue skip 后的主源） */
  let bTopCallRecords: CallRecord[] = [];
  /** 一次 evalAbsModuleGraph（模块图求值）的共享产物（避免 B 路径 4+ 次重求值） */
  let absGraphModules: Record<string, import("@nudojs/core").AbsModuleExports> | undefined;
  let absBindsShared: Map<string, Abs> | undefined;
  let absNodesShared: Map<Node, Abs> | undefined;

  // B 模块图：cycle/depth/missing + 顶层 memberDiags（注入 @nudo:mock，
  // 避免缩进 const 调到真 fetch；$callNamed 实参 loc 提供参数级 provenance）
  if (bCapable && filePath) {
    try {
      const g = evalAbsModuleGraph(source, filePath, {
        seedVars: seeds.seedVars,
        seedFns: seeds.seedFns as never,
        ...(loadModule ? { loadModule } : {}),
      });
      // env modules 必须并入图：@nudo:env 的 node:* / 裸包由 loadEnvs 提供，
      // 模块图只处理相对 import 与 harvest 裸包（跳过 node: 前缀）。
      // 手写 env 在重叠模块/导出上 wins（B8）；harvest 只补洞。
      absGraphModules = mergeHarvestUnderEnv(g.modules, collectEnvModules(envNames));
      // @nudo:mock-module：覆盖 import 说明符的导出表（全量/局部）
      const mm = applyMockModuleDirectives(absGraphModules, fileDirectives, {
        fromFile: filePath,
        ...(loadModule ? { loadModule } : {}),
      });
      absGraphModules = mm.modules;
      for (const fe of mm.errors) {
        diagnostics.push({
          range: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
          severity: "error",
          message: fe.message,
          code: "nudo:module-missing",
        });
      }
      pushBModuleIssues(g.issues);
    } catch {
      /* 模块图失败交还 TypeValue */
    }
    const bRun = tryRunBPath(source, filePath, {
      envNames,
      mocks: mockSeedsToAbsMocks(seeds),
    });
    if (bRun) {
      bHostedEval = true;
      if (bRun.memberDiags?.length) {
        for (const d of bRun.memberDiags) {
          pushBMemberDiag(d, 1);
        }
      }
      if (bRun.truncatedFns) {
        for (const fn of bRun.truncatedFns) bTruncatedFns.add(fn);
      }
      if (bRun.calls?.length) {
        const impMap = buildAbsImportLocalMap(source, filePath);
        for (const c of bRun.calls) {
          bTopCallRecords.push(callRecordFromAbsCall(c, impMap));
        }
      }
    }
  }
  // fail-closed：Abs 调用记录通道已删（collectAbsCallRecords）——非 B-hosted
  // 源的调用点仅来自 B 顶层记录（bTopCallRecords）

  // fail-closed：bHostedEval 的 Abs bindings/nodeTypes 补齐已删
  // （collectAbsBindsAndNodes）——B 侧的 nodeTypeMap/binding 通道是唯一源

  // TypeValue evaluateProgram / applyMocks 已删除：非 B-hosted 源不跑全程序求值；
  // 绑定/节点靠 Abs 宿主（collectAbsBindsAndNodes）。case 兜底 Abs-first。

  // Abs / B 顶层调用记录：B-hosted 时 B 路径优先（调用点实参含宿主 JS 函数
  // 时 Abs 会把它们打成 unknown——C3.1）；否则 Abs 优先。
  if (bHostedEval && bTopCallRecords.length > 0) {
    callRecords.length = 0;
    callRecords.push(...bTopCallRecords);
  } else if ((selfContained || canAbsModules) && absCallRecords.length > 0) {
    callRecords.length = 0;
    callRecords.push(...absCallRecords);
  } else if (bTopCallRecords.length > 0) {
    callRecords.length = 0;
    callRecords.push(...bTopCallRecords);
  }

  const unreachableRanges: SourceLocation[] = [];
  if (bCapable) {
    // B 路径静态诊断接管 unreachable + builtin-unknown
    // env/mock 已覆盖的全局不在 builtin-unknown 之列（B 注入后不再是裸原生调用）
    const bKnownGlobals = new Set<string>([
      ...Object.keys(collectEnvGlobals(envNames)),
      ...Object.keys(mockSeedsToAbsMocks(seeds)),
    ]);
    const bDiag = collectBPathDiagnostics(source, bKnownGlobals);
    for (const ur of bDiag.unreachable) {
      diagnostics.push({
        range: ur.range,
        severity: "info",
        message: "Code after return/throw statement is unreachable",
        tags: ["unnecessary"],
        code: "nudo-unreachable",
        suggestions: ["Remove the unreachable code after the return/throw statement"],
      });
    }
    for (const b of bDiag.builtinUnknown) {
      bBuiltinUnknownNames.add(b.name);
      diagnostics.push({
        range: b.range,
        severity: "warning",
        message: `Built-in API "${b.name}" is not covered by Nudo's type inference`,
        code: "nudo:builtin-unknown",
        suggestions: [
          `Use @nudo:mock to define the type: @nudo:mock ${b.name} = stub().returns(...)`,
          `Or use @nudo:contract return <constraint> to declare the return contract`,
        ],
      });
    }
  } else {
    for (const ur of unreachableRanges) {
      diagnostics.push({
        range: ur,
        severity: "info",
        message: "Code after return/throw statement is unreachable",
        tags: ["unnecessary"],
        code: "nudo-unreachable",
        suggestions: ["Remove the unreachable code after the return/throw statement"],
      });
    }
  }

  // Abs 宿主补齐（T15）：B 未成功宿主时仍收集 Abs 绑定/节点表——
  // BindingInfo.abs / nodeAbsMap / hover / completions 不必等 B 成功。
  if (!absNodesShared && !bHostedEval && (selfContained || canAbsModules)) {
    try {
      const collected = { binds: new Map<string, Abs>(), nodes: new Map<Node, Abs>() }; // fail-closed
      if (!absBindsShared) absBindsShared = collected.binds;
      absNodesShared = collected.nodes;
    } catch {
      /* Abs 补齐失败仍以 TypeValue 为准 */
    }
  }

  collectBindings(ast, globalEnv, bindings, absBindsShared);

  // fail-closed：绑定补全仅来自 B run 的绑定表（bindingsOf）；Abs 模块图
  // 宿主已删。B 不可用 → 无补全（显式无信息）。
  if (isBPathCapable(source, envNames)) {
    try {
      // 绑定补全走 B 版 collectAbsBindingsFromGraph：recordBinding 顶层绑定
      // + 导出桥 + import 局部名（静态解析依赖模块）——单一事实源
      const absBinds = absBindsShared ?? collectAbsBindingsFromGraph(source, filePath, {
        seedVars: seeds.seedVars,
        seedFns: seeds.seedFns as never,
      });
      if (!absBinds) {
        /* fail-closed：无绑定补全 */
      } else for (const [name, absVal0] of absBinds) {
        const absVal = absVal0 as Abs;
        const prev = bindings.get(name);
        bindings.set(name, {
          abs: absVal,
          loc: prev?.loc,
        });
      }
    } catch {
      /* keep TypeValue bindings */
    }
  }

  const synthCandidates: { name: string; node: Node; analysis: FunctionAnalysis; assignedName?: string }[] = [];

  // 函数级指纹：body-edit 时未引用的兄弟函数可命中缓存
  let fnFpMap: Map<string, { own: string; deps: string }> | undefined;
  try {
    fnFpMap = fnFingerprints(source, ast as never);
  } catch {
    fnFpMap = undefined;
  }
  const envKeyFn = envNames.join(",");
  const mockKeyFn = mockSeedFingerprint(seeds.seedVars, seeds.seedFns);

  for (const fn of functions) {
    const isPure = fn.directives.some((d) => d.kind === "pure");
    const skipDirective = fn.directives.find((d) => d.kind === "skip");

    const fnLoc = locFromNode(fn.node);
    const paramNames = extractParamNames(fn.node);
    const formals = formalParamsFromNodes(
      ((fn.node as { params?: unknown[] }).params ?? []) as never,
    );
    const analysis: FunctionAnalysis = {
      name: fn.name,
      loc: fnLoc,
      paramNames,
      ...(formals.length > 0 ? { formals } : {}),
      cases: [],
    };

    if (skipDirective && skipDirective.kind === "skip") {
      analysis.skipped = true;
      if (skipDirective.returns) {
        analysis.combinedAbs = skipDirective.returns;
      }
      functionResults.push(analysis);
      continue;
    }

    const caseDirectives = fn.directives.filter((d) => d.kind === "case");
    const activeCaseIdx = activeCases?.get(fn.name) ?? 0;
    // 惰性 case：默认不跑 @nudo:case（check/IDE）；test 全跑；selectCase 只跑选中
    const caseIdxsToRun: number[] =
      caseMode === "none" || caseDirectives.length === 0
        ? []
        : caseMode === "all"
          ? caseDirectives.map((_, i) => i)
          : activeCases?.has(fn.name)
            ? [Math.min(activeCaseIdx, caseDirectives.length - 1)]
            : [];

    // Per-fn cache is intentionally case-scoped: synthesized cases (no
    // @nudo:case) are built from whole-file call records observed while
    // evaluating *other* functions — own/deps fingerprints cannot see those
    // call sites, so caching a synthesis result under own/deps would be
    // unsound (sibling body-edit that changes a call to this fn would miss
    // the fingerprint). Case-directive results are self-contained.
    const fp = fnFpMap?.get(fn.name);
    // analysis 配置维度进 fn 键：evalMissingSlot / budget 等变更必须 miss
    // （整文件键已含，fn 键不加会陈旧命中 C0.5 诊断）
    const analysisFnKey = `m=${analysisCfg.mode}|e=${analysisCfg.evalMissingSlot}|b=${analysisCfg.callSiteBudget}`;
    // dep 内容进 fn 键（default 与 custom loader 同口径），避免入口文本未变时旧诊断命中
    // truncated / fingerprint 失败：与整文件 noCache 同口径 fail-closed
    let fnDepSeg: string | null = "-";
    let fnDepFailClosed = false;
    try {
      const dfp = loadModuleDepsFingerprint(source, loadModule ?? defaultLoadModule, filePath);
      if (dfp.truncated) {
        fnDepFailClosed = true;
        fnDepSeg = null;
      } else {
        fnDepSeg = hashSource(dfp.fp);
      }
    } catch {
      fnDepFailClosed = true;
      fnDepSeg = null;
    }
    const fnCacheKey =
      !fnDepFailClosed && fp && caseDirectives.length > 0
        ? [
            filePath,
            fp.own,
            fp.deps,
            String(activeCaseIdx),
            caseDirectiveKey(caseDirectives, formatAbs),
            envKeyFn,
            mockKeyFn,
            analysisFnKey,
            fnDepSeg ?? "-",
            `cm=${caseMode}`,
          ].join("\0")
        : undefined;
    const dLen0 = diagnostics.length;
    const hLen0 = caseHints.length;
    const cLen0 = callRecords.length;

    if (fnCacheKey) {
      const hitFn = fnAnalysisCacheGet(fnCacheKey);
      if (hitFn) {
        const cached = cloneFunctionAnalysis(hitFn.analysis as FunctionAnalysis);
        // own-hash is position-free: sibling inserts shift lines. Rewrite loc
        // onto the current AST and shift any cached line-relative fields.
        const lineDelta = fnLoc.start.line - cached.loc.start.line;
        cached.loc = fnLoc;
        if (lineDelta !== 0) {
          for (const c of cached.cases) {
            if (c.throwLoc) c.throwLoc = shiftSourceLoc(c.throwLoc, lineDelta);
          }
        }
        if (lineDelta === 0) {
          diagnostics.push(...(hitFn.diagnostics as Diagnostic[]));
          caseHints.push(...(hitFn.caseHints as CaseHint[]));
          callRecords.push(...(hitFn.callRecords as CallRecord[]));
        } else {
          for (const d of hitFn.diagnostics as Diagnostic[]) {
            diagnostics.push(shiftDiagnosticLines(d, lineDelta));
          }
          for (const h of hitFn.caseHints as CaseHint[]) {
            caseHints.push({ ...h, line: h.line + lineDelta });
          }
          for (const r of hitFn.callRecords as CallRecord[]) {
            callRecords.push(shiftCallRecordLines(r, lineDelta));
          }
        }
        functionResults.push(cached);
        continue;
      }
    }

    if (isPure) {
      const fnVal = globalEnv.has(fn.name) ? globalEnv.lookup(fn.name) : null;
      if (fnVal && typeof fnVal === "object") {
        markPureFn(fnVal as object, fn.name);
      }
    }

    const sampleDirective = fn.directives.find((d) => d.kind === "sample");
    void sampleDirective; // TypeValue setSampleCount 已删

    // 无 case，或本轮不求值 case（none / selected 未命中）→ entry@ 出签名
    if (caseIdxsToRun.length === 0) {
      synthCandidates.push({ name: fn.name, node: fn.node, analysis });
    }

    for (const ci of caseIdxsToRun) {
      const directive = caseDirectives[ci]!;

      let caseAbs: Abs | undefined;
      let caseThrowsAbs: Abs | undefined;
      let caseThrowLoc: SourceLocation | undefined;
      let caseUnreachable: SourceLocation[] = [];

      const bCapable = isBPathCapable(source, envNames);
      const bPrimary = bCapable;
      if (bCapable && filePath) {
        const caseArgsAbs = directive.argsAbs;
        const bFull = tryBPathCallFull(
          source,
          filePath,
          fn.name,
          caseArgsAbs,
          { collectCalls: true, envNames, mocks: mockSeedsToAbsMocks(seeds) },
        );
        const res = bFull?.result;
        const weakUnknown =
          !!res &&
          res.shape.k === "unknown" &&
          (!res.term || (res.term.op === "lit" && res.term.value === undefined));
        const bOk = !!res && (bHostedEval || (!weakUnknown && res.conf !== "opaque"));
        if (bOk && bFull && bPrimary) {
          caseAbs = bFull.result;
          caseThrowsAbs = bFull.throws;
          for (const d of bFull.memberDiags ?? []) {
            pushBMemberDiag(d, fnLoc.start.line);
          }
          if (bFull.calls?.length) {
            const impMap = buildAbsImportLocalMap(source, filePath);
            for (const c of bFull.calls) {
              callRecords.push(callRecordFromAbsCall(c, impMap));
            }
          }
        }
      }

      if (!caseAbs) {
        if (bHostedEval) {
          caseAbs = absUnknown;
          caseThrowsAbs = neverAbs;
        } else {
          const caseArgsAbs = directive.argsAbs;
          const absFull = (selfContained || canAbsModules)
            ? tryEvalAbsFull(
                source,
                fn.name,
                caseArgsAbs,
                filePath,
                mockSeedsToAbsMocks(seeds),
              )
            : undefined;
          const weak =
            !!absFull &&
            absFull.result.shape.k === "unknown" &&
            (!absFull.result.term ||
              (absFull.result.term.op === "lit" && absFull.result.term.value === undefined));
          const absOk =
            !!absFull &&
            !weak &&
            absFull.result.conf !== "opaque" &&
            absFull.throws.shape.k === "never";
          const absThrew =
            !!absFull &&
            !weak &&
            absFull.result.shape.k === "never" &&
            absFull.throws.shape.k !== "never";
          if (absOk) {
            caseAbs = absFull.result;
            caseThrowsAbs = neverAbs;
          } else if (absThrew) {
            caseAbs = absFull!.result; // never
            caseThrowsAbs = absFull!.throws;
            const tl = absFull!.throwLoc;
            if (tl) caseThrowLoc = { start: { ...tl }, end: { ...tl } };
          } else {
            caseAbs = absUnknown;
            caseThrowsAbs = neverAbs;
          }
        }
      }
      if (!caseThrowsAbs) caseThrowsAbs = neverAbs;

      const caseEntry: CaseResult = {
        name: directive.name,
        argAbs: directive.argsAbs,
        abs: caseAbs,
        throwsAbs: caseThrowsAbs,
        throwLoc: caseThrowLoc,
        expected: directive.expected,
        source: "directive",
      };
      tryAttachIntension(caseEntry, source, fn.name);
      attachAbsToIntension(caseEntry, caseAbs, fn.name);
      analysis.cases.push(caseEntry);

      if (directive.commentLine) {
        const hasThrow = caseThrowsAbs.shape.k !== "never";
        const resultStr = caseAbs.shape.k !== "never" ? formatShape(caseAbs) : "";
        const throwStr = hasThrow ? `throws ${formatShape(caseThrowsAbs)}` : "";
        const label = [resultStr, throwStr].filter(Boolean).join(" ");
        const hintLabel = `=> ${label}`;

        let ok = true;
        if (directive.expected) {
          ok = leqAbs(caseAbs, directive.expected).ok;
          if (!ok) {
            diagnostics.push({
              range: { start: { line: directive.commentLine, column: 0 }, end: { line: directive.commentLine, column: 999 } },
              severity: "error",
              message: `debug "${directive.name}": expected ${formatShape(directive.expected)}, got ${formatShape(caseAbs)}. The inferred return type does not match the expected type declared in the @nudo:case witness`,
              code: "nudo:case-expected",
            });
          }
        }

        caseHints.push({ line: directive.commentLine, label: hintLabel, ok });
      }

      const isActive = ci === Math.min(activeCaseIdx, caseDirectives.length - 1);

      if (isActive) {
        if (caseThrowsAbs.shape.k !== "never") {
          const throwRange = caseThrowLoc ?? fnLoc;
          diagnostics.push({
            range: throwRange,
            severity: "warning",
            message: `Function "${fn.name}" case "${directive.name}" may throw: ${formatShape(caseThrowsAbs)}. Consider adding a try-catch block or using @nudo:contract return <constraint>`,
            code: "nudo:may-throw",
          });
        }

        // B 路径可分析时文件级静态收集已报 unreachable，跳过 case 级
        if (!isBPathCapable(source, envNames)) {
          for (const ur of caseUnreachable) {
            diagnostics.push({
              range: ur,
              severity: "info",
              message: "Code after return/throw statement is unreachable",
              tags: ["unnecessary"],
              code: "nudo-unreachable",
              suggestions: ["Remove the unreachable code after the return/throw statement"],
            });
          }
        }
      }
    }

    if (analysis.cases.length > 0) {
      analysis.combinedAbs = collapseAbsLits(
        analysis.cases.map((c) => c.abs),
        COLLAPSE_LITERAL_THRESHOLD,
      );
    }

    attachHofSnapshot(analysis, source);

    if (fnCacheKey) {
      fnAnalysisCacheSet(fnCacheKey, {
        analysis: cloneFunctionAnalysis(analysis),
        diagnostics: diagnostics.slice(dLen0),
        caseHints: caseHints.slice(hLen0),
        callRecords: callRecords.slice(cLen0),
      });
    }

    functionResults.push(analysis);
  }

  // Whole-program call inference: functions without @nudo:case directives
  // get cases synthesized from observed call sites; functions with no call
  // sites at all get a single entry evaluation with unknown parameters.
  const directiveFnNames = new Set(functions.map((f) => f.name));
  const directiveFnStmts = new Set(functions.map((f) => f.node));
  for (const { name, node, stmt, noDeclaration, assignedName } of collectTopLevelFunctions(ast)) {
    if (directiveFnNames.has(name)) continue;
    // A statement carrying @nudo directives is already analyzed through the
    // directive path above (possibly under its "<anonymous>" name).
    if (directiveFnStmts.has(stmt)) continue;
    const analysis: FunctionAnalysis = { name, loc: locFromNode(node), paramNames: extractParamNames(node), cases: [] };
    if (noDeclaration) analysis.noDeclaration = true;
    functionResults.push(analysis);
    synthCandidates.push({ name, node, analysis, assignedName });
  }

  // 模块路匹配的前置量：本文件绝对路径（realpath 对齐符号链接后再比，
  // 双侧同一归一化函数，避免单侧 realpath 造成不一致），以及
  // `module.exports = function` 单导出形态的目标函数。
  const modulePathCache = new Map<string, string>();
  const normalizeModulePath = (p: string): string => {
    let n = modulePathCache.get(p);
    if (n === undefined) {
      try {
        n = realpathSync(p);
      } catch {
        n = p;
      }
      modulePathCache.set(p, n);
    }
    return n;
  };
  const currentModulePath = normalizeModulePath(resolve(filePath));
  const singleExportFn = findSingleModuleExportsFunction(ast);

  // T10b：跨文件注入的调用点域证据 ⊄ 手写契约 → nudo:interface-domain-exceeds
  // （error）。带 @nudo:case 的函数同样检查——case 路径只覆盖本文件内 case
  // 实参 vs 契约；跨文件注入证据此前是执法盲区。
  const reportInjectedDomainExceeds = (
    name: string,
    node: Node,
    fallbackLoc: SourceLocation,
  ): void => {
    if (!externalCallRecords || externalCallRecords.length === 0) return;
    const singleExportHit = singleExportFn !== null && node === singleExportFn;
    const nameRoutes = (r: CallRecord): boolean =>
      r.fnName === name ||
      r.targetExport === name ||
      (r.targetAliases?.includes(name) ?? false) ||
      (singleExportHit && (r.fnModule !== undefined || r.targetModule !== undefined));
    const matchingExternal = (r: CallRecord): boolean => {
      const attributed =
        (r.fnModule !== undefined && normalizeModulePath(r.fnModule) === currentModulePath) ||
        (r.targetModule !== undefined && normalizeModulePath(r.targetModule) === currentModulePath);
      if (!attributed) return false;
      return nameRoutes(r);
    };
    const injected = externalCallRecords.filter(matchingExternal);
    if (injected.length === 0) return;
    const nameLoc = fnNameLoc(node, fallbackLoc);
    const fnNode = resolveFunctionNode(node);
    // §2.2 kill-switch：与 CLI check / LSP validate 同口径，从项目配置解析
    // autoBind；漏接会让 analyze 旁路在 autoBind=false 时仍 ambient 执行侧车
    const autoBind = interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind;
    const domainIssues = checkInjectedDomainEvidence(name, source, injected, {
      paramNames: extractParamNames(fnNode),
      loadModule: loadModule ?? defaultLoadModule,
      fromFile: filePath,
      loc: { line: nameLoc.start.line, column: nameLoc.start.column },
      ...(autoBind === false ? { autoBind: false } : {}),
    });
    for (const issue of domainIssues) {
      const line = issue.line ?? nameLoc.start.line;
      const column = issue.column ?? nameLoc.start.column;
      diagnostics.push({
        range: { start: { line, column }, end: { line, column: column + name.length } },
        severity: issue.severity,
        message: issue.message,
        code: issue.code,
        suggestions: issue.suggestion ? [issue.suggestion] : undefined,
        data: { actual: issue.actual, expected: issue.expected },
      });
    }
  };

  // 带 @nudo:case 的指令函数：同样走跨文件注入证据执法（盲区补齐）
  for (const fn of functions) {
    if (fn.directives.some((d) => d.kind === "case")) {
      reportInjectedDomainExceeds(fn.name, fn.node, locFromNode(fn.node));
    }
  }

  for (const candidate of synthCandidates) {
    // 调用点来源有两路：本文件求值中观察到的调用，以及外部注入的
    // （使用现场文件——如测试——对本文导出函数的真实调用，CLI 经
    // --from 收集后传入）。带 targetModule 的记录先判归属：只有
    // 指向本文件的记录才允许参与匹配——导出名/别名离开模块单独无意义
    // （单导出文件的 targetExport 全是 "default"，不判模块会跨文件误染，
    // 如 clone.js 的记录命中 applyToDefaults.js 的 "default" candidate）。
    // 归属本文件（或无模块信息的本地记录）后再走三路：
    //  1. 名字路：fnName（调用处可见名）或 targetExport（定义处导出名）
    //  2. 别名路：re-export 链上后来出现的导出名（evaluator 的
    //     targetAliases，如 barrel / CJS 转发 shim 下的属性名）
    //  3. 模块路：本文件以 `module.exports = function` 单导出时直接收
    //     ——使用方可能以任意转发名调用它；多导出文件不走模块路，
    //     避免同文件多函数误染。
    const singleExportHit = singleExportFn !== null && candidate.node === singleExportFn;
    const nameRoutes = (r: CallRecord): boolean =>
      r.fnName === candidate.name ||
      r.targetExport === candidate.name ||
      (r.targetAliases?.includes(candidate.name) ?? false) ||
      (singleExportHit && (r.fnModule !== undefined || r.targetModule !== undefined));
    // 本地记录：来自本文件求值。带 targetModule 的（本文件导出被调用）
    // 判归属；无 tag 的内部调用按名字匹配（一直以来的行为）。
    const matchingLocal = (r: CallRecord): boolean => {
      const targetsThisFile =
        r.targetModule === undefined || normalizeModulePath(r.targetModule) === currentModulePath;
      if (!targetsThisFile) return false;
      return nameRoutes(r);
    };
    // 外部记录（使用现场收集）必须可归因到本文件：fnModule（定义位点——
    // require 传递求值中库内部调用的记录）或 targetModule（导出 tag）。
    // 无归因的记录是测试本地函数或裸内置名，按名字撞库属跨文件污染
    // （实测：测试局部 compare() 撞 contain.js internals.compare）。
    const matchingExternal = (r: CallRecord): boolean => {
      const attributed =
        (r.fnModule !== undefined && normalizeModulePath(r.fnModule) === currentModulePath) ||
        (r.targetModule !== undefined && normalizeModulePath(r.targetModule) === currentModulePath);
      if (!attributed) return false;
      return nameRoutes(r);
    };
    // resultAbs=never 且 throwsAbs=never 是求值中断的信号泄漏（如
    // `new Promise(async …)` 高阶 async 中 await 切断求值），无信息量，
    // 注入会产出误导 case；本地与注入记录一致跳过，全部被跳过的
    // candidate 自然落入下方 entry@ 回退。resultAbs=never 但 throws≠never
    // 是真实的抛出调用（argAbs + throws 都有信息），保留。
    const records = dedupeCallRecords(
      [
        ...callRecords.filter(matchingLocal),
        ...(externalCallRecords ?? []).filter(matchingExternal),
      ].filter((r) => !isLeakedCallRecord(r)),
    );
    // T10b：跨文件注入的调用点域证据 ⊄ 手写契约 → nudo:interface-domain-exceeds
    reportInjectedDomainExceeds(candidate.name, candidate.node, candidate.analysis.loc);
    if (records.length > 0) {
      // 案例选择偏好：结果有信息量的记录优先（精确/字面量/结构化），
      // unknown 结果的排后——收集顺序里错误路径或 undefined 形态的测试
      // 常排在前面，slice 截断会把 concrete-precise 记录挤掉（hoek clone
      // 的 682 条记录曾由 3 条 undefined 形态占满前 3 席）。
      const informativeness = (r: CallRecord): number => {
        if (r.resultAbs.shape.k === "unknown") return 2;
        if (r.resultAbs.shape.k === "never") return 1;
        return 0;
      };
      const ordered = records
        .map((r, i) => ({ r, i }))
        .sort((a, b) => informativeness(a.r) - informativeness(b.r) || a.i - b.i)
        .map(({ r }) => r);
      const precise = ordered.slice(0, callSiteBudget);
      for (const rec of precise) {
        // Abs 重求值仅在更有信息量时覆盖（不破坏 mock/callsite 精确结构）
        let absRaw: Abs | undefined;
        let absResult: Abs | undefined;
        if (rec.resultAbs.shape.k !== "never" && rec.argAbs.length > 0) {
          absRaw = tryEvalAbsRaw(source, candidate.name, rec.argAbs, filePath, mockSeedsToAbsMocks(seeds));
          if (absRaw) {
            if (absIsBetter(absRaw, rec.resultAbs)) {
              absResult = absRaw;
            }
          }
        }
        // 记录自带的无损结果 Abs：重求值失败/跳过时作兜底（B-path 产物）
        if (!absRaw && rec.resultAbs.shape.k !== "never") {
          absRaw = rec.resultAbs;
        }
        const caseAbs = absResult ?? rec.resultAbs;
        const caseResult: CaseResult = {
          name: `call@L${rec.callLoc?.line ?? candidate.analysis.loc.start.line}`,
          argAbs: [...rec.argAbs],
          abs: caseAbs,
          throwsAbs: rec.throwsAbs,
          source: "callsite",
        };
        tryAttachIntension(caseResult, source, candidate.name);
        if (absRaw) attachAbsToIntension(caseResult, absRaw, candidate.name);
        candidate.analysis.cases.push(caseResult);
      }
      // symbolic 聚合只用全已知实参的记录：含 unknown 分量的记录不可重求值
      // （unknown 吸收整个 union，一条循环引用 fixture 的记录就能毒化全部
      // 剩余聚合——clone 704 条中的 53 条 unknown 实参曾拖垮其余 651 条）。
      // 排除不声明覆盖，sound；全部不可求值时不产 symbolic case（诚实）。
      const remaining = ordered
        .slice(callSiteBudget)
        .filter((rec) => !rec.argAbs.some((a) => a.shape.k === "unknown" && !a.term));
      if (remaining.length > 0) {
        const fnNode = resolveFunctionNode(candidate.node);
        const paramCount = extractParamNames(fnNode).length;
        const widenedArgsAbs = Array.from({ length: paramCount }, (_, i) =>
          // 缺参按真实 JS 语义 widen 成 undefined 而非 unknown——可选参守卫
          // （target || [] 等）对 unknown 全塌，对 undefined 正常走默认分支
          widenJoinAbs(remaining.map((rec) => rec.argAbs[i] ?? undefAbs)),
        );
        // B 路径优先（capable）；否则 Abs 优先
        let symAbs: Abs | undefined;
        if (isBPathCapable(source, envNames) && filePath) {
          const bSym = tryBPathCall(
            source,
            filePath,
            candidate.name,
            widenedArgsAbs,
            { envNames, mocks: mockSeedsToAbsMocks(seeds) },
          );
          if (bSym && (bHostedEval || !(bSym.shape.k === "unknown" && !bSym.term))) {
            symAbs = bSym;
          }
        }
        if (!symAbs && !bHostedEval) {
          const absTry = tryEvalAbsRaw(
            source,
            candidate.name,
            widenedArgsAbs,
            filePath,
            mockSeedsToAbsMocks(seeds),
          );
          const weak =
            !!absTry &&
            absTry.shape.k === "unknown" &&
            (!absTry.term || (absTry.term.op === "lit" && absTry.term.value === undefined));
          if (absTry && !weak && absTry.shape.k !== "never" && absTry.conf !== "opaque") {
            symAbs = absTry;
          }
        }
        const symCase: CaseResult = {
          name: "call@symbolic",
          argAbs: widenedArgsAbs,
          // B4：超预算聚合必须 #widened（可解释降级）
          abs: symAbs
            ? { ...symAbs, conf: symAbs.conf === "exact" ? "widened" : symAbs.conf }
            : absUnknown,
          throwsAbs: neverAbs,
          source: "callsite",
          aggregatedFrom: remaining.length,
        };
        tryAttachIntension(symCase, source, candidate.name);
        if (symAbs) attachAbsToIntension(symCase, symAbs, candidate.name);
        candidate.analysis.cases.push(symCase);
      }
      // Combined covers every observed call site (not just the retained
      // cases), so a large set of same-base literal results collapses to
      // the widened base type instead of a 20-literal union.
      candidate.analysis.combinedAbs = collapseAbsLits(
        records.map((r) => r.resultAbs),
        COLLAPSE_LITERAL_THRESHOLD,
      );
      continue;
    }

    const fnNode = resolveFunctionNode(candidate.node);
    // 入口无约束参数 = any（design-cli-semantics §2）；不是 unknown（推导失败）
    const argAbsEntry = extractParamNames(fnNode).map(() => anyAbs);
    // B-path 唯一求值；失败 fail-closed（entryAbs 保持 undefined）
    let entryAbs: Abs | undefined;
    let entryThrowsAbs: Abs = makeAbsVal({ k: "never" }, undefined, undefined, "exact");
    const entryEffects: MayThrowEffect[] = [];
    setMayThrowCollector((e) => entryEffects.push(e));
    try {
      if (isBPathCapable(source, envNames) && filePath) {
        const bEntryFull =
          tryBPathCallFull(
            source,
            filePath,
            candidate.analysis.name,
            argAbsEntry,
            { envNames, mocks: mockSeedsToAbsMocks(seeds), collectMemberDiags: true },
          ) ??
          (candidate.assignedName
            ? tryBPathCallFull(source, filePath, candidate.assignedName, argAbsEntry, {
                envNames,
                mocks: mockSeedsToAbsMocks(seeds),
              })
            : undefined);
        if (bEntryFull?.memberDiags?.length) {
          for (const d of bEntryFull.memberDiags) {
            pushBMemberDiag(d, candidate.analysis.loc.start.line);
          }
        }
        const bEntry = bEntryFull?.result;
        if (bEntry && (bHostedEval || !(bEntry.shape.k === "unknown" && !bEntry.term))) {
          entryAbs = bEntry;
          if (bEntryFull?.throws) entryThrowsAbs = bEntryFull.throws;
        }
      }
      if (!entryAbs) {
        if (bHostedEval) {
          entryAbs = absUnknown;
          entryThrowsAbs = makeAbsVal({ k: "never" }, undefined, undefined, "exact");
        } else {
          const absEntry = tryEvalEntryAbs(source, candidate.analysis.name, argAbsEntry, filePath, seeds.seedVars, candidate.assignedName);
          if (absEntry) {
            // 任何成功求值（含 any 入参透传）都不回落 unknown（design §2）
            entryAbs = absEntry;
            entryThrowsAbs = makeAbsVal({ k: "never" }, undefined, undefined, "exact");
          } else {
            // 求值失败才是真 unknown（推导失败），不是入口无约束 any
            entryAbs = absUnknown;
            entryThrowsAbs = makeAbsVal({ k: "never" }, undefined, undefined, "exact");
          }
        }
      }
    } finally {
      setMayThrowCollector(null);
    }
    // throws 域 = hard throw ∪ soft may-throw（any/nullish 成员访问等）
    const softThrows = mayThrowEffectsToAbs(entryEffects);
    if (entryThrowsAbs.shape.k === "never" && softThrows.shape.k !== "never") {
      entryThrowsAbs = softThrows;
    } else if (entryThrowsAbs.shape.k !== "never" && softThrows.shape.k !== "never") {
      // 已有 hard throws 时并入 soft（展示层取并集名）
      const hard = formatThrowsAbs(entryThrowsAbs);
      const soft = formatThrowsAbs(softThrows);
      if (hard && soft && hard !== soft) {
        entryThrowsAbs = makeAbsVal(
          { k: "sum", members: [entryThrowsAbs, softThrows] },
          undefined,
          undefined,
          "exact",
        );
      }
    }
    const caseResult: CaseResult = {
      name: `entry@L${candidate.analysis.loc.start.line}`,
      argAbs: argAbsEntry,
      abs: entryAbs,
      throwsAbs: entryThrowsAbs,
    };
    // display 来自 generalize；attachAbs 补无损 abs 字段（后写覆盖 abs/conf）
    tryAttachIntension(caseResult, source, candidate.analysis.name);
    attachAbsToIntension(caseResult, entryAbs, candidate.analysis.name);
    candidate.analysis.cases.push(caseResult);
    candidate.analysis.entryOnly = true;
    candidate.analysis.combinedAbs = entryAbs;
    attachHofSnapshot(candidate.analysis, source);
    // nudo:interface-entry-only：导出无根且无域（无手写/生成契约 + 无调用点证据）
    try {
      const exportNames = localNamedExports(source);
      const isEntry =
        exportNames.has(candidate.analysis.name) ||
        (candidate.assignedName !== undefined && exportNames.has(candidate.assignedName));
      if (isEntry) {
        const autoBind = interfaceConfig(
          findProjectConfig(dirname(filePath))?.config,
        ).autoBind;
        const eff = effectiveInterface(source, candidate.analysis.name, {
          loadModule: loadModule ?? defaultLoadModule,
          fromFile: filePath,
          ...(autoBind === false ? { autoBind: false } : {}),
        });
        if (!eff) {
          diagnostics.push({
            range: {
              start: candidate.analysis.loc.start,
              end: candidate.analysis.loc.start,
            },
            severity: "info",
            message: `export '${candidate.analysis.name}' has no contract root and no call-site domain (entry-only)`,
            code: "nudo:interface-entry-only",
          });
        }
      }
    } catch {
      /* 诊断不得打断分析 */
    }
  }

  if (!bHostedEval) {
    buildNodeTypeMap(ast, globalEnv, nodeAbsMap);
  }

  const externalFunctions = synthesizeExternalFunctions(
    callRecords,
    filePath,
    analysisConfig(projectConfig?.config).callSiteBudget,
  );

  setEnvHarvestConflictCollector(prevHarvestConflictCollector);
  for (const c of envHarvestConflicts) {
    const parts: string[] = [];
    if (c.exports.length > 0) parts.push(`export(s) ${c.exports.join(", ")}`);
    if (c.defaultOverwritten) parts.push("default");
    const detail = parts.length > 0 ? ` — ${parts.join("; ")}` : "";
    const loc = findModuleImportLoc(source, c.module);
    const range = loc
      ? {
          start: { line: loc.line, column: loc.column },
          end: { line: loc.line, column: loc.column + loc.length },
        }
      : { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } };
    diagnostics.push({
      range,
      severity: "warning",
      message:
        `handwritten @nudo:env wins over harvest on module "${c.module}"${detail}; ` +
        `harvest only fills missing slots (B8). code=nudo:env-harvest-conflict`,
      code: "nudo:env-harvest-conflict",
    });
  }

  // nudo:dual-entry：browser/node 双入口变体之一被分析 → 记录不跨文件注入，
  // 观察面只覆盖本入口（info，不是门禁；单入口包零误报）。
  try {
    const dual = dualEntryForFile(filePath);
    if (dual) {
      diagnostics.push({
        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
        severity: "info",
        message: dualEntryMessage(dual),
        code: "nudo:dual-entry",
        suggestions: [dualEntrySuggestion()],
      });
    }
  } catch {
    /* 诊断不得打断分析 */
  }

  return {
    functions: functionResults,
    diagnostics,
    bindings,
    nodeAbsMap,
    caseHints,
    ...(externalFunctions.length > 0 ? { externalFunctions } : {}),
  };
}
