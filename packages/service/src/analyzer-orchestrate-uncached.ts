/**
 * 整文件分析（uncached 路径）：analyzeFileUncached / analyzeFileUncachedInner。
 * 自 analyzer-orchestrate.ts 机械拆出；语义未改。
 *
 * 职责已按缝拆出（机械搬移，语义未改）：
 *   - analyzer-orchestrate-uncached-modules.ts  模块图组装（dep 指纹 / 整文件求值 / eval 静态诊断）
 *   - analyzer-orchestrate-uncached-cases.ts    case 合成 + entry 分析（@nudo:case / call@ / entry@）
 */
import { entryThisReceiverTypeTextOf } from "@nudojs/core/internal";
import { realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Node } from "@babel/types";
import {
  createEnvironment,
  type Environment,
  formatAbs,
  bindingsOf,
  type Abs,
  extractDeclaredThrows,
  localNamedExports,
} from "@nudojs/core";
import {
  DIAG,
  FORK_TRUNCATION_LABEL,
  LOOP_TRUNCATION_LABEL,
  checkInjectedDomainEvidence,
  getAbsCallBudgetStats,
  runWithEvalMissingSlot,
  fnFingerprints,
  setAbsTruncationCollector,
  defaultExportLocalName,
  suggestedCallsCeiling,
  suggestedDepthCeiling,
  suggestedForkCeiling,
  semanticIndexEntryFaceSegment,
  hashSource,
  stableAnalyzeKeySource,
} from "@nudojs/core/internal";
import {
  parse,
  extractDirectives,
  extractFileDirectives,
  runWithDirectiveDiags,
  type DirectiveDiag,
} from "@nudojs/parser";
import {
  collapseAbsLits,
  isLeakedCallRecord,
  type CallRecord,
} from "./evaluator/call-record.ts";
import { findProjectConfig, contractConfig, analysisConfig } from "./evaluator/config.ts";
import { pathEnvPreloadFingerprint, absolutizeEnvSpec } from "./evaluator/env-loader.ts";
import {
  mockDirectivesToAbsSeeds,
  mockSeedsToAbsMocks,
} from "./mock-abs.ts";
import { defaultLoadModule } from "./load-module.ts";
import { collectAbsBindingsFromGraph } from "./abs-modules-graph.ts";
import {
  tryRunEval,
  composeEvalModules,
  collectEnvGlobals,
  pathEnvContentFingerprint,
  mockSeedFingerprint,
  setEnvHarvestConflictCollector,
  type EnvHarvestConflict,
} from "./eval-run.ts";
import { entryVariantIssueForFile } from "./entry-variants.ts";
import {
  fnAnalysisCacheGet,
  fnAnalysisCacheSet,
  caseDirectiveKey,
} from "./fn-analysis-cache.ts";
import type {
  AlsoSynthesizeCases,
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
  extractFormals,
  extractParamNames,
  extractReturnAnnotation,
  resolveFunctionNode,
  fnNameLoc,
  collectTopLevelFunctions,
  recordServiceEntryFace,
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
  externalRecordsFingerprint,
} from "./analyzer-cache.ts";
import {
  attachHofSnapshot,
  isSelfContainedSource,
} from "./analyzer-abs-eval.ts";
import {
  computeFnDepSegment,
  assembleModuleGraph,
  pushEvalStaticDiagnostics,
  type ModuleGraphIssues,
} from "./analyzer-orchestrate-uncached-modules.ts";
import {
  evaluateCaseDirectives,
  synthesizeCallSiteCases,
  evaluateEntryCase,
  evaluateThrowsOnly,
  type UncachedCaseEnv,
} from "./analyzer-orchestrate-uncached-cases.ts";

/**
 * case 实参是否**全是字面量** ⇒ 该 case 是**点观测**（返回值也只是那个点，
 * 不是调用域）。
 *
 * Bug 511：约束构建器实参（`number()` 等）⇒ 求值在**域**上进行，返回值本身
 * 就是域（`number`）⇒ 域形状的观测可以给出返回面；字面量实参 ⇒ 只观测到
 * 一个点，点不能独占返回面。
 */
function isPointObservationArgs(args: Abs[]): boolean {
  return args.length > 0 && args.every((a) => a.term?.op === "lit");
}

/**
 * 逐函数缓存快照的待写项。
 *
 * 快照点必须在 entry@/call@ 合成**之后**（BUG-184）：合成会就地往
 * `analysis.cases` / `combinedAbs` 里写见证，合成前落盘的快照一旦命中就会让
 * 该函数本轮不参与合成 ⇒ 见证整段消失，且同一进程内同一调用结果取决于此前
 * 跑过什么（LSP 长驻进程必然踩到）。
 */
type PendingFnCacheWrite = {
  key: string;
  analysis: FunctionAnalysis;
  diagnostics: Diagnostic[];
  caseHints: CaseHint[];
  callRecords: CallRecord[];
};

/**
 * B 模块加载问题 kind → 诊断码/定档（单一查表；原为 kind→code 与
 * kind→severity 两条嵌套三元链）。语义零变化：
 * error = missing / missing-export / unreadable / json-invalid，
 * warning = cycle / depth / exports-unresolved。
 */
const B_MODULE_ISSUE_META: Record<
  ModuleGraphIssues[number]["kind"],
  { code: string; severity: "error" | "warning" }
> = {
  cycle: { code: DIAG.moduleCycle, severity: "warning" },
  depth: { code: DIAG.moduleDepth, severity: "warning" },
  missing: { code: DIAG.moduleMissing, severity: "error" },
  "missing-export": { code: DIAG.missingExport, severity: "error" },
  "exports-unresolved": { code: DIAG.exportsUnresolved, severity: "warning" },
  unreadable: {
    // 「文件在但读不了」不得复用 module-missing（那是「不存在」）
    // ——事实相反的诊断码会让门禁判错（Bug 499）。
    code: DIAG.moduleUnreadable,
    severity: "error",
  },
  "json-invalid": {
    // 「JSON 语法错」专用码（不是 module-missing——文件在、语法坏了；
    // 两种形态的处置不同）（Bug 457）。
    code: DIAG.jsonInvalid,
    severity: "error",
  },
};

