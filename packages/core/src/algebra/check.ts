// IMPLEMENTED:cli-semantics — L2 入口 may-throw（nudo:entry-may-throw）+
//   --ignore-throws / entryThrows；C0 body-slot 义务禁令仍正交成立。
/**
 * nudo check 门禁：对源码跑代数分析，产出 error/warning。
 *
 * 报告是 **Nudo 原生格式**（Abs 优先），不是 TS 诊断的换皮：
 * - 签名表给出无损 Abs（shape/term/pred/conf）+ throws 域
 * - L1：显式契约 / 调用点证据违例
 * - L2：export/default/CJS 入口未消化 may-throw → nudo:entry-may-throw
 * - 违例写清 actual ⊭ expected；成功也打印 signatures
 */

import { isBuiltin } from "node:module";
import { parseSource as parse } from "./parse-source.ts";
import { stripStringsKeepComments } from "./code-text.ts";
import { extractFileEnvNames } from "./directive-scan.ts";
import {
  setAbsTruncationCollector,
  resetAbsCallBudget,
  getAbsCallBudgetStats,
  FORK_TRUNCATION_LABEL,
  HOST_EFFECT_LABEL_PREFIX,
  MATH_FOLD_ERROR_LABEL,
  PROMISE_MICRO_OVERFLOW_LABEL,
  PROMISE_MICRO_ERROR_LABEL,
  type AbsTruncationReason,
} from "./call-budget.ts";
import { LOOP_TRUNCATION_LABEL } from "./exec/runtime/loop-budget.ts";
import type { AbsAssignRecord, AbsCallRecord } from "./ast-records.ts";
import { leqAbs } from "./leq.ts";
import {
  contractSegmentLocs,
  extractAssumeSegs,
  extractInvariantSegs,
  extractRefineReturnFromSource,
  extractDeclaredThrows,
  fnTopLevelLocalNames,
  refineDiagCount,
  setRefineDiagCollector,
  takeRefineDiagsSince,
} from "./refine.ts";
import { runWithCollectorScope } from "./collector-scope.ts";
import {
  effectiveInterface,
  formatConstraint,
  interfaceDiagCount,
  localNamedExports,
  resetSidecarLoadFailureCache,
  setInterfaceDiagCollector,
  sidecarClosureFingerprint,
  sidecarPathOf,
  takeInterfaceDiagsSince,
  type EffectiveInterface,
} from "./interface.ts";
import {
  constraintToEntryAbs,
  type NudoConstraint,
} from "./constraint.ts";
import { absToConstraint } from "./projection.ts";
import {
  checkReturnConstraint,
  type ReturnContractSource,
} from "./check-return.ts";
// Bug 367：引理消费记账（清账 / 取快照 ⇒ 审计归因只认真正消费过的引理）
import { assumeConsumed, resetAssumeConsumed } from "./assume-ledger.ts";
import { extractFn, generalizeFromAst } from "./generalize.ts";
import {
  attachContractFaces,
  contractFacesFromEffectiveInterface,
  setContractFaceResolver,
  type FnContractFaces,
} from "./contract-face.ts";
import { resolveDepPath } from "./sidecar-path.ts";
import {
  contractParamNameSet,
  formalParamSignatureNames,
  type FormalParam,
} from "./param-surface.ts";
import { canSkipLiteralCallScan } from "./fn-fp.ts";
import { stableAnalyzeKeySource } from "./stable-source-key.ts";
import {
  extractAllLoadSpecs,
  normPath,
  type LoadDepsFingerprint,
} from "./load-deps-fp.ts";
import { guardLoadModule, type LoadReadFailure } from "./load-guard.ts";
import { anyAbs } from "./abs.ts";
import type { Abs } from "./abs.ts";
import { abs } from "./abs.ts";
import type { Phi, Pred } from "./pred.ts";
import { and as pAndPred, le as lePred, pTrue } from "./pred.ts";
import { v as termVar } from "./term.ts";
import { formatAbs, formatAbsMultiline, formatShape } from "./format.ts";
import type { CheckIssue, CheckReport, NudoSig } from "./check-report.ts";
import type { PolyFn } from "./generalize.ts";
import { listTopFunctions, scanLiteralCalls } from "./scan.ts";
import {
  interfaceDriftIssues,
  type DriftCandidate,
} from "./check-interface-drift.ts";
import {
  estimateEntryParamCount,
  isDefaultExportName,
  formatEntrySigLine,
  formatEntryParamShape,
  findFnLoc,
  formatSigCached,
} from "./check-signatures.ts";
import { collectEntryMayThrows, evalAnalyzeOpts } from "./check-may-throw.ts";
import { structuralAssignIssues } from "./check-assign.ts";
import { scanCaseInconsistency } from "./check-case-scan.ts";
import {
  tryRunTranspiled,
  callTranspiledExportFull,
  bindingsOf,
} from "./exec/run.ts";
import { withAssumePremises } from "./exec/runtime.ts";
import { withInvariantSpecs } from "./exec/runtime/state.ts";
import type { InvariantSpec } from "./exec/runtime/invariant-apply.ts";
import { setEvalAssignCollector, setEvalCallCollector, type EvalCallRecord } from "./exec/calls.ts";
import {
  filterGateThrows,
  mayThrowEffectsToAbs,
  formatThrowsAbs,
} from "./exec/may-throw.ts";

// --- 整文件 CheckReport memo → check-memo.ts（对外形状经 re-export 保持不变） ---

export {
  resetCheckSourceMemo,
  evictCheckSourceMemoForPaths,
} from "./check-memo.ts";
import {
  checkDepsFingerprint,
  cloneCheckReport,
  checkMemoKey,
  checkMemoGet,
  checkMemoSet,
} from "./check-memo.ts";

// ---------------------------------------------------------------------------
// 公共入口（CheckOptions / checkSource）
// ---------------------------------------------------------------------------

export type { CheckOptions } from "./check-types.ts";
import type { CheckOptions } from "./check-types.ts";
import { DIAG } from "./diag-codes.ts";

/**
 * 检查一个文件：
 * - 每个顶层函数 generalize；无法得到任何签名 → warning
 * - 若 source 中有字面量调用 `f(负数)` 且 f 有 `>0` 约束 → error
 * - entry 结果 partial/opaque → info
 *
 * 默认 Φ（pTrue）走整文件 memo：同 source + deps + loadModule 身份 → O(1)。
 */
export function checkSource(
  filePath: string,
  source: string,
  phi: Phi = pTrue,
  opts: CheckOptions = {},
): CheckReport {
  // collector 作用域（幂等）：一次完整 check 的 collector 生命周期在此收口；
  // 嵌套调用（analyzeFile 内 / 宿主外层已开作用域）零开销复用外层 store。
  return runWithCollectorScope(() =>
    checkSourceInScope(filePath, source, phi, opts),
  );
}

