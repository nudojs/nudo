/**
 * 整文件分析（uncached 路径）：analyzeFileUncached / analyzeFileUncachedInner。
 * 自 analyzer-orchestrate.ts 机械拆出；语义未改。
 *
 * 职责已按缝拆出（机械搬移，语义未改）：
 *   - analyzer-orchestrate-uncached-modules.ts  模块图组装（dep 指纹 / 整文件求值 / eval 静态诊断）
 *   - analyzer-orchestrate-uncached-cases.ts    case 合成 + entry 分析（@nudo:case / call@ / entry@）
 */
import { realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Node } from "@babel/types";
import {
  createEnvironment,
  type Environment,
  markPureFn,
  formatAbs,
  formalParamsFromNodes,
  type Abs,
} from "@nudojs/core";
import {
  checkInjectedDomainEvidence,
  runWithEvalMissingSlot,
  fnFingerprints,
} from "@nudojs/core/internal";
import { parse, extractDirectives, extractFileDirectives, type DirectiveDiag } from "@nudojs/parser";
import {
  collapseAbsLits,
  isLeakedCallRecord,
  type CallRecord,
} from "./evaluator/call-record.ts";
import { findProjectConfig, interfaceConfig, analysisConfig } from "./evaluator/config.ts";
import {
  mockDirectivesToAbsSeeds,
} from "./mock-abs.ts";
import { defaultLoadModule } from "./load-module.ts";
import { collectAbsBindingsFromGraph } from "./abs-modules-graph.ts";
import {
  tryRunEval,
  composeEvalModules,
  mockSeedFingerprint,
  setEnvHarvestConflictCollector,
  type EnvHarvestConflict,
} from "./eval-run.ts";
import { entryVariantForFile, entryVariantMessage, entryVariantSuggestion } from "./entry-variants.ts";
import {
  fnAnalysisCacheGet,
  fnAnalysisCacheSet,
  caseDirectiveKey,
} from "./fn-analysis-cache.ts";
import type {
  AnalysisResult,
  AnalyzeLoadModule,
  BindingInfo,
  CaseHint,
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
  COLLAPSE_LITERAL_THRESHOLD,
} from "./analyzer-diagnose.ts";
import {
  cloneFunctionAnalysis,
  shiftSourceLoc,
  shiftDiagnosticLines,
  shiftCallRecordLines,
} from "./analyzer-cache.ts";
import {
  attachHofSnapshot,
  isSelfContainedSource,
  absModulesOk,
} from "./analyzer-abs-eval.ts";
import {
  computeFnDepSegment,
  assembleModuleGraph,
  pushEvalStaticDiagnostics,
} from "./analyzer-orchestrate-uncached-modules.ts";
import {
  evaluateCaseDirectives,
  synthesizeCallSiteCases,
  evaluateEntryCase,
  type UncachedCaseEnv,
} from "./analyzer-orchestrate-uncached-cases.ts";

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
  // F-3 / D1: 指令文法诊断（nudo:directive-syntax）不再静默——并入 analysis diagnostics。
  // 显式通道：诊断直接落局部数组，不碰模块级 buffer（无 seq 锚 / 在途窃取窗口）
  const dirDiags: DirectiveDiag[] = [];
  const functions = extractDirectives(ast, { diags: dirDiags });
  const diagnostics: Diagnostic[] = [];
  for (const d of dirDiags) {
    diagnostics.push({
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
      severity: "warning",
      message: d.message,
      code: d.code,
    });
  }
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

  /** 求值引擎已报告的 method/property 名（避免双报） */
  const evalMemberDiagNames = new Set<string>();
  const evalMemberDiagSeen = new Set<string>();
  const pushBMemberDiag = (d: { kind: string; name: string; receiver: string; line?: number; column?: number; origin?: { line: number; column: number }; code?: string }, fallbackLine: number) => {
    evalMemberDiagNames.add(d.name);
    const key = `${d.kind}:${d.name}:${d.receiver}:${d.line ?? fallbackLine}:${d.column ?? 0}:${d.code ?? ""}`;
    if (evalMemberDiagSeen.has(key)) return;
    evalMemberDiagSeen.add(key);
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

  /** B 已上报的模块加载问题种类（压 TypeValue 叠报） */
  const evalModuleIssueKinds = new Set<"cycle" | "depth" | "missing" | "missing-export" | "exports-unresolved">();

  const pushBModuleIssues = (
    issues:
      | Array<{ kind: "cycle" | "depth" | "missing" | "missing-export" | "exports-unresolved"; label: string; reason: string }>
      | undefined,
  ) => {
    if (!issues) return;
    for (const iss of issues) {
      evalModuleIssueKinds.add(iss.kind);
      const code =
        iss.kind === "cycle"
          ? "nudo:module-cycle"
          : iss.kind === "depth"
            ? "nudo:module-depth"
            : iss.kind === "missing-export"
              ? "nudo:missing-export"
              : iss.kind === "exports-unresolved"
                ? "nudo:exports-unresolved"
                : "nudo:module-missing";
      diagnostics.push({
        range: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
        severity: iss.kind === "missing" || iss.kind === "missing-export" ? "error" : "warning",
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
  // 内联表达式解析失败 → nudo:mock-invalid
  for (const fe of seeds.fromErrors ?? []) {
    const isExpr = fe.code === "nudo:mock-invalid";
    diagnostics.push({
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
      severity: "error",
      message: fe.message,
      code: fe.code ?? "nudo:module-missing",
      suggestions: isExpr
        ? [
            "Supported formats: stub(), stub().returns(value), spy(), mock()",
            "Arrow functions: (args) => expression or (args) => { statements; return value; }",
            "Type expressions: number(), string(), shape({...}), union(...), or concrete literals",
          ]
        : [
            `Create the mock file or fix the path in @nudo:mock ${fe.name} from "${fe.fromPath}"`,
            "The mock module must define a binding with the same name as the mock",
          ],
    });
  }
  let absCallRecords: CallRecord[] = [];
  let absBindsShared: Map<string, Abs> | undefined;
  let absNodesShared: Map<Node, Abs> | undefined;

  // dep 内容指纹（整文件与逐函数缓存键共用；fail-closed 语义见 modules 文件）
  const { fnDepSeg, fnDepFailClosed } = computeFnDepSegment(source, loadModule, filePath);

  // B 模块图：cycle/depth/missing + 顶层 memberDiags（注入 @nudo:mock；
  // composeEvalModules 单一入口 + tryRunEval 复用）→ modules 文件
  const { evalHosted, evalTopCallRecords } = assembleModuleGraph({
    source,
    filePath,
    envNames,
    seeds,
    ...(loadModule ? { loadModule } : {}),
    fileDirectives,
    fnDepSeg,
    diagnostics,
    pushModuleIssues: pushBModuleIssues,
    pushMemberDiag: pushBMemberDiag,
  });
  // fail-closed：Abs 调用记录通道已删（collectAbsCallRecords）——非 eval-hosted
  // 源的调用点仅来自 eval 顶层记录（evalTopCallRecords）

  // fail-closed：evalHosted 的 Abs bindings/nodeTypes 补齐已删
  // （collectAbsBindsAndNodes）——eval 侧的 nodeTypeMap/binding 通道是唯一源

  // TypeValue evaluateProgram / applyMocks 已删除：非 eval-hosted 源不跑全程序求值；
  // 绑定/节点靠 Abs 宿主（collectAbsBindsAndNodes）。case 兜底 Abs-first。

  // Abs / eval 顶层调用记录：eval-hosted 时 求值引擎优先（调用点实参含宿主 JS 函数
  // 时 Abs 会把它们打成 unknown——C3.1）；否则 Abs 优先。
  if (evalHosted && evalTopCallRecords.length > 0) {
    callRecords.length = 0;
    callRecords.push(...evalTopCallRecords);
  } else if ((selfContained || canAbsModules) && absCallRecords.length > 0) {
    callRecords.length = 0;
    callRecords.push(...absCallRecords);
  } else if (evalTopCallRecords.length > 0) {
    callRecords.length = 0;
    callRecords.push(...evalTopCallRecords);
  }

  // 求值引擎静态诊断接管 unreachable + builtin-unknown（env/mock 已覆盖的
  // 全局不在 builtin-unknown 之列）→ modules 文件
  pushEvalStaticDiagnostics({ source, envNames, seeds, diagnostics });

  // case 合成 / entry 分析共享求值环境（模块图产物 + 诊断通道按引用共享）
  const caseEnv: UncachedCaseEnv = {
    source,
    filePath,
    envNames,
    seeds,
    ...(loadModule ? { loadModule } : {}),
    fnDepSeg,
    evalHosted,
    selfContained,
    canAbsModules,
    pushMemberDiag: pushBMemberDiag,
    diagnostics,
    caseHints,
    callRecords,
  };

  // Abs 宿主补齐（T15）：B 未成功宿主时仍收集 Abs 绑定/节点表——
  // BindingInfo.abs / nodeAbsMap / hover / completions 不必等 B 成功。
  if (!absNodesShared && !evalHosted && (selfContained || canAbsModules)) {
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
  // fnDepSeg（dep 内容指纹）已在模块图前一次算好：此处直接复用

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
    // （整文件键已含，fn 键不加会陈旧命中 C0.5 诊断；maxForks 截断同理）
    const analysisFnKey = `m=${analysisCfg.mode}|e=${analysisCfg.evalMissingSlot}|b=${analysisCfg.callSiteBudget}|f=${analysisCfg.maxForks}`;
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

    // @nudo:case 指令求值（case 落 analysis.cases / caseHints / 诊断）→ cases 文件
    evaluateCaseDirectives(caseEnv, {
      name: fn.name,
      fnLoc,
      analysis,
      caseDirectives,
      caseIdxsToRun,
      activeCaseIdx,
    });

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
      // 调用点 case 合成（call@ / call@symbolic + combinedAbs）→ cases 文件
      synthesizeCallSiteCases(caseEnv, candidate, records, callSiteBudget);
      continue;
    }

    // entry@ 兜底评估（含 may-throw 聚合与 entry-only 诊断）→ cases 文件
    evaluateEntryCase(caseEnv, candidate);
  }

  if (!evalHosted) {
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
    const dual = entryVariantForFile(filePath);
    if (dual) {
      diagnostics.push({
        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
        severity: "info",
        message: entryVariantMessage(dual),
        code: "nudo:dual-entry",
        suggestions: [entryVariantSuggestion()],
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