export function analyzeFileUncached(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: AnalyzeLoadModule,
  caseMode: DirectiveCaseMode = "all",
  alsoSynthesizeCases?: AlsoSynthesizeCases,
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
      alsoSynthesizeCases,
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
  alsoSynthesizeCases?: AlsoSynthesizeCases,
): AnalysisResult {
  const ast = parse(source, { filename: filePath });
  // BUG-133：`this: T` 接收者注解（strip 后 AST 不可见，helper 自己 keepTs）。
  // keepTs 整源解析昂贵 ⇒ 每文件只测**一次**正则（`\bthis\s*:`：漏掉
  // `this : T` 会让带空格注解的函数静默丢 dts 接收者子句），命中后按函数名
  // 缓存结果；指令路径与合成路径共用同一份查询。
  const hasThisReceiverAnnotation = /\bthis\s*:/.test(source);
  const thisReceiverTypeCache = new Map<string, string | undefined>();
  const thisReceiverTypeOf = (fnName: string): string | undefined => {
    if (!hasThisReceiverAnnotation) return undefined;
    if (thisReceiverTypeCache.has(fnName)) return thisReceiverTypeCache.get(fnName);
    const text = entryThisReceiverTypeTextOf(source, fnName);
    thisReceiverTypeCache.set(fnName, text);
    return text;
  };
  // F-3 / D1: 指令文法诊断（nudo:directive-syntax）不再静默——并入 analysis diagnostics。
  // 显式通道：诊断直接落局部数组，不碰模块级 buffer（无 seq 锚 / 在途窃取窗口）
  const dirDiags: DirectiveDiag[] = [];
  const functions = extractDirectives(ast, { diags: dirDiags });
  // JSDoc 块内错位的文件级指令族标签（@nudo:env / @nudo:mock-module）同通道
  // 告警：块注释形态被抽取器忽略（只认行注释），不再静默（复用 nudo:directive-syntax）
  const fileDirectives = extractFileDirectives(ast, { diags: dirDiags });
  const diagnostics: Diagnostic[] = [];
  // ★ 族 28 接线：指令诊断**增量**转成 analysis diagnostics。
  // 为什么要增量：mock 载荷的解析（`mockDirectivesToAbsSeeds`）在**后面**才跑，
  // 且它会往同一条 `dirDiags` 通道里加诊断（此前 `nudo test` 面**不挂 sink**
  // ⇒ parser 侧的点名诊断只出现在 `nudo check` 面）。
  let dirDiagCursor = 0;
  const flushDirDiags = (): void => {
    for (; dirDiagCursor < dirDiags.length; dirDiagCursor++) {
      const d = dirDiags[dirDiagCursor]!;
      diagnostics.push({
        // ★ 族 28 接线（Bug 848）：parser 侧诊断现在带**位置**
        // （`DirectiveDiag.at`）⇒ 不再一律落到 `0:0`
        // （此前同文案的诊断在不同位置**塌缩成一条**且位置全丢）。
        range: {
          start: { line: d.at?.line ?? 0, column: d.at?.column ?? 0 },
          end: { line: d.at?.line ?? 0, column: d.at?.column ?? 0 },
        },
        severity: "warning",
        message: d.message,
        code: d.code,
      });
    }
  };
  flushDirDiags();
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

  // BUG-099：截断观测 → 诊断。引擎在预算/环上放弃求值时的可观测性是硬约束
  // （check 面由 core 的 checkSource 报告），但分析器这一侧原来只把 label 收进
  // `evalTruncatedFns` 就丢掉 ⇒ `nudo test` / `--json` 面零诊断，把放宽后的类型
  // 当正常观测打印（`bump() => 2` 式静默失真）。
  // 单槽 collector：`eval-run` 的嵌套 collector 已改为**链式转发**上一只手，
  // 故这里能覆盖整轮（含嵌套的函数体求值）。reasons 用于区分 cycle / 预算。
  const truncations = new Map<string, Set<string>>();
  const prevTruncationCollector = setAbsTruncationCollector((label, reason) => {
    const reasons = truncations.get(label) ?? new Set<string>();
    if (reason) reasons.add(reason);
    truncations.set(label, reasons);
  });

  // fileDirectives 已在 dirDiags 通道一并抽取（错位标签告警同域去重）
  const fileEnvNames = fileDirectives
    .filter((d) => d.kind === "env")
    .flatMap((d) => d.envs);

  const projectConfig = findProjectConfig(dirname(filePath));
  // Bug 1098：项目级 env 的相对说明符必须**绝对化**（按**项目根**）——收集期的
  // 查表基准 = 「最后一次 preload 的目录」= **文件目录**（文件级 env 预载在后），
  // 而相对说明符只有**唯一候选** ⇒ 不绝对化则项目级 env 必然查表落空
  // （env 全局丢失 ⇒ 返回面 never + `nudo:builtin-unknown` 假阳 + 类型面退化）。
  // 与 `analyzeFileAsync` 的预载侧、CLI 的 `assembleEnvs` 同一套规则。
  const projectEnvBaseDir = projectConfig?.projectDir ?? dirname(filePath);
  const rawProjectEnv = projectConfig?.config.env;
  const projectEnvSpec = absolutizeEnvSpec(
    Array.isArray(rawProjectEnv) ? rawProjectEnv : [],
    projectEnvBaseDir,
  );
  // 顺序：项目级先、文件级后（文件级相对名仍按**文件目录**解析）。
  const envNames = [...new Set([...projectEnvSpec, ...fileEnvNames])];
  const analysisCfg = analysisConfig(projectConfig?.config);
  const callSiteBudget = analysisCfg.callSiteBudget;

  const callRecords: CallRecord[] = [];
  // Environment 绑定 Abs（BindingInfo.abs）；nodeAbsMap 另走 absBinds
  const globalEnv = createEnvironment();

  // @nudo:env 的 globals 进入分析环境：buildNodeTypeMap 按 env.lookup 给
  // 标识符节点定类型——globalEnv 恒空 ⇒ env 全局在 IDE 面（hover /
  // completion）无类型（#502）。口径与求值面一致：命名 env 同步可见；
  // path 型 env 需先 preload（analyzeFileAsync 预载后同步面才可见），
  // 看不到时保持"无信息"（fail-closed），不假装有类型。
  const envGlobals = collectEnvGlobals(envNames);
  for (const [envName, envValue] of Object.entries(envGlobals)) {
    globalEnv.bind(envName, envValue);
  }

  /** 求值引擎已报告的 method/property 名（避免双报） */
  const evalMemberDiagNames = new Set<string>();
  const evalMemberDiagSeen = new Set<string>();
  /** 三处 member 诊断 range 字面量的单一实现（member 名长度为端） */
  const rangeOf = (
    d: { line?: number; column?: number; name: string },
    fallbackLine: number,
  ): SourceLocation => ({
    start: { line: d.line ?? fallbackLine, column: d.column ?? 0 },
    end: { line: d.line ?? fallbackLine, column: (d.column ?? 0) + d.name.length },
  });
  const pushBMemberDiag = (d: { kind: string; name: string; receiver: string; line?: number; column?: number; origin?: { line: number; column: number }; code?: string }, fallbackLine: number) => {
    evalMemberDiagNames.add(d.name);
    const key = `${d.kind}:${d.name}:${d.receiver}:${d.line ?? fallbackLine}:${d.column ?? 0}:${d.code ?? ""}`;
    if (evalMemberDiagSeen.has(key)) return;
    evalMemberDiagSeen.add(key);
    // C0.5：求值命中闭 shape 缺槽（默认 off；per-analysis ALS 已就绪）
    if (d.code === DIAG.missingSlot) {
      diagnostics.push({
        range: rangeOf(d, fallbackLine),
        severity: "warning",
        message: `Field '${d.name}' is missing on the evaluated object shape`,
        code: DIAG.missingSlot,
        ...(d.origin ? { origin: d.origin } : {}),
      });
      return;
    }
    // unknown 接收者 → unknown-recv（warning：接收者类型未知，非缺方法）
    if (d.receiver === "unknown") {
      diagnostics.push({
        range: rangeOf(d, fallbackLine),
        severity: "warning",
        message: `Cannot resolve '${d.name}' on unknown value`,
        code: DIAG.unknownRecv,
        ...(d.origin ? { origin: d.origin } : {}),
      });
      return;
    }
    diagnostics.push({
      range: rangeOf(d, fallbackLine),
      severity:
        d.receiver === "number" || d.receiver === "boolean" || d.receiver === "bigint" || d.receiver === "symbol"
          ? "error"
          : "warning",
      message:
        d.kind === "method"
          ? `Method '${d.name}' does not exist on type '${d.receiver}'`
          : `Property '${d.name}' does not exist on type '${d.receiver}'`,
      code: DIAG.noMethod,
      ...(d.origin ? { origin: d.origin } : {}),
    });
  };

  // @nudo:mock 静态校验始终执行（B hosted 也要报 mock-invalid）
  for (const fn of functions) {
    validateMockDirectives(fn.directives, diagnostics);
  }

  // @nudo:mock 已编译为 Abs seed 注入（mockDirectivesToAbsSeeds）；无 TypeValue applyMocks。
  const selfContained = isSelfContainedSource(source, envNames);

  const pushBModuleIssues = (issues: ModuleGraphIssues | undefined) => {
    if (!issues) return;
    for (const iss of issues) {
      diagnostics.push({
        range: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
        severity: B_MODULE_ISSUE_META[iss.kind].severity,
        message: iss.reason,
        code: B_MODULE_ISSUE_META[iss.kind].code,
      });
    }
  };

  // ★ 族 28 接线：mock 载荷的解析挂**指令诊断 sink**
  // ⇒ parser 侧的点名诊断（如「Unrecognized property in object literal: ok」）
  // 在 `nudo test` 面也上屏（此前只有 `nudo check` 的 D1 段挂了 sink）。
  const seeds = runWithDirectiveDiags(dirDiags, () =>
    mockDirectivesToAbsSeeds(functions, {
      fromFile: filePath || undefined,
      ...(loadModule ? { loadModule } : {}),
    }),
  );
  flushDirDiags();
  // @nudo:mock name from "path" 解析失败 → 明确诊断（缺文件/缺绑定/求值失败），不静默丢弃
  // 内联表达式解析失败 → nudo:mock-invalid
  for (const fe of seeds.fromErrors ?? []) {
    const isExpr = fe.code === DIAG.mockInvalid;
    diagnostics.push({
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
      // 表达式解析失败 = 指令被忽略（mock 不生效），按文档是 warning
      // （docs/reference/diagnostics.md#nudo-mock-invalid、docs/guides/check.md
      // 「nudo:mock-invalid | engine | warning」）；mock 文件缺失/加载失败
      // （moduleMissing）才是 error。旧实现两条都报 error，与同一文件里
      // validateMockDirectives 通道的 warning 自相矛盾（#460）。
      severity: isExpr ? "warning" : "error",
      message: fe.message,
      code: fe.code ?? DIAG.moduleMissing,
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

  // @nudo:pure 纯度标记：**在实例诞生地落**（eval-run 的 tryRunEval——
  // 每次 runTranspiled 之后），不在这里补落。理由（Bug 462 + 分片 J 的
  // fresh 语义）：memo 以**对象身份**为键（pureCallMemo / pureMemo：
  // WeakMap<fnObj, argsKey, …>），标记必须与调用点解析到的函数值是**同一个
  // 对象**。调用面（case / entry 求值）按用例新建**独立模块实例**
  // （fresh 开关），这里取的 run 是 memo 里那份旧实例 ⇒ 标记落在被复用的
  // 旧实例上，调用面永远命中不了。
  //   - 顶层函数声明：转译面把顶层函数声明提升为 export（宿主 JS 函数对象）
  //   - 函数表达式（const/let 绑定）：Abs fn 值（recordBinding 记录）

  // TypeValue evaluateProgram / applyMocks 已删除：非 eval-hosted 源不跑全程序求值；
  // 绑定/节点靠 Abs 宿主（collectAbsBindsAndNodes）。case 兜底 Abs-first。

  // Abs / eval 顶层调用记录：eval-hosted 时 求值引擎优先（调用点实参含宿主 JS 函数
  // 时 Abs 会把它们打成 unknown——C3.1）；否则 Abs 优先。
  if (evalHosted && evalTopCallRecords.length > 0) {
    callRecords.length = 0;
    callRecords.push(...evalTopCallRecords);
  } else if (absCallRecords.length > 0) {
    // 评审发现 8：absModulesOk 恒真（历史 gate 已死）——此分支不再被
    // selfContained 门控；B 模块图对所有源可用（env 由 loadEnvs 处理）。
    callRecords.length = 0;
    callRecords.push(...absCallRecords);
  } else if (evalTopCallRecords.length > 0) {
    callRecords.length = 0;
    callRecords.push(...evalTopCallRecords);
  }

  // 求值引擎静态诊断接管 unreachable + builtin-unknown（env/mock 已覆盖的
  // 全局不在 builtin-unknown 之列）→ modules 文件
  pushEvalStaticDiagnostics({ source, envNames, seeds, diagnostics, filePath });

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
    pushMemberDiag: pushBMemberDiag,
    diagnostics,
    caseHints,
    callRecords,
    // 外部调用点记录（--from 现场采集）：已固化函数的「二次 freeze」要靠它
    // 看到新增的外部调用点（分片 H 的 synthesizeFrozenCallSiteCases 只认
    // 外部记录——本地调用点行号会因插入 JSDoc 块漂移，纳入会产生重复见证）。
    externalCallRecords,
  };

  // Abs 宿主补齐（T15）：B 未成功宿主时仍收集 Abs 绑定/节点表——
  // BindingInfo.abs / nodeAbsMap / hover / completions 不必等 B 成功。
  if (!absNodesShared && !evalHosted) {
    try {
      const collected = { binds: new Map<string, Abs>(), nodes: new Map<Node, Abs>() }; // fail-closed
      if (!absBindsShared) absBindsShared = collected.binds;
      absNodesShared = collected.nodes;
    } catch {
      /* fail-closed：补齐失败保持空表（显式无信息，单引擎无第二来源） */
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
    /* fail-closed：补全失败保留 bindings 原样（不覆盖既有条目） */
  }

  const synthCandidates: { name: string; node: Node; analysis: FunctionAnalysis; assignedName?: string }[] = [];

  // 顶层函数普查（noDeclaration 分类的唯一事实源）——指令路径与非指令路径
  // 共用同一份结果：带 @nudo: 指令的函数此前走指令路径时**丢掉了**
  // noDeclaration 分类（类方法作用域名 "C.m" 落到 dts 投影上 → 产出
  // `export declare function C.m(...)` 这种非法 TS，#494）。
  const topLevelFns = collectTopLevelFunctions(ast);
  // ADR 0001 阶段 1 · 切片 2：与 core 绑定索引做只读对照（默认关闭、零开销）。
  // 普查结果本身不改写 ⇒ 分析面门禁结论不变。
  recordServiceEntryFace(ast, topLevelFns);
  const noDeclByNode = new Map<Node, boolean>();
  const noDeclByName = new Map<string, boolean>();
  for (const t of topLevelFns) {
    noDeclByNode.set(t.node, t.noDeclaration);
    if (!noDeclByName.has(t.name)) noDeclByName.set(t.name, t.noDeclaration);
  }

  // 函数级指纹：body-edit 时未引用的兄弟函数可命中缓存
  let fnFpMap: Map<string, { own: string; deps: string }> | undefined;
  try {
    fnFpMap = fnFingerprints(source, ast as never);
  } catch {
    fnFpMap = undefined;
  }
  // env 维度进 fn 键：env 名 + **内容指纹** + **预载状态**（Bug 993 / Bug 012）。
  // - 内容指纹与另外两层缓存（文件级 `analysisFileCacheKey`、evaluator memo）
  //   同口径：path 型 env 的文件内容变了，函数级缓存必须 miss（只编码 mtime
  //   时 `cp -p` / `tar -x` / 同秒编辑会命中陈旧类型）。
  // - 预载状态：path 型 env 只能异步装载，同一份源码在「预载前 / 预载后」
  //   得到两份不同结果（env 全局可见性不同）。
  const envContentFn = pathEnvContentFingerprint(envNames, dirname(filePath));
  const envKeyFn = `${envNames.join(",")}#${envContentFn || "-"}#${pathEnvPreloadFingerprint() || "-"}`;
  const mockKeyFn = mockSeedFingerprint(seeds.seedVars, seeds.seedFns);
  // fnDepSeg（dep 内容指纹）已在模块图前一次算好：此处直接复用

  // 本地命名导出集合（**入口面口径** = 导出函数）：hover 的 throws 段与 check
  // 的 L2 throws 都只对导出函数生效（hover：tier ⇔ 本地 named export）⇒
  // 函数级 throws 证据只补给导出函数（非导出函数没有入口面）。
  const exportedFnNames = localNamedExports(source, filePath);

  // 合成阶段（entry@/call@）会就地改 analysis ⇒ 逐函数快照必须等它跑完再写，
  // 否则命中回放的是一份**没有合成见证**的半成品（BUG-184：LSP 里先跑一次
  // codeLens 就把后续 nudo/contract 的见证降级成 unknown）。
  const pendingFnWrites: PendingFnCacheWrite[] = [];
  const pendingFnWritesByAnalysis = new Map<FunctionAnalysis, PendingFnCacheWrite>();
  // 整份源码指纹（懒算：只有参与合成的函数才需要它进键）
  let synthScopeKeyMemo: string | undefined;
  const synthScopeKey = (): string => {
    if (synthScopeKeyMemo === undefined) synthScopeKeyMemo = hashSource(stableAnalyzeKeySource(source));
    return synthScopeKeyMemo;
  };
  // 「选中了哪条 case」也进合成类函数的键：被选中的 case 会执行该函数体，
  // 其内部调用点进共享记录表 ⇒ 影响**其它**函数的合成见证。
  const activeCasesSeg =
    activeCases && activeCases.size > 0
      ? `ac=${[...activeCases.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
          .map(([k, v]) => `${k}=${v}`)
          .join(",")}`
      : "";
  // 自定义 loadModule（LSP buffer-aware）≠ 默认磁盘加载器（与文件级键的 lm 段同口径）
  const lmSeg = loadModule !== undefined && loadModule !== defaultLoadModule ? "lm1" : "lm0";
  const extSeg =
    externalCallRecords && externalCallRecords.length > 0
      ? `x=${externalRecordsFingerprint(externalCallRecords)}`
      : "";

  for (const fn of functions) {
    const skipDirective = fn.directives.find((d) => d.kind === "skip");

    const fnLoc = locFromNode(fn.node);
    const paramNames = extractParamNames(fn.node);
    // Bug 479：形参表面（与 paramNames 同源 ⇒ 下标对齐）。`.ts` 源的形参
    // 带**声明类型文本**（`FormalParam.tsType`）⇒ 产物面（dts 参数位）
    // 据此保留源码里写下的类型。
    const formals = extractFormals(fn.node, source);
    const declaredReturnType = extractReturnAnnotation(fn.node);
    // BUG-133：`this: T` 接收者注解（strip 后 AST 不可见，helper 自己 keepTs；
    // 每文件的 keepTs 查询经 thisReceiverTypeOf 缓存 / 正则闸门）
    const thisReceiverType = thisReceiverTypeOf(fn.name);
    const analysis: FunctionAnalysis = {
      name: fn.name,
      loc: fnLoc,
      paramNames,
      ...(formals.length > 0 ? { formals } : {}),
      ...(declaredReturnType ? { declaredReturnType } : {}),
      ...(thisReceiverType ? { thisReceiverType } : {}),
      cases: [],
    };
    // noDeclaration 分类继承顶层函数普查（类方法 / CJS 绑定等无稳定导出名
    // 的条目）——指令路径此前漏标，dts 投影会把作用域名 "C.m" 直接当函数名
    // 产出非法 TS（#494）。节点身份优先，其次同名条目。
    const noDecl = noDeclByNode.get(fn.node) ?? noDeclByName.get(fn.name);
    if (noDecl) analysis.noDeclaration = true;

    // #176 skip×case 解耦：skip 只跳过**推断面**，不再 early-continue 整段——
    // @nudo:case 照常求值断言（运行时见证），用户不必在「声明返回面」与
    // 「运行时真值」之间二选一。面语义不变：combinedAbs 恒为声明面
    // （@nudo:skip =>），case 结果不参与面合成；推断类产物（synthCandidates
    // 调用点合成 / entry@ 兜底 / hof 泛型快照 / collapse 回写）对 skip 关闭。
    const skipped = skipDirective !== undefined && skipDirective.kind === "skip";
    if (skipped) {
      analysis.skipped = true;
      if (skipDirective.returns) {
        analysis.combinedAbs = skipDirective.returns;
      }
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
    // the fingerprint). BUG-184：参与合成的函数**可以**缓存，但键必须把
    // 「整文件状态」一起编进去（见下方 synthEligible 的 w= / ac= 段），且
    // 快照点必须在合成**之后**——否则命中回放的是一份没有 entry@/call@ 的
    // 半成品，LSP 长驻进程里一次 codeLens（caseMode=all）就把后续
    // nudo/contract / nudo/test / nudo/check 的见证永久降级。
    const fp = fnFpMap?.get(fn.name);
    // analysis 配置维度进 fn 键：evalMissingSlot / budget 等变更必须 miss
    // （整文件键已含，fn 键不加会陈旧命中 C0.5 诊断；maxForks 截断同理）
    const analysisFnKey = `m=${analysisCfg.mode}|e=${analysisCfg.evalMissingSlot}|b=${analysisCfg.callSiteBudget}|f=${analysisCfg.maxForks}`;
    // --both-paths（`nudo test` 教学对比面）：对**带 @nudo:case 的函数**也走
    // 合成路径——directive case 与 call@/entry@ 同轮同报（默认互斥见
    // limitations §3.2.1）。pointWitnessOnly 的 domainOnly 语义不动（点观测
    // ⇒ 入口兜底仍只作推断域）。
    const bothPathsFn =
      caseDirectives.length > 0 &&
      caseIdxsToRun.length > 0 &&
      (alsoSynthesizeCases === true ||
        (Array.isArray(alsoSynthesizeCases) && alsoSynthesizeCases.includes(fn.name)));
    // Bug 511：无断言的 case 指令是**见证**，不是调用域声明 ⇒ 点观测形态仍走
    // entry@/call@ 合成（域由推断面给出）。此判据决定本函数是否进 synthCandidates
    // ——必须在 fnCacheKey **之前**算完，键里要按「是否参与合成」补齐维度。
    const hasAssertedCase = caseIdxsToRun.some((i) => caseDirectives[i]?.expected !== undefined);
    const hasDomainShapedCase = caseIdxsToRun.some(
      (i) => !isPointObservationArgs(caseDirectives[i]?.argsAbs ?? []),
    );
    const pointWitnessOnly =
      caseIdxsToRun.length > 0 &&
      !hasAssertedCase &&
      !hasDomainShapedCase &&
      extractDeclaredThrows(source, fn.name) === undefined;
    // skip 函数不走合成（域由声明面接管，#176）
    const synthEligible = !skipped && (caseIdxsToRun.length === 0 || pointWitnessOnly || bothPathsFn);
    // 合成见证的输入是**整文件**调用记录：兄弟函数体里改一个调用点，本函数的
    // entry@/call@ 就变了，而 own/deps 指纹看不见。⇒ 参与合成的函数额外把
    // 整份源码指纹（w=）与「选中 case 表」（ac=，选中的函数体会执行 ⇒ 它内部的
    // 调用点进共享记录表）编进键，命中才等价于「同一份分析再跑一遍」。
    const scopeSeg = synthEligible
      ? [`w=${synthScopeKey()}`, activeCasesSeg].filter((s) => s.length > 0).join("\0")
      : "";
    const fnCacheKey =
      !fnDepFailClosed && fp && caseDirectives.length > 0 && !bothPathsFn
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
            // ADR 0001 切片 3：索引面 / 旧面两档互不回放（文件级键同纪律）。
            `face=${semanticIndexEntryFaceSegment()}`,
            // 自定义 loadModule（LSP buffer-aware）与默认磁盘加载器产出的分析
            // 不同 ⇒ 两档互不回放（与文件级键的 lm 段同口径：本段此前只有文件级
            // 键有，逐函数快照会被另一个加载器复用）。
            lmSeg,
            // 外部调用点记录（`--from` 现场）：已固化函数的二次 freeze 从它合成
            // 新见证（synthesizeFrozenCallSiteCases）⇒ 内容变更必须 miss。
            extSeg,
            scopeSeg,
          ]
            .filter((s) => s.length > 0)
            .join("\0")
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

    const sampleDirective = fn.directives.find((d) => d.kind === "sample");
    void sampleDirective; // TypeValue setSampleCount 已删

    // 无 case，或本轮不求值 case（none / selected 未命中）→ entry@ 出签名；
    // skip 函数不走合成/entry@ 兜底——推断面由声明面接管（#176）
    //
    // Bug 511（见 fnCacheKey 前的 pointWitnessOnly 判据）：点观测形态的
    // @nudo:case 是见证而非域声明 ⇒ 仍走 entry@/call@ 合成；域形状的观测与
    // **带断言**的 case 都是域声明 ⇒ 不进合成路径（面由它们给出）。
    // --both-paths：见上方 fnCacheKey 前的 bothPathsFn（教学对比面接线）。
    if (synthEligible) {
      // pointWitnessOnly：入口兜底**只为产出推断域**（见证不得独占返回面）——
      // 其 entry@ 见证不进 case 台账，入口求值带出的调用点证据也不并入共享
      // 台账（见 SynthCandidate.domainOnly）。
      synthCandidates.push({
        name: fn.name,
        node: fn.node,
        analysis,
        ...(pointWitnessOnly ? { domainOnly: true } : {}),
        // both-paths：带 case 见证的函数，entry@ 兜底只是回退观测
        // （不发 entry-only info，见 evaluateEntryCase）
        ...(bothPathsFn ? { hasDirectiveCases: true } : {}),
      });
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

    // 族 54（item 2）：**选中 case** 态下被选函数**不生成 entry@ 见证**（域由
    // 选中的那条 case 声明）⇒ 函数级 throws 域（check 签名行口径）在 case
    // 台账里无处安放 ⇒ IDE hover（只读 case 台账的 throws 证据）的 throws 段
    // 缺失 ⇒ hover 与 `nudo check` 的签名尾缀分叉。⇒ 补一次**只取证据**的
    // 入口求值，把函数级 throws 域并进该函数已有的 case 见证（不产见证 /
    // 不改域 / 不报诊断）。
    //
    // 只在 LSP 的 selected 模式补：① 该模式只有 LSP selectCase 在用；② "all"
    // 模式是 `nudo test` 的报告面 ⇒ 报告行不因本修复变动。
    // pointWitnessOnly 的函数已走 entry@ 兜底（见证在场）⇒ 跳过。
    // 只对**导出**函数补（入口面口径 = 导出函数，与 hover / check 同源）。
    if (
      !skipped &&
      caseMode === "selected" &&
      caseIdxsToRun.length > 0 &&
      !pointWitnessOnly &&
      exportedFnNames.has(fn.name)
    ) {
      evaluateThrowsOnly(caseEnv, { name: fn.name, node: fn.node, analysis });
    }

    // skip：combinedAbs 已是声明面，case 结果不回写——case 是运行时见证，
    // 不参与面合成（skip 的语义 = 声明面即产品面，#176）
    if (!skipped && analysis.cases.length > 0) {
      analysis.combinedAbs = collapseAbsLits(
        analysis.cases.map((c) => c.abs),
        COLLAPSE_LITERAL_THRESHOLD,
      );
    }

    // hof 泛型快照是推断面产物（dts 泛型投影源）——skip 函数不采集
    if (!skipped) attachHofSnapshot(analysis, source);

    // 快照**延后到合成之后**落盘（BUG-184）：entry@/call@ 合成会就地改
    // analysis.cases / combinedAbs，且它发生在函数循环之后的合成阶段 ⇒ 此处
    // 只登记待写项，合成循环结束时统一 flush（见下方 flushFnCacheWrites）。
    if (fnCacheKey) {
      const pending: PendingFnCacheWrite = {
        key: fnCacheKey,
        analysis,
        diagnostics: diagnostics.slice(dLen0),
        caseHints: caseHints.slice(hLen0),
        callRecords: callRecords.slice(cLen0),
      };
      pendingFnWrites.push(pending);
      pendingFnWritesByAnalysis.set(analysis, pending);
    }

    functionResults.push(analysis);
  }

  // Whole-program call inference: functions without @nudo:case directives
  // get cases synthesized from observed call sites; functions with no call
  // sites at all get a single entry evaluation with unknown parameters.
  const directiveFnNames = new Set(functions.map((f) => f.name));
  const directiveFnStmts = new Set(functions.map((f) => f.node));
  for (const { name, node, stmt, noDeclaration, assignedName } of topLevelFns) {
    if (directiveFnNames.has(name)) continue;
    // A statement carrying @nudo directives is already analyzed through the
    // directive path above (possibly under its "<anonymous>" name).
    if (directiveFnStmts.has(stmt)) continue;
    const synthFormals = extractFormals(node, source);
    const synthReturnAnnotation = extractReturnAnnotation(node);
    const synthThisReceiverType = thisReceiverTypeOf(name);
    const analysis: FunctionAnalysis = {
      name,
      loc: locFromNode(node),
      paramNames: extractParamNames(node),
      // Bug 479：合成路径的函数此前**不挂**形参表面 ⇒ 产物面（dts 参数位）
      // 看不到 `.ts` 源的声明类型。形参表面与 paramNames 同源（下标对齐）。
      ...(synthFormals.length > 0 ? { formals: synthFormals } : {}),
      ...(synthReturnAnnotation ? { declaredReturnType: synthReturnAnnotation } : {}),
      ...(synthThisReceiverType ? { thisReceiverType: synthThisReceiverType } : {}),
      cases: [],
    };
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
  // BUG-013：`export default function f` 的本地名。记录里的 `targetExport` 是
  // 导出名 `"default"`，而这里按**函数名**匹配 ⇒ 重命名默认导入（`import other
  // from`）/ `import {default as g}` / `ns.default(...)` 的跨文件证据全被丢弃。
  const defaultExportName = defaultExportLocalName(source) ?? undefined;

  // T10b：跨文件注入的调用点域证据 ⊄ 手写契约 → nudo:contract-domain-exceeds
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
      // 默认导出：导出名 `"default"` ↔ 本地函数名（BUG-013）
      (r.targetExport === "default" && defaultExportName === name) ||
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
    const autoBind = contractConfig(findProjectConfig(dirname(filePath))?.config).autoBind;
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
    // 本 candidate 在共享通道上的起点：合成产物要按这个切出来并入它自己的
    // 逐函数快照（各 candidate 的合成段在数组里连续）。
    const dStart = diagnostics.length;
    const hStart = caseHints.length;
    const cStart = callRecords.length;
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
    // BUG-035（证据范围）：只要**外部记录**（`--from` 使用现场调用）参与了本
    // 函数的域合成，就在分析结果上打标 —— 侧车把这条事实落进生成段的
    // `// evidence:` 行 ⇒ 之后本函数「今天没证据」时**不得**按「证据消失」
    // 删段（跨文件证据本轮可能压根没采集）。判据取**去重前**的匹配集：
    // 一条外部记录即便与本地记录载荷相同而被去重，也照旧打标（保守方向 =
    // 多保留，绝不误删）。
    if ((externalCallRecords ?? []).filter(matchingExternal).length > 0) {
      candidate.analysis.externalEvidence = true;
    }
    // T10b：跨文件注入的调用点域证据 ⊄ 手写契约 → nudo:contract-domain-exceeds
    // 带 case 指令的函数已在上面的指令循环里报过 ⇒ 不重复报（Bug 511 接线
    // 后指令函数也会进合成路径，两处都会触发 ⇒ 同一条诊断出两遍）。
    const hasCaseDirective = functions.some(
      (fn) => fn.name === candidate.name && fn.directives.some((d) => d.kind === "case"),
    );
    if (!hasCaseDirective) {
      reportInjectedDomainExceeds(candidate.name, candidate.node, candidate.analysis.loc);
    }
    if (records.length > 0) {
      // 调用点 case 合成（call@ / call@symbolic + combinedAbs）→ cases 文件
      synthesizeCallSiteCases(caseEnv, candidate, records, callSiteBudget);
      // 族 54（item 2）：这条路径**从不**产 entry@ 见证（调用点域直接接管）
      // ⇒ 函数级 throws 域（check 签名行口径：入口求值的 hard throw ∪ soft
      // may-throw）在 case 台账里无处安放 ⇒ IDE hover（只读 case 台账的 throws
      // 证据）的 throws 段缺失。⇒ 补一次**只取证据**的入口求值，把函数级
      // throws 域并进刚合成的调用点见证（不产见证 / 不改域 / 不报诊断）。
      // 只对**导出**函数补（入口面口径 = 导出函数，与 hover / check 同源）。
      if (exportedFnNames.has(candidate.name)) {
        evaluateThrowsOnly(caseEnv, candidate);
      }
    } else {
      // entry@ 兜底评估（含 may-throw 聚合与 entry-only 诊断）→ cases 文件
      evaluateEntryCase(caseEnv, candidate);
    }
    // 合成产物（见证 / 诊断 / 提示 / 调用点记录）并进该函数的待写快照——
    // 快照点必须在合成之后，否则命中会丢掉刚合成出来的见证（BUG-184）。
    const pendingWrite = pendingFnWritesByAnalysis.get(candidate.analysis);
    if (pendingWrite) {
      pendingWrite.diagnostics.push(...diagnostics.slice(dStart));
      pendingWrite.caseHints.push(...caseHints.slice(hStart));
      pendingWrite.callRecords.push(...callRecords.slice(cStart));
    }
  }

  // 逐函数快照统一落盘（合成之后）。cloneFunctionAnalysis 在**此刻**取，
  // analysis.cases / combinedAbs 已含 entry@/call@ 合成产物。
  //
  // 诊断必须在**此刻**与共享通道对账：`settleEntryOnlyCandidates` 在调用点
  // 证据出现后会 `splice` 掉该函数的 `nudo:contract-entry-only`（早期快照
  // 里的副本不会随之消失）⇒ 直接存副本会让下一次命中回放一条已被撤销的
  // info（同一调用在 1st 与 3rd 结果不同）。按对象身份求交 = 只保留**仍在**
  // 最终诊断里的条目；合成期间新推入的条目同样在这个集合里。
  const liveDiagnostics = new Set(diagnostics);
  for (const p of pendingFnWrites) {
    fnAnalysisCacheSet(p.key, {
      analysis: cloneFunctionAnalysis(p.analysis),
      diagnostics: p.diagnostics.filter((d) => liveDiagnostics.has(d)),
      caseHints: p.caseHints,
      callRecords: p.callRecords,
    });
  }
  pendingFnWrites.length = 0;
  pendingFnWritesByAnalysis.clear();

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
      : // 定位不到 specifier ⇒ 锚在文件首行（1 基）——0 不是合法行号，
        // 会顺着产物面流到 --json / GitLab / GHA（三面都要求 ≥ 1）。
        { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } };
    diagnostics.push({
      range,
      severity: "warning",
      message:
        `handwritten @nudo:env wins over harvest on module "${c.module}"${detail}; ` +
        `harvest only fills missing slots (B8). code=nudo:env-harvest-conflict`,
      code: DIAG.envHarvestConflict,
    });
  }

  // nudo:dual-entry：browser/node 双入口变体之一被分析 → 记录不跨文件注入，
  // 观察面只覆盖本入口（info，不是门禁；单入口包零误报）。
  //
  // 位置：**被分析入口文件的首行**（1 基行号 / 0 基列号）——与 check 通道
  // （entry-variants 的 entryVariantIssueForFile）同一锚点。此前这里硬编码
  // `line: 0 / column: 0` ⇒ `--json` 出 `"line": 0`、GitLab 出
  // `"lines": {"begin": 0}`、GHA 注解行号 0（三面都要求 ≥ 1）。
  try {
    const dual = entryVariantIssueForFile(filePath);
    if (dual) {
      diagnostics.push({
        range: {
          start: { line: dual.line, column: dual.column },
          end: { line: dual.line, column: dual.column },
        },
        severity: dual.severity,
        message: dual.message,
        code: dual.code,
        suggestions: [dual.suggestion],
      });
    }
  } catch {
    /* 诊断不得打断分析 */
  }

  // BUG-099：截断诊断（与 core check 面同码同级同措辞，见 truncationDiagnostics）。
  setAbsTruncationCollector(prevTruncationCollector);
  for (const issue of truncationDiagnostics(truncations, functionResults)) {
    diagnostics.push(issue);
  }

  // ABS-04：默认互斥（@nudo:case × call@/entry@）的可发现性提示——
  // 有指令 case 的函数若同时存在调用点记录，默认只报指令面；把函数名
  // 交出去让 CLI 提示 `--both-paths`（不改变默认输出，只加一行指引）。
  const bothPathsHint: string[] = [];
  if (alsoSynthesizeCases === undefined && callRecords.length > 0) {
    const modulePath = normalizeModulePath(filePath);
    // 名字路与主流程同口径（fnName / targetExport / targetAliases）；
    // 模块归属只看 targetModule（缺省 = 本文件）
    const matchesName = (r: (typeof callRecords)[number], name: string): boolean =>
      r.fnName === name ||
      r.targetExport === name ||
      (r.targetAliases?.includes(name) ?? false);
    for (const fn of functionResults) {
      if (!fn.cases.some((c) => c.source === "directive")) continue;
      const hasRecords = callRecords.some(
        (r) =>
          !isLeakedCallRecord(r) &&
          (r.targetModule === undefined ||
            normalizeModulePath(r.targetModule) === modulePath) &&
          matchesName(r, fn.name),
      );
      if (hasRecords) bothPathsHint.push(fn.name);
    }
  }

  return {
    functions: functionResults,
    diagnostics,
    bindings,
    nodeAbsMap,
    caseHints,
    ...(bothPathsHint.length > 0 ? { bothPathsHint } : {}),
    ...(externalFunctions.length > 0 ? { externalFunctions } : {}),
  };
}

/**
 * 截断观测 → `nudo:*-truncated` 诊断（BUG-099）。
 *
 * 引擎在预算/环上放弃求值时**必须可观测**：check 面由 core 的 `checkSource`
 * 报告，而分析器面（`nudo test` / `--json` / LSP）此前一条都没有——「引擎
 * 放宽了结果」与「源代码本来就这么宽」在观察面上不可区分。
 *
 * 口径与 core check 面（`packages/core/src/algebra/check.ts` 的截断诊断段）
 * **同码 / 同级 / 同措辞**：fork/depth/calls 臂的具体修值经
 * `@nudojs/core/internal` 的 suggested{Fork,Depth,Calls}Ceiling 单源消费
 * （公式改动只在 core/src/algebra/check-report.ts 一处生效）；纯文案改动
 * 仍需两处同步。
 *
 * 锚点：截断 label 就是被求值函数名 ⇒ 能对上本文件函数时锚在声明处；整轮
 * 标签（fork 预算）锚文件首行（1 基——0 不是合法行号，会顺着 --json /
 * GitLab / GHA 流出去）。其余 `#` 前缀标签（宿主副作用 / promise 微队列 /
 * Math 折叠 / 循环迭代）各有专用码与专用通道，不在此冒充「递归截断」。
 */
function truncationDiagnostics(
  truncations: ReadonlyMap<string, ReadonlySet<string>>,
  functions: readonly FunctionAnalysis[],
): Diagnostic[] {
  const issues: Diagnostic[] = [];
  for (const [label, reasons] of truncations) {
    const fn = functions.find((f) => f.name === label);
    const at = fn ? fn.loc.start : { line: 1, column: 0 };
    const range = {
      start: { line: at.line, column: at.column },
      end: { line: at.line, column: at.column },
    };
    if (label === FORK_TRUNCATION_LABEL) {
      // DX：suggestion 给具体修值（与 core check 面同公式同文案——单源
      // suggestedForkCeiling，观测值来自 getAbsCallBudgetStats；改公式/文案
      // 去 core/src/algebra/check-report.ts，两臂自动跟随）
      const observedForks = getAbsCallBudgetStats().forks;
      const forksFix = suggestedForkCeiling(observedForks);
      issues.push({
        range,
        severity: "info",
        message:
          "Branch expansion was truncated (fork budget); affected results widened to unknown#opaque (budget)",
        code: DIAG.forkTruncated,
        suggestions: [
          `fix: package.json#nudo.analysis.maxForks=${forksFix} (observed ${observedForks} forks this run), or @nudo:budget forks=${forksFix} on the function — non-blocking`,
        ],
      });
      continue;
    }
    // #158 后续：循环迭代预算**不是**递归、也不是调用预算 —— `@nudo:budget
    // calls=/depth=` 抬不动（两段 maxIters/MAX_CONCRETE_LOOP_ITERS），必须专用
    // 文案，否则用户按 suggestion 抬预算而截断照旧（与 core check 面同码同级
    // 同措辞，见 algebra/check.ts 的 LOOP_TRUNCATION_LABEL 分支）。
    if (label === LOOP_TRUNCATION_LABEL) {
      issues.push({
        range,
        severity: "info",
        message:
          "A loop did not terminate within its iteration budget (abstract unroll cap reached and the exit condition stayed concrete-true); affected loop state was widened (bounded, not exact)",
        code: DIAG.loopTruncated,
        suggestions: [
          "optional: restructure so the exit condition becomes abstract (data-dependent) within a few iterations, or pin the result with @nudo:case / @nudo:contract — non-blocking",
        ],
      });
      continue;
    }
    if (label.startsWith("#")) continue;
    // 调用截断归因（#158）：全 cycle ⇒ 不是预算，抬 @nudo:budget 永远解不开。
    const allCycle = reasons.size > 0 && [...reasons].every((r) => r === "cycle");
    const depth = reasons.has("depth");
    const calls = reasons.has("calls");
    // DX：depth/calls 臂的 @nudo:budget suggestion 带具体建议值（与 core
    // check 面同公式同文案——单源 suggested{Depth,Calls}Ceiling，观测值
    // A/B 两路径取大；cycle 臂不抬预算，不消费这两个值）
    const recursionStats = getAbsCallBudgetStats();
    const depthFix = suggestedDepthCeiling(Math.max(recursionStats.depth, recursionStats.evalDepth));
    const callsFix = suggestedCallsCeiling(Math.max(recursionStats.calls, recursionStats.evalCalls));
    issues.push({
      range,
      severity: "info",
      message: allCycle
        ? `Recursive evaluation of '${label}' hit a call cycle (same abstract arguments already on the stack); result widened to unknown#opaque (cycle — budget cannot lift this)`
        : `Recursive evaluation of '${label}' was truncated (${depth && calls ? "depth/size budget" : depth ? "call-depth budget" : calls ? "total-calls budget" : "depth/size budget"}); result widened to unknown#opaque (budget — not inference debt)`,
      code: DIAG.recursionTruncated,
      suggestions: [
        allCycle
          ? "a call cycle is not a budget: make the recursion arguments vary per level, narrow the base case, or declare @nudo:contract — raising @nudo:budget will not change this"
          : depth && !calls
            ? `raise the function budget with @nudo:budget depth=${depthFix} (or narrow the recursion base case / declare @nudo:contract return)`
            : calls && !depth
              ? `raise the function budget with @nudo:budget calls=${callsFix} (or narrow the recursion base case / declare @nudo:contract return)`
              : `raise the function budget with @nudo:budget calls=${callsFix} depth=${depthFix} (or narrow the recursion base case / declare @nudo:contract return)`,
      ],
    });
  }
  return issues;
}