function checkSourceInScope(
  filePath: string,
  source: string,
  phi: Phi,
  opts: CheckOptions,
): CheckReport {
  // Per-call loadModule cache: dep fingerprint + scan/refine share one read.
  // Identity for memo keys stays on the caller's raw loadModule — a fresh
  // wrapper each call would make loadModuleId() unique and defeat the memo.
  //
  // Bug 499：依赖**不可读**（EACCES / EIO / EMFILE…）时 loader 抛错——该
  // 异常不得穿透到 `nudo check` 的整轮外面（stdout 0 字节、无任何报告）。
  // 本闸把抛错降级为「该依赖不可用」（undefined）+ 一条结构化失败清单，
  // 清单在报告里收口为一条明确诊断（口径同 service 侧 ModuleReadError 的
  // 「不可读 ≠ 不存在」：错误轮的报告不得与真 miss 轮共享同一份结论）。
  let callOpts = opts;
  /** 本轮读失败清单（同一路径只记一次） */
  const loadReadFailures: LoadReadFailure[] = [];
  const loadFailureKeys = new Set<string>();
  if (opts.loadModule && opts.fromFile) {
    const loadCache = new Map<string, string | undefined>();
    const raw = opts.loadModule;
    const fromFile = opts.fromFile;
    callOpts = {
      ...opts,
      loadModule: guardLoadModule(
        (spec, from) => {
          const k = `${from}\0${spec}`;
          if (!loadCache.has(k)) loadCache.set(k, raw(spec, from));
          return loadCache.get(k);
        },
        (failure) => {
          const key = `${failure.path}\0${failure.code}`;
          if (loadFailureKeys.has(key)) return;
          loadFailureKeys.add(key);
          loadReadFailures.push(failure);
        },
      ),
    };
  }

  // 诊断纯缓冲模式：refine/interface 侧车诊断由 checkSource 统一收口进报告
  setRefineDiagCollector(null);
  setInterfaceDiagCollector(null);
  // #64：侧车加载失败去重表按次分析重置——同一侧车失败只报一次，且下次 check 仍可见
  resetSidecarLoadFailureCache();
  // since 锚：memo 命中路径只排干本次（指纹/侧车加载）产生的增量诊断，
  // 不全量 take——全量 take 会窃取在途 LSP validateText 的待消费诊断
  const refineSince = refineDiagCount();
  const ifaceSince = interfaceDiagCount();

  const useMemo = phi.op === "true";
  let memoKey: string | undefined;
  // 尾部无 @nudo 的注释/空行不进键：comment-only 编辑复用 CheckReport
  const stable = stableAnalyzeKeySource(source);
  // 一次指纹：check 整文件 memo + 所有 generalize L0 共用（避免 per-fn 重读 dep）
  const depsFp = checkDepsFingerprint(stable, callOpts);
  // ambient 侧车闭包指纹：进 memo 键（侧车变更 → 报告失效）+ 存在性门控 +
  // 逐出登记（evictCheckSourceMemoForPaths）；截断前缀 → 键不可信 fail-open
  const sidecarFp =
    callOpts.loadModule && callOpts.fromFile
      ? sidecarClosureFingerprint(callOpts.fromFile, callOpts)
      : undefined;
  const allowMemo =
    useMemo &&
    !depsFp.truncated &&
    // 读错误轮键不可信（#135）：错误轮报告（nudo:interface-load）与真 miss 轮
    // （干净）若共享 miss 键会互为跨次陈旧命中——不读也不写 memo
    !depsFp.readError &&
    // Bug 499：本闸把读失败降级成 miss（指纹面看不到 readError）——但
    // 「不可读」轮与「真不存在」轮的报告不同（前者多一条读失败诊断），
    // 共用同一键会互为陈旧命中 ⇒ 读失败轮一律不碰 memo。
    loadReadFailures.length === 0 &&
    !(sidecarFp?.startsWith("trunc:") ?? false);
  if (allowMemo) {
    memoKey = checkMemoKey(filePath, stable, opts, depsFp, sidecarFp);
    const hit = checkMemoGet(memoKey);
    if (hit) {
      takeRefineDiagsSince(refineSince);
      takeInterfaceDiagsSince(ifaceSince);
      return cloneCheckReport(hit);
    }
  }

  const issues: CheckIssue[] = [];
  const signatures: NudoSig[] = [];
  // 单次 parse：listTopFunctions / generalize / analyzeFn / scan 共用
  const file = parse(source);
  const names = listTopFunctions(source, file);

  // 侧车路径登记进 memo 依赖：`*.nudo.js` 变更后定向逐出
  const memoPaths =
    sidecarFp !== undefined && callOpts.fromFile
      ? [...new Set([...depsFp.paths, normPath(sidecarPathOf(callOpts.fromFile))])]
      : depsFp.paths;

  // 递归截断：与 TypeValue 的 nudo:recursion-truncated 对齐。
  // label → 截断原因集（#158）：cycle（同抽象实参已在栈上）与 depth/calls
  // （真预算）分流——前者抬 @nudo:budget 无效，报预算只会误导排查。
  const truncated = new Map<string, Set<AbsTruncationReason>>();
  resetAbsCallBudget();
  const prevTrunc = setAbsTruncationCollector((label, reason) => {
    const reasons = truncated.get(label) ?? new Set<AbsTruncationReason>();
    if (reason) reasons.add(reason);
    truncated.set(label, reasons);
  });
  try {
    // #123 fix B：调用边界契约面——同文件按名 resolver（$callNamed 消费）+
    // 跨模块桥接 Abs fn 预挂面（$call 消费）。安装在本 check 的动态范围内：
    // generalize / L2 求值 / 文件级 scan 的 B run 全部生效；memo 命中路径
    // 不进此处（报告已固化）。
    const prevFaceResolver = setContractFaceResolver(
      makeSameFileFaceResolver(callOpts, filePath, source, file),
    );
    try {
      const crossModuleIssues = attachCrossModuleContractFaces(callOpts, filePath);
      const report = checkSourceInner(
        filePath,
        source,
        file,
        phi,
        callOpts,
        issues,
        signatures,
        names,
        truncated,
        opts,
        depsFp,
        sidecarFp,
      );
      // 侧车诊断 side-channel 收口：nudo:interface-load / interface-cycle 等
      // 不再静默（同源重复收集按 code+message 去重）。用 since 锚避免窃取
      // 在途 LSP validateText 的待消费诊断。
      const diagIssues = sidecarDiagIssues([
        ...takeRefineDiagsSince(refineSince),
        ...takeInterfaceDiagsSince(ifaceSince),
      ]);
      // Bug 499：依赖不可读（EACCES/EIO/…）——降级为一条明确诊断，不再
      // 让异常炸穿整轮 check。诊断码沿用既有的 nudo:module-missing（依赖
      // 「不可用」），但消息写明**读失败**的事实与 errno（不得谎报
      // 「文件不存在」）。严重级 error：依赖读不到 ⇒ 其类型面不可信，
      // 门禁须 fail-closed。
      const loadIssues = loadReadFailureIssues(loadReadFailures);
      const allIssues = [...diagIssues, ...loadIssues, ...crossModuleIssues];
      if (allIssues.length > 0) {
        report.issues.push(...allIssues);
        const errors = report.issues.filter((i) => i.severity === "error").length;
        const warnings = report.issues.filter((i) => i.severity === "warning").length;
        const infos = report.issues.filter((i) => i.severity === "info").length;
        report.ok = errors === 0;
        report.summary = {
          errors,
          warnings,
          infos,
          functions: report.summary.functions,
        };
      }
      // 读失败轮不写 memo（键与「真不存在」轮同形 ⇒ 会互为陈旧命中）
      if (memoKey && loadReadFailures.length === 0) {
        checkMemoSet(memoKey, report, memoPaths);
      }
      return cloneCheckReport(report);
    } finally {
      setContractFaceResolver(prevFaceResolver);
    }
  } finally {
    setAbsTruncationCollector(prevTrunc);
  }
}

// ---------------------------------------------------------------------------
// Bug 499：依赖不可读（EACCES / EIO / EMFILE…）的诊断收口
// ---------------------------------------------------------------------------

/**
 * 读失败清单 → 报告诊断。
 *
 * 诊断码用 `nudo:module-unreadable`（与 service 面同码）：「存在但不可读」
 * 必须与 `nudo:module-missing`（「无此文件」）严格区分——文件就在那儿，只是
 * 读不了，折叠成「不存在」会让诊断与事实相反（Bug 499）。消息带上路径 /
 * errno / 原因。
 *
 * 严重级 error：依赖读不到 ⇒ 其类型面不可信，门禁须 fail-closed。
 */
function loadReadFailureIssues(failures: LoadReadFailure[]): CheckIssue[] {
  return failures.map((f) => ({
    severity: "error" as const,
    code: DIAG.moduleUnreadable,
    message: `cannot read module '${f.path}' (${f.code}): ${f.message}`,
    suggestion:
      "fix the file permissions (or the module path) — the dependency is present but unreadable, so its types are unknown",
  }));
}

// ---------------------------------------------------------------------------
// #123 fix B：调用边界契约面的装配（同文件 resolver + 跨模块桥接面）
// ---------------------------------------------------------------------------

/**
 * 被分析文件自身的同名契约 → 位置化契约面（按名 memo）。$callNamed 在
 * 同文件调用点消费（跨模块桥接走 $call 的对象注册面）。仅 handwritten；
 * effectiveInterface 解析失败 → undefined（面留空 = 今日行为）。
 */
function makeSameFileFaceResolver(
  opts: CheckOptions,
  filePath: string,
  source: string,
  file: ReturnType<typeof parse>,
): (fnName: string) => FnContractFaces | undefined {
  const loadModule = opts.loadModule;
  const fromFile = opts.fromFile ?? filePath;
  const autoBind = opts.autoBind;
  const projectDir = opts.projectDir;
  const memo = new Map<string, FnContractFaces | undefined>();
  return (fnName: string): FnContractFaces | undefined => {
    if (memo.has(fnName)) return memo.get(fnName);
    let faces: FnContractFaces | undefined;
    try {
      const eff = effectiveInterface(source, fnName, {
        ...(loadModule ? { loadModule } : {}),
        fromFile,
        ...(autoBind !== undefined ? { autoBind } : {}),
        ...(projectDir !== undefined ? { projectDir } : {}),
      });
      if (eff) {
        const params = extractFn(source, fnName, file)?.params ?? [];
        faces = contractFacesFromEffectiveInterface(eff, params);
      }
    } catch {
      faces = undefined;
    }
    memo.set(fnName, faces);
    return faces;
  };
}

/**
 * 契约形参名 ∉ 形参表面（C4.5 口径）：展示名 ∪ 契约面名（解构顶层绑定名 /
 * rest 裸名 / 嵌套点路径）之外的契约形参名 = 对不上的名字。冲突位（合取
 * 不可满足）不算对不上——它由 nudo:interface-conflict 报。
 *
 * **同文件路径与跨模块桥接路径共用这一段计算**（Bug 1023）⇒ 两边口径不再
 * 分叉：跨模块不得「一边报 mismatch 一边静默丢义务」。
 */
function unmatchedContractParams(
  eff: EffectiveInterface,
  formalDisplay: string[],
  formals: FormalParam[],
): string[] {
  const contractNames = contractParamNameSet(formals);
  const display = new Set(formalDisplay);
  const conflictNames = new Set(eff.conflict?.params ?? []);
  return eff.params
    .map((p) => p.param)
    .filter(
      (p) =>
        p &&
        !display.has(p) &&
        !contractNames.has(p) &&
        !conflictNames.has(p),
    );
}

/** nudo:interface-param-mismatch 诊断（同文件 / 跨模块共用文案与 severity） */
function paramMismatchIssue(
  name: string,
  unknownParams: string[],
  formalDisplay: string[],
  formals: FormalParam[],
): CheckIssue {
  const contractNames = contractParamNameSet(formals);
  const surface = [...contractNames]
    .filter((n) => !n.startsWith("_p") && n !== "_")
    .join(", ");
  return {
    severity: "error",
    code: DIAG.interfaceParamMismatch,
    message: `${name}: contract parameter name(s) not in the formal parameter list (${unknownParams.join(", ")})`,
    actual: unknownParams.join(", "),
    expected: surface || formalDisplay.join(", ") || "(no params)",
    suggestion: `rename the @nudo:contract / sidecar binding parameter to one of: ${
      surface || formalDisplay.join(", ") || "(function has no params)"
    }`,
    fn: name,
  };
}

/**
 * 跨模块桥接面：注入模块表（opts.modules ∪ opts.inject.modules）里的
 * fn Abs 逐个按「说明符 → 依赖源码（loadModule）→ 依赖侧车（定义文件
 * 路径 ambient 绑定）」解析契约并 attach。每次 check 现算现挂（覆盖旧面，
 * 进程内长会话不滞留）；loadModule miss（表非 fs 装配）→ 该说明符无面。
 *
 * Bug 1023：跨模块路径与同文件路径**同口径**——契约形参名对不上形参表时
 * 报 nudo:interface-param-mismatch（返回给调用方的诊断列表），不再静默
 * 丢参数面（那会让该形参的义务在调用方**蒸发** ⇒ 调用点假绿）。
 */
function attachCrossModuleContractFaces(
  opts: CheckOptions,
  filePath: string,
): CheckIssue[] {
  const loadModule = opts.loadModule;
  const fromFile = opts.fromFile ?? filePath;
  if (!loadModule) return [];
  const tables: Array<Record<string, unknown>> = [];
  for (const t of [opts.modules, opts.inject?.modules]) {
    if (t && typeof t === "object" && !tables.includes(t)) tables.push(t as Record<string, unknown>);
  }
  if (tables.length === 0) return [];
  const autoBind = opts.autoBind;
  const projectDir = opts.projectDir;
  const mismatchIssues: CheckIssue[] = [];
  const facesCache = new Map<
    string,
    { faces: FnContractFaces | undefined; eff: EffectiveInterface | undefined }
  >();
  const facesFor = (
    depSource: string,
    depPath: string,
    name: string,
    paramNames: string[],
  ): { faces: FnContractFaces | undefined; eff: EffectiveInterface | undefined } => {
    const key = `${depPath}\0${name}`;
    const hit = facesCache.get(key);
    if (hit) return hit;
    let faces: FnContractFaces | undefined;
    let eff: EffectiveInterface | undefined;
    try {
      eff = effectiveInterface(depSource, name, {
        loadModule,
        fromFile: depPath,
        ...(autoBind !== undefined ? { autoBind } : {}),
        ...(projectDir !== undefined ? { projectDir } : {}),
      });
      if (eff) faces = contractFacesFromEffectiveInterface(eff, paramNames);
    } catch {
      faces = undefined;
      eff = undefined;
    }
    const out = { faces, eff };
    facesCache.set(key, out);
    return out;
  };
  const attachFnAbs = (v: unknown, depSource: string, depPath: string, name: string): void => {
    if (!v || typeof v !== "object" || !("shape" in (v as object))) return;
    const shape = (v as Abs).shape as { k?: string };
    if (shape.k !== "fn") return;
    // 形参名从依赖源码解析（extractFn）：桥接 Abs 的 shape.params 对
    // `export function` 声明回退 argN（topLevelFnParams 的既有行为）。
    // 名锚定契约（a/b）对不上位时**报 param-mismatch**（同文件路径同口径），
    // 不再静默丢参数面。
    let paramNames: string[] = [];
    let formals: FormalParam[] = [];
    try {
      const meta = extractFn(depSource, name);
      paramNames = meta?.params ?? [];
      formals = meta?.formals ?? [];
    } catch {
      paramNames = [];
      formals = [];
    }
    const { faces, eff } = facesFor(depSource, depPath, name, paramNames);
    if (faces) attachContractFaces(v as object, faces);
    if (eff?.source === "handwritten") {
      const unknownParams = unmatchedContractParams(eff, paramNames, formals);
      if (unknownParams.length > 0) {
        mismatchIssues.push(
          paramMismatchIssue(name, unknownParams, paramNames, formals),
        );
      }
    }
  };
  for (const table of tables) {
    for (const [spec, mod] of Object.entries(table)) {
      if (!mod || typeof mod !== "object") continue;
      const named = (mod as { named?: Record<string, unknown> }).named;
      if (!named) continue;
      let depSource: string | undefined;
      try {
        depSource = loadModule(spec, fromFile);
      } catch {
        depSource = undefined;
      }
      if (!depSource) continue;
      const depPath = resolveDepPath(fromFile, spec);
      for (const [name, v] of Object.entries(named)) {
        attachFnAbs(v, depSource, depPath, name);
      }
      const def = (mod as { default?: unknown }).default;
      if (def !== undefined) attachFnAbs(def, depSource, depPath, "default");
    }
  }
  return mismatchIssues;
}

/**
 * refine/interface 侧车诊断 → CheckIssue（code+message 去重，
 * 同一失败侧车会在 generalize / 返回后置 / case 对账多处被重复探测）。
 * severity 按 code 定档：interface-load/cycle = error；contract-syntax = warning。
 */
// ---------------------------------------------------------------------------
// 门禁编排（sidecar 诊断收集 + checkSourceInner：L0 签名 / L1 契约 / L2 throws）
// ---------------------------------------------------------------------------

function sidecarDiagIssues(
  diags: Array<{
    code: string;
    message: string;
    file?: string;
    /** Bug 374：指令文法诊断的位置（refine 侧带行/列） */
    line?: number;
    column?: number;
  }>,
): CheckIssue[] {
  const seen = new Set<string>();
  const out: CheckIssue[] = [];
  for (const d of diags) {
    const k = `${d.code}\0${d.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const severity =
      d.code === DIAG.contractSyntax || d.code === DIAG.directiveSyntax
        ? ("warning" as const)
        : ("error" as const);
    out.push({
      severity,
      code: d.code,
      message: d.message,
      // Bug 374：位置透传（nudo:contract-syntax 不再落在文件第 1 行第 1 列）
      ...(d.line !== undefined ? { line: d.line } : {}),
      ...(d.column !== undefined ? { column: d.column } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// #152：@nudo:assume 用户引理前提（文法/形参校验 + 入口 Phi 构造）
// ---------------------------------------------------------------------------

/**
 * `@nudo:assume <param> <= <param>`（`>=` 已在 refine 翻转为 le）：
 * - 文法外形态（`<` / `>` / `==`、字面量界）→ error nudo:assume-invalid（不折）
 * - 引用名不在锚定函数形参 ∪ 函数体顶层局部绑定（#165）→ error
 *   nudo:assume-invalid（消息口径仿 nudo:interface-param-mismatch）；
 *   局部绑定 SSA 语义：引理作用于绑定值，从定义点到作用域尾
 * 合法段构造 le(termVar(lhs), termVar(rhs))（param 契约 Abs 同锚定口径），
 * pAnd 成 Phi 供目标函数入口求值种子（withAssumePremises，不随调用链继承）。
 * display = 合法段原文（`d <= max`），供证明成功时的审计标注
 * （nudo:assume-relied——assume 是用户公理，依赖面必须上屏可见）。
 * premises = 与 display 同序的前提对象（#367：审计归因按**对象身份**认
 * 「本次证明消费过哪条引理」——代数核记账记的就是这些对象）。
 * 无 assume 行（或全部非法不折）→ undefined（零行为变化）。
 */
function assumePremisesPhiOf(
  name: string,
  source: string,
  file: ReturnType<typeof parse>,
  issues: CheckIssue[],
): { phi: Phi; display: string[]; premises: Pred[] } | undefined {
  const segs = extractAssumeSegs(source, name);
  if (segs.length === 0) return undefined;
  const meta = extractFn(source, name, file);
  // #165：可锚定面 = 形参 ∪ 函数体顶层局部绑定（const/let/var Identifier 名）。
  // 局部绑定走 SSA 语义：引理作用于绑定值，从定义点到作用域尾。
  const locals = fnTopLevelLocalNames(meta?.body);
  const bindable = new Set<string>([
    ...contractParamNameSet(meta?.formals ?? []),
    ...(meta?.params ?? []),
    ...locals,
  ]);
  const surface = [...bindable].join(", ");
  const preds: Pred[] = [];
  const display: string[] = [];
  for (const seg of segs) {
    // Bug 374：位置 = 出错指令行（不是函数声明行 / 文件首行）
    const pos =
      seg.line !== undefined
        ? { line: seg.line, ...(seg.column !== undefined ? { column: seg.column } : {}) }
        : {};
    if (seg.kind === "bad") {
      issues.push({
        severity: "error",
        code: DIAG.assumeInvalid,
        message: `${name}: malformed @nudo:assume '${seg.raw}' (expected <param> <= <param> or <param> >= <param>; constant bounds belong to sidecar contracts)`,
        actual: seg.raw,
        expected: "<param> <= <param>",
        suggestion:
          "cross-variable lemmas: @nudo:assume d <= max — constant bounds: sidecar number().le(10)",
        fn: name,
        ...pos,
      });
      continue;
    }
    const bad = [seg.lhs, seg.rhs].filter((n) => !bindable.has(n));
    if (bad.length > 0) {
      issues.push({
        severity: "error",
        code: DIAG.assumeInvalid,
        message: `${name}: @nudo:assume name(s) not bound as parameters or top-level locals (${bad.join(", ")})`,
        actual: bad.join(", "),
        expected: surface || "(no params/locals)",
        suggestion: `reference one of: ${surface || "(no params or top-level locals)"}`,
        fn: name,
        ...pos,
      });
      continue;
    }
    preds.push(lePred(termVar(seg.lhs), termVar(seg.rhs)));
    // ok 段已 le 规范化（`>=` 解析期翻转）——display 用规范形重建
    display.push(`${seg.lhs} <= ${seg.rhs}`);
  }
  if (preds.length === 0) return undefined;
  return { phi: pAndPred(...preds), display, premises: preds };
}

// ---------------------------------------------------------------------------
// #176：@nudo:invariant 循环携带界（文法/绑定名校验 + spec 构造）
// ---------------------------------------------------------------------------

/**
 * `@nudo:invariant <name><path> <rel> <number>`（如 `dp[*][*] >= 0`）：
 * - 文法外形态（`==`、字面量缺号、非 `[*]`/`.ident` 路径）→ warning
 *   nudo:invariant-invalid（不折；warning 而非 assume 的 error——循环界
 *   声明错只损失该引理的证明力，不产生假面）
 * - 引用名不在锚定函数形参 ∪ 函数体顶层局部绑定 → 同码 warning
 *   （消息口径仿 nudo:assume-invalid）
 * 合法段构造 InvariantSpec 供目标函数入口求值种子（withInvariantSpecs，
 * 不随调用链继承——callee 帧清空）。消费方：exec/runtime/invariant-apply.ts
 * 在循环 join/宽化位（widenLoopJoin / widenFinal）按绑定名实施强化。
 * display = 合法段规范形原文，供证明成功时的审计标注
 * （nudo:invariant-relied——与 assume 同为用户公理，依赖面必须上屏可见）。
 * 无 invariant 行（或全部非法不折）→ undefined（零行为变化）。
 * 注：generalize L0 memo 键不含 specs（与 assume 前提同款已知少精度，
 * 非 unsound——种子 extent 内算出的结果会被无种子上下文复用，方向是少证）。
 */
function invariantSpecsOf(
  name: string,
  source: string,
  file: ReturnType<typeof parse>,
  issues: CheckIssue[],
): { specs: InvariantSpec[]; display: string[] } | undefined {
  const segs = extractInvariantSegs(source, name);
  if (segs.length === 0) return undefined;
  const meta = extractFn(source, name, file);
  // 可锚定面与 @nudo:assume 同口径：形参 ∪ 函数体顶层局部绑定（#165）
  const bindable = new Set<string>([
    ...contractParamNameSet(meta?.formals ?? []),
    ...(meta?.params ?? []),
    ...fnTopLevelLocalNames(meta?.body),
  ]);
  const surface = [...bindable].join(", ");
  const specs: InvariantSpec[] = [];
  const display: string[] = [];
  for (const seg of segs) {
    // Bug 374：位置 = 出错指令行（不是函数声明行 / 文件首行）
    const pos =
      seg.line !== undefined
        ? { line: seg.line, ...(seg.column !== undefined ? { column: seg.column } : {}) }
        : {};
    if (seg.kind === "bad") {
      issues.push({
        severity: "warning",
        code: DIAG.invariantInvalid,
        message: `${name}: malformed @nudo:invariant '${seg.raw}' (expected <name><path> <rel> <number>; path = [*] or .member steps)`,
        actual: seg.raw,
        expected: "<name><path> <rel> <number>",
        suggestion:
          "loop-carried bounds: @nudo:invariant dp[*][*] >= 0 — scalar: @nudo:invariant last >= 1",
        fn: name,
        ...pos,
      });
      continue;
    }
    if (!bindable.has(seg.name)) {
      issues.push({
        severity: "warning",
        code: DIAG.invariantInvalid,
        message: `${name}: @nudo:invariant name not bound as a parameter or top-level local (${seg.name})`,
        actual: seg.name,
        expected: surface || "(no params/locals)",
        suggestion: `reference one of: ${surface || "(no params or top-level locals)"}`,
        fn: name,
        ...pos,
      });
      continue;
    }
    specs.push({ name: seg.name, path: seg.path, rel: seg.rel, value: seg.value });
    display.push(seg.display);
  }
  if (specs.length === 0) return undefined;
  return { specs, display };
}

/**
 * 赋值记录去重（Bug 363 收集窗口扩大后的副作用补偿）。
 *
 * 窗口含函数体求值 ⇒ 同一个赋值点会被**多次求值**（模块顶层在每次
 * generalize 的模块求值里重跑；被调函数在每个调用点的求值里重跑）⇒ 同一处
 * 赋值会在报告里出现多条同文诊断。
 *
 * 去重键 =（点位 + prev/next 值）：同点**同值**的重复求值折叠成一条；
 * **不同值**（同一处赋值在不同调用点取到不同实参）保留 ⇒ 不丢真实漂移。
 */
function dedupeAssignRecords(records: AbsAssignRecord[]): AbsAssignRecord[] {
  const seen = new Set<string>();
  const out: AbsAssignRecord[] = [];
  for (const r of records) {
    const key = JSON.stringify([
      r.name,
      r.line ?? "",
      r.column ?? "",
      r.conditional ? "1" : "0",
      assignValueKey(r.prev),
      assignValueKey(r.next),
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * 赋值记录的 prev/next 值键（Abs → formatAbs；裸宿主值 → 类型标记）。
 *
 * S1 语义约定：eval 通道的 prev/next 是**原始运行时值**（Abs 或裸宿主值）
 * ⇒ 这里自己过 Abs 闸（口径同 exec/run.ts 的 isAbsVal：`shape` + `conf`）。
 */
function assignValueKey(v: unknown): string {
  if (v === undefined) return "-";
  if (v === null) return "null";
  if (typeof v !== "object") return `host:${typeof v}:${String(v)}`;
  const o = v as { shape?: { k?: string }; conf?: string };
  if (!("shape" in o) || !("conf" in o)) return `host:${typeof v}`;
  try {
    return formatAbs(v as Abs);
  } catch {
    return `abs:${o.shape?.k ?? "?"}:${o.conf ?? "?"}`;
  }
}

/** opaque-result 原始 hint：用调用点 / 指令证据钉住结果面 */
const OPAQUE_EVIDENCE_HINT = "add @nudo:case or a call site";
/**
 * opaque-result env 分流 hint（DX）：文件 import/require 了内置模块且无任何
 * env 生效时，unknown 的第一嫌疑是原生模块缺运行时环境声明。may/declare
 * 口径——env 覆盖不完整时 unknown 未必消除，不做过诺。
 */
const OPAQUE_ENV_HINT =
  "declare the runtime env to type native modules: '/// @nudo:env node' (or web/es) — see guides/env-harvest.md";

/**
 * 裸说明符是否指向 Node 内置模块：`node:` 前缀剥掉后按首段判（覆盖
 * fs/promises、node:path/win32 等子路径形态）。isBuiltin 名单是
 * @nudojs/env 模块面（fs/path/os…）的可得超集，不在此硬编码。
 */
function isBuiltinModuleSpec(spec: string): boolean {
  if (spec.startsWith(".") || spec.startsWith("/")) return false;
  const base = (spec.startsWith("node:") ? spec.slice("node:".length) : spec).split("/")[0]!;
  return base.length > 0 && isBuiltin(base);
}

function checkSourceInner(
  filePath: string,
  source: string,
  file: ReturnType<typeof parse>,
  phi: Phi,
  opts: CheckOptions,
  issues: CheckIssue[],
  signatures: NudoSig[],
  names: string[],
  truncated: Map<string, Set<AbsTruncationReason>>,
  identityOpts: CheckOptions = opts,
  depsFp?: LoadDepsFingerprint,
  sidecarFp?: string,
): CheckReport {
  // 整文件一次判定，避免 per-function includes 全文扫
  // 指令住注释：字符串里的 `@nudo:contract` 不是契约来源
  const hasRefineDirective = stripStringsKeepComments(source).includes("@nudo:contract");
  // L2：模块边界入口表（export / default / CJS exports）— 只执法这些函数；
  // ambient 侧车同名绑定与入口表同源（localNamedExports），复用同一次 parse
  const entryNames = localNamedExports(source);
  const exportedNames = sidecarFp !== undefined ? entryNames : undefined;
  const entryThrowsMode = opts.entryThrows ?? "error";
  const ignoreThrows = opts.ignoreThrows;
  // opaque-result hint 分流（DX）：文件 import/require 了内置模块，且无任何
  // env 生效（文件 /// @nudo:env 指令与 inject envGlobals 均空——项目级
  // package.json#nudo.env 由 host 折进 envGlobals）→ hint 指向 env 声明。
  // 整文件判一次，逐函数消费；其余场景维持原始 hint。
  const opaqueEnvHint =
    Object.keys(opts.inject?.envGlobals ?? {}).length === 0 &&
    extractFileEnvNames(source).length === 0 &&
    extractAllLoadSpecs(source).some(isBuiltinModuleSpec);
  // T10a：generated 事实快照的 drift 候选（每函数级，统一在拿到 varAbs 后判定）
  const driftCandidates: DriftCandidate[] = [];
  // 返回后置：符号返回（body  widen）之外，eval 执行态调用点 result 也要对账
  // （循环累加等 body 面常被 widen 成 number，调用点 $arr 具体元组却能精确）
  const returnContracts = new Map<
    string,
    { display: string; constraint: NudoConstraint; source: ReturnContractSource }
  >();
  /** 已对 return 后置报过违例的函数——调用点对账跳过，避免同文双计 */
  const returnViolated = new Set<string>();
  // generalize L0 用调用方原始 loadModule 身份；opts 可能是 per-call I/O wrapper
  const refineLoad = identityOpts.loadModule ?? opts.loadModule;
  const refineFrom = identityOpts.fromFile ?? opts.fromFile ?? filePath;
  // autoBind（package.json#nudo.contract）统一透传：effectiveInterface /
  // generalize L0 / scan 执法 / case 对账同一开关口径
  const autoBind = opts.autoBind;
  const projectDir = opts.projectDir;
  // effectiveInterface 文件内 memo：localNamedExports 走 errorRecovery 解析
  // 不进 parse LRU，逐函数重跑会 O(exports × reparse)
  const eiCache = new Map<string, EffectiveInterface | undefined>();
  const effectiveInterfaceCached = (
    fnName: string,
  ): EffectiveInterface | undefined => {
    const key = `${fnName}\0${autoBind === false ? "0" : "1"}`;
    if (eiCache.has(key)) return eiCache.get(key);
    const eff = effectiveInterface(source, fnName, {
      loadModule: refineLoad,
      fromFile: refineFrom,
      ...(autoBind !== undefined ? { autoBind } : {}),
      ...(projectDir !== undefined ? { projectDir } : {}),
    });
    eiCache.set(key, eff);
    return eff;
  };
  // Bug 363：赋值记录收集器的**作用域窗口**必须包住**函数体求值**。
  // 旧窗口只包模块顶层求值，而函数体在 generalize（下面的函数循环里）就求过
  // 一遍 ⇒ 函数体内的 $assignRecord 全部落空 ⇒ nudo:assign-mismatch 只覆盖
  // 顶层（真实代码里赋值的主要发生地恰恰是函数体 ⇒ 假绿）。
  // 窗口 = 函数循环（generalize 的函数体求值）+ 其后的顶层求值段。
  // 窗口扩大的副作用（同一赋值点被多次求值）由 dedupeAssignRecords 折叠。
  const records: AbsAssignRecord[] = [];
  const prevAssign = setEvalAssignCollector((r) => records.push(r));
  for (const name of names) {
    // #152：@nudo:assume 校验 + 入口前提种子（无 assume → undefined，零行为变化）
    const assumePhi = assumePremisesPhiOf(name, source, file, issues);
    // #176：@nudo:invariant 校验 + 循环界种子（同上零行为变化）
    const inv = invariantSpecsOf(name, source, file, issues);
    // #367：引理消费记账——本函数的求值前清账（上一函数的消费不得串台）
    resetAssumeConsumed();
    // 目标函数入口求值（generalize 内部 invoke / L2）动态域内喂独立槽
    // （assume → 引理 phi；invariant → 循环 join/宽化位消费的 specs）
    const runSeeded = <T>(body: () => T): T => {
      if (assumePhi === undefined && inv === undefined) return body();
      return withAssumePremises(assumePhi?.phi ?? pTrue, () =>
        withInvariantSpecs(inv?.specs ?? [], body));
    };
    // @nudo:skip [returnsExpr]：不评估 body（host 传解析结果）。
    // 声明了返回类型 → 按声明上屏；未声明 → any（开发者主动退出推断，不是引擎债）。
    // L1 调用点义务由文件级 scan 照常执行；L2 入口 may-throw 不评估。
    if (opts.skips?.has(name)) {
      const declared = opts.skips.get(name) ?? null;
      const meta = extractFn(source, name, file);
      const params = meta?.params ?? [];
      const retAbs = declared ?? anyAbs;
      const isEntryFn =
        entryNames.has(name) ||
        name === "default" ||
        (entryNames.has("default") && isDefaultExportName(source, name));
      // 参数位仍按手写契约展示（skip 只停止 body 求值，不解除参数义务）
      const eff = effectiveInterfaceCached(name);
      const contractParam = new Map<string, Abs>();
      if (eff) {
        for (const p of eff.params) {
          contractParam.set(p.param, constraintToEntryAbs(p.constraint, p.param));
        }
      }
      signatures.push({
        name,
        params,
        paramTypes: params.map((p) => {
          const a = contractParam.get(p);
          return a ? formatShape(a) : "any";
        }),
        abs: retAbs,
        display: formatAbs(retAbs),
        detail: formatAbsMultiline(retAbs, name),
        conf: retAbs.conf,
        ...(isEntryFn ? { entry: true } : {}),
      });
      // 返回后置照常执法：声明了返回类型就对着契约查（未声明 = any → 不猜）
      if (
        declared &&
        eff &&
        eff.source === "handwritten" &&
        eff.returns &&
        !eff.conflict?.returns
      ) {
        const named = extractRefineReturnFromSource(source, name, {
          loadModule: refineLoad,
          fromFile: refineFrom,
        });
        const display = named?.name ?? formatConstraint(eff.returns.constraint);
        // #378：约束来源（源码指令 vs 侧车 fn() 返回槽）——文案要反映真实来源
        const contractSource: ReturnContractSource = named ? "directive" : "sidecar";
        returnContracts.set(name, {
          display,
          constraint: eff.returns.constraint,
          source: contractSource,
        });
        const retIssues = checkReturnConstraint(
          name,
          display,
          eff.returns.constraint,
          declared,
          {
            // #369 / #372：issue 构造处带函数声明位置
            loc: findFnLoc(file, name),
            source: contractSource,
            // Bug 1094：返回点的路径前提 Φ（用户引理前提）——skip 分支同样
            // 透传（函数级公理在 skip 面也成立；证明通道按「同项 ∧ 蕴含」
            // 口径消费 ⇒ 不会凭空制造确定违约）。assumeDisplay 一并带上 ⇒
            // Φ 被消费时归因（nudo:assume-relied）仍然可见（不得静默消费）。
            phi: assumePhi?.phi,
            phiPremises: assumePhi?.premises,
            assumeDisplay: assumePhi?.display,
          },
        );
        if (retIssues.some((i) => i.severity === "error")) returnViolated.add(name);
        issues.push(...retIssues);
      }
      continue;
    }
    // assume 前提喂独立槽：generalize 内部 callTranspiledExportFull 的入口
    // invoke 动态域内 div 等关系折叠消费（currentAssumePremises）
    const g = runSeeded(() =>
      generalizeFromAst(name, source, {
        file,
        refine: {
          loadModule: refineLoad,
          fromFile: refineFrom,
          ...(autoBind !== undefined ? { autoBind } : {}),
          ...(projectDir !== undefined ? { projectDir } : {}),
        },
        depsFp,
        sidecarFp,
        modules: opts.modules,
        ...(opts.inject ? { inject: opts.inject } : {}),
      }),
    );
    if (!g) {
      const isEntryCandidate =
        entryNames.has(name) ||
        name === "default" ||
        (entryNames.has("default") && isDefaultExportName(source, name));
      if (isEntryCandidate && entryThrowsMode !== "off") {
        const paramCount = estimateEntryParamCount(source, name, file);
        const anyParams = Array.from({ length: paramCount }, () =>
          abs({ k: "any" }, undefined, undefined, "path"),
        );
        const synthetic = {
          params: Array.from({ length: paramCount }, (_, i) => `_p${i}`),
          typeParams: anyParams.map((value) => ({ value })),
          symbolic: abs({ k: "any" }, undefined, undefined, "path"),
          formals: [],
        } as unknown as PolyFn;
        const effects = collectEntryMayThrows(source, name, synthetic, file, phi, opts);
        const throwsDisplayFallback = formatThrowsAbs(mayThrowEffectsToAbs(effects));
        const declared =
          extractDeclaredThrows(source, name) ??
          effectiveInterfaceCached(name)?.throws?.kinds;
        const remaining = filterGateThrows(effects, declared, ignoreThrows);
        const gateDisplay = formatThrowsAbs(mayThrowEffectsToAbs(remaining));
        if (gateDisplay && remaining.length > 0) {
          const first = remaining[0]!;
          const loc = findFnLoc(file, name);
          issues.push({
            severity: entryThrowsMode === "warning" ? "warning" : "error",
            code: DIAG.entryMayThrow,
            message: `${name} (export): may throw ${gateDisplay}`,
            actual: `${name}(…)    throws ${gateDisplay}`,
            expected: "entry total, or @nudo:throws / try-catch",
            suggestion: first.cause
              ? `${first.cause} → ${first.kind === "ReferenceError" ? "re-export `export { x } from` 不是局部绑定——改 `import { x }` / @nudo:throws ReferenceError" : `@nudo:throws ${first.kind}  |  sidecar: fn({ … }): shape({ <body-read fields> })  |  refine / guard / try-catch`}`
              : first.kind === "ReferenceError"
                ? "re-export `export { x } from` 不是局部绑定——改 `import { x }` / @nudo:throws ReferenceError"
                : `@nudo:throws ${first.kind}  |  sidecar: fn({ … }): shape({ <body-read fields> })  |  refine / guard / try-catch`,
            fn: name,
            ...(loc.line !== undefined ? { line: loc.line } : {}),
            ...(loc.column !== undefined ? { column: loc.column } : {}),
          });
        }
        signatures.push({
          name,
          params: synthetic.params,
          paramTypes: synthetic.params.map(() => "any"),
          abs: synthetic.symbolic,
          display: throwsDisplayFallback
            ? `any throws ${throwsDisplayFallback}`
            : "any",
          detail: `${name}: any`,
          conf: "path",
          ...(throwsDisplayFallback ? { throws: throwsDisplayFallback } : {}),
          entry: true,
        });
        continue;
      }
      issues.push({
        severity: "warning",
        code: DIAG.noSignature,
        message: `${name}: could not generalize a symbolic Abs`,
        suggestion: "add @nudo:case or make the body algebraically evaluable",
        fn: name,
      });
      continue;
    }
    const isEntry =
      entryNames.has(name) ||
      name === "default" ||
      (entryNames.has("default") && isDefaultExportName(source, name)) ||
      (name.includes(".") && entryNames.has(name));
    // L2 入口 throws：any/nullish 危险操作的效果（design-cli-semantics §3）
    let throwsDisplay: string | undefined;
    if (isEntry && entryThrowsMode !== "off") {
      const effects = runSeeded(() => collectEntryMayThrows(source, name, g, file, phi, opts));
      // 展示层始终上屏未过滤 throws（门禁过滤 ≠ 藏事实）
      throwsDisplay = formatThrowsAbs(mayThrowEffectsToAbs(effects));
      const declared =
        extractDeclaredThrows(source, name) ??
        effectiveInterfaceCached(name)?.throws?.kinds;
      const remaining = filterGateThrows(effects, declared, ignoreThrows);
      const gateDisplay = formatThrowsAbs(mayThrowEffectsToAbs(remaining));
      if (gateDisplay && remaining.length > 0) {
        const first = remaining[0]!;
        const loc = findFnLoc(file, name);
        issues.push({
          severity: entryThrowsMode === "warning" ? "warning" : "error",
          code: DIAG.entryMayThrow,
          message: `${name} (export): may throw ${gateDisplay}`,
          actual: `${formatEntrySigLine(name, g, gateDisplay)}`,
          expected: "entry total, or @nudo:throws / try-catch",
          suggestion: first.cause
            ? `${first.cause} → ${first.kind === "ReferenceError" ? "re-export `export { x } from` 不是局部绑定——改 `import { x }` / @nudo:throws ReferenceError" : `@nudo:throws ${first.kind}  |  sidecar: fn({ … }): shape({ <body-read fields> })  |  refine / guard / try-catch`}`
            : first.kind === "ReferenceError"
              ? "re-export `export { x } from` 不是局部绑定——改 `import { x }` / @nudo:throws ReferenceError"
              : `@nudo:throws ${first.kind}  |  sidecar: fn({ … }): shape({ <body-read fields> })  |  refine / guard / try-catch`,
          fn: name,
          ...(loc.line !== undefined ? { line: loc.line } : {}),
          ...(loc.column !== undefined ? { column: loc.column } : {}),
        });
      }
    } else if (isEntry) {
      // 展示层仍上屏 throws（off 只关执法，不藏事实）
      const effects = runSeeded(() => collectEntryMayThrows(source, name, g, file, phi, opts));
      throwsDisplay = formatThrowsAbs(mayThrowEffectsToAbs(effects));
    }

    // L0 命中时 symbolic 是稳定对象：格式化结果可 WeakMap 复用
    const fmt = formatSigCached(g.symbolic, name);
    // design §2：无约束 = any（缺 value 或真 any）；真 unknown = 引擎债，不得伪装成 any
    const paramTypes = g.typeParams.map((t) => {
      if (!t.value) return "any";
      if (t.value.shape.k === "unknown") return "unknown";
      // 契约面的字面量保形（Bug 348）：`lit(1)` 的字面量只活在 pred 里 ⇒
      // 走 widen 路径永远看不见它（`x: number`）⇒ check 签名面与 dts 面
      // （`x: 1`）与契约面（`x: lit(1)`）三面互相矛盾。
      return formatEntryParamShape(t.value);
    });
    signatures.push({
      name,
      // 解构形参展示 `{ grade, findings }`，不落 `_p0`（#64：契约要上屏）
      params:
        g.formals && g.formals.length > 0
          ? formalParamSignatureNames(g.formals)
          : g.params,
      paramTypes,
      abs: g.symbolic,
      display: throwsDisplay
        ? `${fmt.display} throws ${throwsDisplay}`
        : fmt.display,
      detail: fmt.detail,
      conf: g.symbolic.conf,
      ...(throwsDisplay ? { throws: throwsDisplay } : {}),
      ...(isEntry ? { entry: true } : {}),
    });

    // 真 unknown = 推导失败（design §2 / §5）：返回位或参数位都要报引擎债。
    // **预算截断不是推导失败**：已有 nudo:recursion-truncated / fork-truncated，
    // 不得再叠 nudo:unknown-inference（否则 agent 会去修不存在的引擎债）。
    // **精确 undefined 值不是引擎债**（Bug 22）：undefAbs 是 unknown 形状 +
    // lit(undefined) term——`return undefined` / `void 0` / 缺省 return 都落此，
    // 带 lit term 即有值证据，须排除（与 check-assign/diagnostics/promise/class
    // 四处 `!term` 同口径）。
    const unknownParamIdx = g.typeParams.findIndex(
      // Bug 22/24 同口径：unknown 形状 + lit term（undefAbs / 契约 lit(null)·
      // lit(undefined) 成员）是有值证据，不是引擎债——与 symbolicTrueUnknown
      // 的排除一致。
      (t) =>
        t.value && t.value.shape.k === "unknown" && t.value.term?.op !== "lit",
    );
    const budgetExplained =
      truncated.has(name) ||
      // Bug 389：`conf=opaque` 通常意味着「路径没覆盖」⇒ 已解释；但**因 env
      // 门禁而 opaque**（源码声明了 `@nudo:env` 而那个 env 没解析出全局 ⇒
      // 函数体 fail-closed）不是「已解释」——那正是「推断没成功」，唯一能提示
      // 它的 `nudo:unknown-inference` 不能被吞（否则用户把 env 名写错的那一刻，
      // 唯一的失败信号恰好消失）。
      (g.symbolic?.conf === "opaque" && !g.envGated) ||
      (g.symbolic?.shape?.k === "sum" &&
        g.symbolic.shape.members.every((m) => m.shape.k === "unknown" || m.shape.k === "any"));
    const symbolicTrueUnknown =
      g.symbolic?.shape?.k === "unknown" && g.symbolic.term?.op !== "lit";
    if ((symbolicTrueUnknown || unknownParamIdx >= 0) && !budgetExplained) {
      const where =
        symbolicTrueUnknown
          ? `${name} => unknown`
          : `${name} param ${g.params[unknownParamIdx] ?? `#${unknownParamIdx}`}: unknown`;
      issues.push({
        severity: "warning",
        code: DIAG.unknownInference,
        message: `${name}: signature has true unknown (inference failed)`,
        actual: where,
        expected: "computable Abs (any = unconstrained, unknown = engine debt)",
        // Bug 1062（族 46）：本诊断此前把「`@nudo:replace` 的目标文本没命中」
        // 说成「推断精度不够」⇒ 归因错误 ⇒ 用户只看到 unknown-inference。
        // service 侧已加「点名目标文本」的显式诊断（`nudo:directive-syntax`），
        // 这里补一句归因提示，把「指令没生效」这条可能性点出来。
        suggestion:
          "add @nudo:case / env mock / refine, or confirm the body is algebraically evaluable; " +
          "if you used @nudo:replace, check the target text matches the source",
        fn: name,
      });
    }

    // 有效契约（源码 @nudo:contract/@nudo:contract ∪ 侧车同名手写绑定）：
    // - conflict（常数界交叉矛盾）→ nudo:interface-conflict，fn 级一次
    // - 参数名对不上形参表 → nudo:interface-param-mismatch（C4.5；不再静默跳过）
    // - 返回后置仅 handwritten 执法（generated = 事实快照，drift 另行）
    if (hasRefineDirective || (exportedNames?.has(name) ?? false)) {
      const eff = effectiveInterfaceCached(name);
      if (eff?.source === "handwritten") {
        // C4.1：契约面 = formals（默认参名 / rest 裸名 / 解构顶层绑定名）
        // 形参名对不上形参表 → nudo:interface-param-mismatch（C4.5；不再静默跳过）
        // ——与跨模块桥接路径共用 unmatchedContractParams（Bug 1023 同口径）
        const unknownParams = unmatchedContractParams(eff, g.params, g.formals ?? []);
        if (unknownParams.length > 0) {
          issues.push(
            paramMismatchIssue(name, unknownParams, g.params, g.formals ?? []),
          );
        }
      }
      if (eff?.conflict) {
        // Bug 374：位置 = 出错的 @nudo:contract 指令行（参数位取该参数的那条段；
        // 返回位取 `return` 那条段）；找不到指令则省略位置。
        const contractLocs = contractSegmentLocs(source, name);
        const locOf = (param: string): { line?: number; column?: number } => {
          const hit = contractLocs.find((c) => {
            const head = c.segment.trim().split(/\s+/)[0];
            return head === param;
          });
          return hit?.loc
            ? { line: hit.loc.line, ...(hit.loc.column !== undefined ? { column: hit.loc.column } : {}) }
            : {};
        };
        if (eff.conflict.params.length > 0) {
          issues.push({
            severity: "error",
            code: DIAG.interfaceConflict,
            message: `${name}: handwritten contract conjunction unsatisfiable (${eff.conflict.params.join(", ")})`,
            suggestion: "check whether the source @nudo:contract and the same-name sidecar binding have contradictory constant bounds",
            fn: name,
            ...locOf(eff.conflict.params[0]!),
          });
        }
        if (eff.conflict.returns) {
          issues.push({
            severity: "error",
            code: DIAG.interfaceConflict,
            message: `${name}: handwritten contract conjunction unsatisfiable on the return slot`,
            suggestion:
              "check whether the source @nudo:contract return and the sidecar fn() return constraint are contradictory (the return slot is not enforced when they are)",
            fn: name,
            ...locOf("return"),
          });
        }
      }
      // 返回后置仅 handwritten 执法（generated = 事实快照，drift 另行）；
      // 返回位 conflict（合取不可满足）时跳过——矛盾契约不该误诊为函数体违例
      if (
        eff &&
        eff.source === "handwritten" &&
        eff.returns &&
        !eff.conflict?.returns
      ) {
        // 显示名优先取源码声明名（既有输出契约零改动）；侧车合取无名单 → 组合式显示
        const named = extractRefineReturnFromSource(source, name, {
          loadModule: refineLoad,
          fromFile: refineFrom,
        });
        const display = named?.name ?? formatConstraint(eff.returns.constraint);
        // #378：约束来源（源码指令 vs 侧车 fn() 返回槽）——文案要反映真实来源
        const contractSource: ReturnContractSource = named ? "directive" : "sidecar";
        returnContracts.set(name, {
          display,
          constraint: eff.returns.constraint,
          source: contractSource,
        });
        // #367：本次证明**实际消费过**的引理（记账集 ∩ 本函数声明的合法前提）
        const consumedAssume = assumePhi
          ? new Set(
              assumePhi.display.filter((_, i) =>
                assumeConsumed().includes(assumePhi.premises[i]!),
              ),
            )
          : undefined;
        const retIssues = checkReturnConstraint(
          name,
          display,
          eff.returns.constraint,
          g.symbolic,
          {
            // #369 / #372：issue 构造处带函数声明位置
            loc: findFnLoc(file, name),
            source: contractSource,
            assumeDisplay: assumePhi?.display,
            invariantDisplay: inv?.display,
            consumedAssume,
            // Bug 1094：返回点的**路径前提 Φ** = 用户引理前提
            //（`@nudo:assume` 的前提 Φ）——证明通道的 Φ 侧。
            // 项身份：前提项用**真实形参名**（`termVar(name)`），泛化后的返回
            // 项在形参**有契约**时同样锚在真实名上（`constraintToEntryAbs`）
            // ⇒ 同项判定能对上；无契约时返回项锚在 α 名（A1…）⇒ 对不上 ⇒
            // Φ 侧不生效（保守少证，不假红）。
            phi: assumePhi?.phi,
            phiPremises: assumePhi?.premises,
          },
        );
        if (retIssues.some((i) => i.severity === "error")) returnViolated.add(name);
        issues.push(...retIssues);
      }
      // T10a drift 候选：generated 段是 emit 时的固化快照，与今日重算的
      // 语义差异在 interfaceDriftIssues 统一判定（warning，generated 不执法）
      if (eff && eff.source === "generated") {
        driftCandidates.push({
          fnName: name,
          paramNames: g.params,
          eff,
        });
      }
    }

    // generalize 的 symbolic 已同源求过 body——opaque 判定直接用其 conf
    // （fail-closed：不再重复 analyzeFn；求值失败面由 B 回落观测承担）
    //
    // Bug 389：**因 env 门禁而 opaque** 不报这条 info——门禁的含义是「那个 env
    // 没解析出来，函数体没跑」⇒ 正确信号是 `nudo:unknown-inference`（warning，
    // 「推断失败了」），不是「conf=opaque，加个 @nudo:case 或调用点」（把用户
    // 引向错误方向）。
    if (g.symbolic.conf === "opaque" && !truncated.has(name) && !g.envGated) {
      issues.push({
        severity: "info",
        code: DIAG.opaqueResult,
        message: `${name}(...): conf=opaque (path not covered, or native)`,
        suggestion: opaqueEnvHint ? OPAQUE_ENV_HINT : OPAQUE_EVIDENCE_HINT,
        fn: name,
      });
    }
  }

  for (const [label, reasons] of truncated) {
    // fork/递归截断 = **预算观测**（A2），不是质量失败——降为 info，避免 agent 绿后空转
    if (label === FORK_TRUNCATION_LABEL) {
      issues.push({
        severity: "info",
        code: DIAG.forkTruncated,
        message: `Branch expansion was truncated (fork budget); affected results widened to unknown#opaque (budget)`,
        suggestion:
          "optional: raise nudo.analysis.maxForks, or @nudo:budget forks=… on the function — non-blocking",
      });
      continue;
    }
    // promise 微队列溢出 / drain 抛错：不是递归——专用文案
    if (label === PROMISE_MICRO_OVERFLOW_LABEL) {
      issues.push({
        severity: "info",
        code: DIAG.promiseMicroTruncated,
        message: `Promise microtask queue hit its hard cap; further then/catch callbacks were dropped (results stay fail-closed)`,
        suggestion: "optional: reduce top-level Promise.then fan-out — non-blocking",
      });
      continue;
    }
    if (label === PROMISE_MICRO_ERROR_LABEL) {
      issues.push({
        severity: "info",
        code: DIAG.promiseMicroError,
        message: `A promise microtask threw while draining; the error was recorded and did not rewrite the synchronous return value`,
        suggestion: "optional: inspect the then/catch callback for a throw path — non-blocking",
      });
      continue;
    }
    // Math 原生折叠抛错（宿主篡改/分叉的 Math.*）：拓宽不是递归——专用文案
    if (label === MATH_FOLD_ERROR_LABEL) {
      issues.push({
        severity: "info",
        code: DIAG.mathFoldError,
        message: `A Math native fold threw during analysis (host-tampered or divergent Math.*); the result was widened to number`,
        suggestion:
          "optional: keep Math.* builtins unmodified in analyzed code, or mock them with @nudo:mock — non-blocking",
      });
      continue;
    }
    // 宿主副作用未执行（网络/定时器）：不是递归、不是预算——专用文案，
    // 避免「Recursive evaluation of 'fetch'」误导
    if (label.startsWith(HOST_EFFECT_LABEL_PREFIX)) {
      const hostName = label.slice(HOST_EFFECT_LABEL_PREFIX.length);
      issues.push({
        severity: "info",
        code: DIAG.hostEffectBlocked,
        message: `Host function '${hostName}' is not executed during analysis (network/timer side effect); result widened to unknown#opaque`,
        suggestion:
          "optional: mock it with @nudo:mock / @nudo:env, or pass the value in from a call site",
        fn: hostName,
      });
      continue;
    }
    // 循环迭代预算（两段 maxIters/MAX_CONCRETE_LOOP_ITERS 仍未终止）：不是
    // 递归、不是调用预算——@nudo:budget calls=/depth= 抬不动（#158 后续）
    if (label === LOOP_TRUNCATION_LABEL) {
      issues.push({
        severity: "info",
        code: DIAG.loopTruncated,
        message: `A loop did not terminate within its iteration budget (abstract unroll cap reached and the exit condition stayed concrete-true); affected loop state was widened (bounded, not exact)`,
        suggestion:
          "optional: restructure so the exit condition becomes abstract (data-dependent) within a few iterations, or pin the result with @nudo:case / @nudo:contract — non-blocking",
      });
      continue;
    }
    // 调用截断归因（#158）：全是 cycle → 「调用环」文案（抬预算无效）；
    // 否则按 depth/calls 指明可抬的预算维。到达此处的都是调用截断标签
    // （fork/promise/math/host-effect/loop 已分流），reasons 非空。
    const allCycle = reasons.size > 0 && [...reasons].every((r) => r === "cycle");
    const depth = reasons.has("depth");
    const calls = reasons.has("calls");
    issues.push({
      severity: "info",
      code: DIAG.recursionTruncated,
      message: allCycle
        ? `Recursive evaluation of '${label}' hit a call cycle (same abstract arguments already on the stack); result widened to unknown#opaque (cycle — budget cannot lift this)`
        : `Recursive evaluation of '${label}' was truncated (${depth && calls ? "depth/size budget" : depth ? "call-depth budget" : calls ? "total-calls budget" : "depth/size budget"}); result widened to unknown#opaque (budget — not inference debt)`,
      suggestion: allCycle
        ? "a call cycle is not a budget: make the recursion arguments vary per level, narrow the base case, or declare @nudo:contract — raising @nudo:budget will not change this"
        : depth && !calls
          ? "raise the function budget with @nudo:budget depth=… (or narrow the recursion base case / declare @nudo:contract return)"
          : calls && !depth
            ? "raise the function budget with @nudo:budget calls=… (or narrow the recursion base case / declare @nudo:contract return)"
            : "raise the function budget with @nudo:budget calls=… depth=… (or narrow the recursion base case / declare @nudo:contract return)",
      reason: allCycle ? "cycle" : depth && calls ? "budget" : depth ? "depth" : calls ? "calls" : "budget",
      fn: label,
    });
  }

  // 一次执行态求值：结构赋值记录 + 顶层绑定表（scanLiteralCalls 实参
  // 解析用）+ 执行态调用记录（T10a drift 的今日域证据，与 emit 同源）。
  // evaluator 优先（迁移件 2：$recordBinding/$assignRecord 插桩 + $callNamed
  // EvalCallRecord）；失败 fail-closed。
  // Bug 363：赋值记录收集器已在函数循环**之前**安装（窗口含函数体求值）——
  // 这里不再二次安装，只保留调用记录收集器（drift 今日域证据口径不变）。
  const varAbs = new Map<string, Abs>();
  const callRecords: AbsCallRecord[] = [];
  // fail-closed：记录通道唯一源 = B（EvalCallRecord/$assignRecord）
  const bCalls: EvalCallRecord[] = [];
  const prevCall = setEvalCallCollector((r) => bCalls.push(r));
  let evalBindings: Map<string, unknown> | undefined;
  const evalAnalyze = evalAnalyzeOpts(opts);
  try {
    const evalRun = tryRunTranspiled(source, evalAnalyze);
    evalBindings = evalRun ? bindingsOf(evalRun) : undefined;
    if (evalBindings) {
      for (const [k, v] of evalBindings) {
        if (v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object)) {
          varAbs.set(k, v as Abs);
        }
      }
      callRecords.push(
        ...bCalls.map((r) => ({
          fnName: r.fnName,
          args: r.args,
          result: r.result,
          callLoc: r.callLoc,
        })),
      );
    }
  } catch {
    /* B 失败 fail-closed（无 Abs 兜底） */
  } finally {
    setEvalAssignCollector(prevAssign);
    setEvalCallCollector(prevCall);
  }
  // fail-closed：B 绑定表缺失（eval-incapable 文件）→ 无绑定表；
  // 「部分覆盖」改为「显式无信息」，与 unknown=引擎债 原则一致
  void evalBindings;

  const callIssues = canSkipLiteralCallScan(source, file)
    ? []
    : scanLiteralCalls(source, names, phi, {
        loadModule: opts.loadModule,
        // 与 generalize / 返回后置同一 fromFile 口径：ambient 侧车按真实
        // 路径解析（opts.fromFile），filePath 仅是报告标签
        fromFile: refineFrom,
        file,
        varAbs,
        bCalls,
        ...(autoBind !== undefined ? { autoBind } : {}),
        ...(projectDir !== undefined ? { projectDir } : {}),
      });
  issues.push(...callIssues);

  // 调用点 result 对 return 后置再对账（eval 执行态精确值 ⊭ 声明）。
  // 符号返回常被循环/抽象参数 widen——这里补上「有具体调用点」时的确定违例。
  // 入口符号面已报过的函数不再按调用点重复报（同码同文双计）。
  if (returnContracts.size > 0 && callRecords.length > 0) {
    const seenRet = new Set<string>();
    for (const rec of callRecords) {
      const rc = returnContracts.get(rec.fnName);
      if (!rc) continue;
      if (returnViolated.has(rec.fnName)) continue;
      const k = `${rec.fnName}\0${formatAbs(rec.result)}`;
      if (seenRet.has(k)) continue;
      seenRet.add(k);
      const retIssues = checkReturnConstraint(
        rec.fnName,
        rc.display,
        rc.constraint,
        rec.result,
        {
          // #369 / #372：issue 构造处带函数声明位置（被违约函数的声明处）
          loc: findFnLoc(file, rec.fnName),
          // #378：约束来源随 returnContracts 走（源码指令 vs 侧车 fn() 返回槽）
          source: rc.source,
        },
      );
      if (retIssues.some((i) => i.severity === "error")) returnViolated.add(rec.fnName);
      issues.push(...retIssues);
    }
  }

  // T10a：固化生成段 drift——generated 快照 ≠ 今日重算 → warning
  // （在执行态调用记录就绪后跑：今日域证据与 emit 的 callsite case 同源）
  if (driftCandidates.length > 0) {
    // Bug 366：`--from` 提供的**跨文件**调用点证据进入同一条 drift 判定通道。
    // 此前「今日域」证据只来自 checkSource 评估**被检查文件自身**时产生的
    // AbsCallRecord ⇒ 调用点在别的文件里时，生成段永远判不出陈旧（假绿）。
    //
    // 位置口径：跨文件调用点在本文件内**没有位置** ⇒ 去掉其 callLoc（不把
    // 别的文件的行号挂到本文件上）；本文件内的证据在前 ⇒ 有本地调用点时
    // 位置仍指向本文件。
    const driftRecords: AbsCallRecord[] =
      opts.from && opts.from.length > 0
        ? [...callRecords, ...opts.from.map((r) => ({ fnName: r.fnName, args: r.args, result: r.result }))]
        : callRecords;
    issues.push(
      // 返回位今日重算经 B（fail-closed：B 失败/类方法 → undefined = 无证据，
      // 宁缺勿滥不判 drift）——闭包缓存一次 run 避免逐调用点重编译
      ...interfaceDriftIssues(driftCandidates, driftRecords, (() => {
        let driftRun: Record<string, unknown> | undefined;
        let driftInit = false;
        return (fnName, args) => {
          try {
            if (!driftInit) {
              driftRun = tryRunTranspiled(source, evalAnalyze);
              driftInit = true;
            }
            if (!driftRun || !(fnName in driftRun)) return undefined;
            return callTranspiledExportFull(driftRun, fnName, args).result;
          } catch {
            return undefined;
          }
        };
      })()),
    );
  }

  // case 是见证：@nudo:case 实参 ⊄ refine → inconsistency
  issues.push(
    ...scanCaseInconsistency(source, names, {
      loadModule: opts.loadModule,
      fromFile: refineFrom,
      file,
      sidecarPresent: sidecarFp !== undefined,
      ...(autoBind !== undefined ? { autoBind } : {}),
      ...(projectDir !== undefined ? { projectDir } : {}),
      modules: opts.modules,
      ...(opts.inject ? { inject: opts.inject } : {}),
    }),
  );

  // 结构可赋值：赋值语句 prev ⊇ next（Abs leq）
  // S1：判定层异常降级为一条诊断（nudo:internal）而非腰斩整轮门禁
  try {
    issues.push(...structuralAssignIssues(dedupeAssignRecords(records)));
  } catch (err) {
    issues.push({
      severity: "warning",
      code: DIAG.internal,
      message: `assign channel check failed: ${(err as Error).message}`,
      suggestion:
        "this is an internal error; please report it together with the checked source file",
    });
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;

  // 预算块 = 全量 stats（A 计数 + B 计数/截断旗标 + cycle/reasons 归因；
  // #158：B 截断不进块会与 nudo:recursion-truncated 自相矛盾）
  const budget = getAbsCallBudgetStats();
  return {
    file: filePath,
    issues,
    ok: errors === 0,
    signatures,
    summary: { errors, warnings, infos, functions: signatures.length },
    budget: { ...budget },
  };
}

// ---------------------------------------------------------------------------
// L2 入口 may-throw → check-may-throw.ts；签名格式化 → check-signatures.ts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// L1 返回约束对账（声明 returns vs 推断返回 Abs）
// 统一证明通道：assertImplies（Pred 蕴含 + 域隶属 + nullish 显式化）
// 实现见 check-return.ts（族 07 片 S4 抽出：位置面 #369/#372 · 文案面 #378 ·
// 审计归因面 #367）——本文件只负责喂上下文（函数声明位置 / 约束来源 / 引理
// 消费集），判定与文案在抽出的模块里。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// T10a：nudo:interface-drift（固化生成段 ≠ 今日重算，warning）
// 实现见 check-interface-drift.ts；checkSourceInner 收集 DriftCandidate 后
// 统一调用 interfaceDriftIssues。
// ---------------------------------------------------------------------------

