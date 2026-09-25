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

import { parseSource as parse } from "./parse-source.ts";
import {
  setAbsTruncationCollector,
  resetAbsCallBudget,
  getAbsCallBudgetStats,
  FORK_TRUNCATION_LABEL,
} from "./call-budget.ts";
import type { AbsAssignRecord, AbsCallRecord } from "./ast-records.ts";
import { leqAbs } from "./leq.ts";
import {
  extractRefineReturnFromSource,
  extractDeclaredThrows,
  refineDiagCount,
  setRefineDiagCollector,
  takeRefineDiagsSince,
} from "./refine.ts";
import {
  effectiveInterface,
  formatConstraint,
  interfaceDiagCount,
  localNamedExports,
  setInterfaceDiagCollector,
  sidecarClosureFingerprint,
  sidecarPathOf,
  takeInterfaceDiagsSince,
  type EffectiveInterface,
} from "./interface.ts";
import {
  constraintToEntryAbs,
  type NudoConstraint,
  type NudoField,
} from "./constraint.ts";
import { absToConstraint } from "./projection.ts";
import { literalMeetsConstraint } from "./domain-membership.ts";
import { extractFn, generalizeFromAst } from "./generalize.ts";
import { contractParamNameSet } from "./param-surface.ts";
import { getSlot } from "./objects.ts";
import { canSkipLiteralCallScan } from "./fn-fp.ts";
import { stableAnalyzeKeySource } from "./stable-source-key.ts";
import {
  normPath,
  type LoadDepsFingerprint,
} from "./load-deps-fp.ts";
import { anyAbs, litValue } from "./abs.ts";
import type { Abs } from "./abs.ts";
import { abs } from "./abs.ts";
import type { Phi } from "./pred.ts";
import { pTrue } from "./pred.ts";
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
  findFnLoc,
  formatSigCached,
} from "./check-signatures.ts";
import { collectEntryMayThrows, bAnalyzeOpts } from "./check-may-throw.ts";
import { structuralAssignIssues } from "./check-assign.ts";
import { scanCaseInconsistency } from "./check-case-scan.ts";
import type { AbsModuleExports } from "./abs-modules.ts";
import {
  tryRunTranspiled,
  callTranspiledExportFull,
  bindingsOf,
  type RunTranspiledOptions,
} from "./exec/run.ts";
import { setBAssignCollector, setBCallCollector, type BCallRecord } from "./exec/calls.ts";
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

/**
 * check 选项：core 不碰 fs；host 用 loadModule 喂 require 目标源码。
 */
// ---------------------------------------------------------------------------
// 公共入口（CheckOptions / checkSource）
// ---------------------------------------------------------------------------

export type CheckOptions = {
  /** 相对/绝对 require 说明符 → 模块源码；undefined = 解析失败 */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  /** 当前文件路径（供 loadModule 解析相对 spec） */
  fromFile?: string;
  /**
   * 侧车 ambient 绑定开关（host 从 package.json#nudo.contract.autoBind
   * 解析后下传；默认 true）。false = check/LSP 执法路径不自动加载侧车
   * （§2.2「整体关闭」承诺覆盖 CI 门禁，不只是打印路径）。
   */
  autoBind?: boolean;
  /**
   * 项目根（host 从 findProjectConfig 下传）：树外侧车不 ambient 绑定。
   * undefined = 不限（node_modules 仍拦）。
   */
  projectDir?: string;
  /**
   * L2 入口 may-throw 执法档（design-cli-semantics §3）。
   * error（默认）| warning | off。仅作用于 export/default/CJS 入口函数。
   */
  entryThrows?: "error" | "warning" | "off";
  /** L2 --ignore-throws：按 throws 类型名过滤；不吞 L1 */
  ignoreThrows?: string[];
  /** 宿主已求值的依赖导出表（specifier → AbsModuleExports）；
   *  B 与解释路径共用——import/require 按表解析（CLI 经
   *  evalAbsModuleGraph 计算后下传） */
  modules?: Record<string, AbsModuleExports | Record<string, unknown>>;
  /**
   * B run 注入包（modules/mocks/envGlobals/replacements/as）——透传
   * runTranspiled（generalize / L2 / 记录通道 / drift 同源）。memo 键按
   * 内容指纹（非对象身份）。
   */
  inject?: RunTranspiledOptions;
  /**
   * `@nudo:skip [returnsExpr]`（host 用 parser 解析后下传）：函数名 → 声明的
   * 返回 Abs（null = 未声明）。命中函数不评估 body：签名按声明返回上屏
   * （无声明 → any，不产生 unknown-inference 噪音）；返回契约仍按声明执法；
   * 入口 may-throw（L2）不评估。调用点参数义务（scan）不受影响。
   */
  skips?: ReadonlyMap<string, Abs | null>;
};

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
  // Per-call loadModule cache: dep fingerprint + scan/refine share one read.
  // Identity for memo keys stays on the caller's raw loadModule — a fresh
  // wrapper each call would make loadModuleId() unique and defeat the memo.
  let callOpts = opts;
  if (opts.loadModule && opts.fromFile) {
    const loadCache = new Map<string, string | undefined>();
    const raw = opts.loadModule;
    const fromFile = opts.fromFile;
    callOpts = {
      ...opts,
      loadModule: (spec, from) => {
        const k = `${from}\0${spec}`;
        if (!loadCache.has(k)) loadCache.set(k, raw(spec, from));
        return loadCache.get(k);
      },
    };
  }

  // 诊断纯缓冲模式：refine/interface 侧车诊断由 checkSource 统一收口进报告
  setRefineDiagCollector(null);
  setInterfaceDiagCollector(null);
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
    useMemo && !depsFp.truncated && !(sidecarFp?.startsWith("trunc:") ?? false);
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

  // 递归截断：与 TypeValue 的 nudo:recursion-truncated 对齐
  const truncated = new Set<string>();
  resetAbsCallBudget();
  const prevTrunc = setAbsTruncationCollector((label) => truncated.add(label));
  try {
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
    if (diagIssues.length > 0) {
      report.issues.push(...diagIssues);
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
    if (memoKey) checkMemoSet(memoKey, report, memoPaths);
    return cloneCheckReport(report);
  } finally {
    setAbsTruncationCollector(prevTrunc);
  }
}

/**
 * refine/interface 侧车诊断 → CheckIssue（全部 error；code+message 去重，
 * 同一失败侧车会在 generalize / 返回后置 / case 对账多处被重复探测）。
 */
// ---------------------------------------------------------------------------
// 门禁编排（sidecar 诊断收集 + checkSourceInner：L0 签名 / L1 契约 / L2 throws）
// ---------------------------------------------------------------------------

function sidecarDiagIssues(
  diags: Array<{ code: string; message: string; file?: string }>,
): CheckIssue[] {
  const seen = new Set<string>();
  const out: CheckIssue[] = [];
  for (const d of diags) {
    const k = `${d.code}\0${d.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ severity: "error", code: d.code, message: d.message });
  }
  return out;
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
  truncated: Set<string>,
  identityOpts: CheckOptions = opts,
  depsFp?: LoadDepsFingerprint,
  sidecarFp?: string,
): CheckReport {
  // 整文件一次判定，避免 per-function includes 全文扫
  const hasRefineDirective =
    source.includes("@nudo:contract") || source.includes("@nudo:contract");
  // ambient 侧车存在时预取本地导出表（一次 parse）：侧车同名绑定只落本地 named export
  const exportedNames =
    sidecarFp !== undefined ? localNamedExports(source) : undefined;
  // L2：模块边界入口表（export / default / CJS exports）— 只执法这些函数
  const entryNames = localNamedExports(source);
  const entryThrowsMode = opts.entryThrows ?? "error";
  const ignoreThrows = opts.ignoreThrows;
  // T10a：generated 事实快照的 drift 候选（每函数级，统一在拿到 varAbs 后判定）
  const driftCandidates: DriftCandidate[] = [];
  // 返回后置：符号返回（body  widen）之外，B 执行态调用点 result 也要对账
  // （循环累加等 body 面常被 widen 成 number，调用点 $arr 具体元组却能精确）
  const returnContracts = new Map<string, { display: string; constraint: NudoConstraint }>();
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
  for (const name of names) {
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
        returnContracts.set(name, { display, constraint: eff.returns.constraint });
        const retIssues = checkReturnConstraint(
          name,
          display,
          eff.returns.constraint,
          declared,
        );
        if (retIssues.length > 0) returnViolated.add(name);
        issues.push(...retIssues);
      }
      continue;
    }
    const g = generalizeFromAst(name, source, {
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
    });
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
            code: "nudo:entry-may-throw",
            message: `${name} (export): may throw ${gateDisplay}`,
            actual: `${name}(…)    throws ${gateDisplay}`,
            expected: "entry total, or @nudo:throws / try-catch",
            suggestion: first.cause
              ? `${first.cause} → ${first.kind === "ReferenceError" ? "re-export `export { x } from` 不是局部绑定——改 `import { x }` / @nudo:throws ReferenceError" : `@nudo:throws ${first.kind} / refine / guard / try-catch`}`
              : first.kind === "ReferenceError"
                ? "re-export `export { x } from` 不是局部绑定——改 `import { x }` / @nudo:throws ReferenceError"
                : `@nudo:throws ${first.kind} / refine / guard / try-catch`,
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
        code: "nudo:no-signature",
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
      const effects = collectEntryMayThrows(source, name, g, file, phi, opts);
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
          code: "nudo:entry-may-throw",
          message: `${name} (export): may throw ${gateDisplay}`,
          actual: `${formatEntrySigLine(name, g, gateDisplay)}`,
          expected: "entry total, or @nudo:throws / try-catch",
          suggestion: first.cause
            ? `${first.cause} → ${first.kind === "ReferenceError" ? "re-export `export { x } from` 不是局部绑定——改 `import { x }` / @nudo:throws ReferenceError" : `@nudo:throws ${first.kind} / refine / guard / try-catch`}`
            : first.kind === "ReferenceError"
              ? "re-export `export { x } from` 不是局部绑定——改 `import { x }` / @nudo:throws ReferenceError"
              : `@nudo:throws ${first.kind} / refine / guard / try-catch`,
          fn: name,
          ...(loc.line !== undefined ? { line: loc.line } : {}),
          ...(loc.column !== undefined ? { column: loc.column } : {}),
        });
      }
    } else if (isEntry) {
      // 展示层仍上屏 throws（off 只关执法，不藏事实）
      const effects = collectEntryMayThrows(source, name, g, file, phi, opts);
      throwsDisplay = formatThrowsAbs(mayThrowEffectsToAbs(effects));
    }

    // L0 命中时 symbolic 是稳定对象：格式化结果可 WeakMap 复用
    const fmt = formatSigCached(g.symbolic, name);
    // design §2：无约束 = any（缺 value 或真 any）；真 unknown = 引擎债，不得伪装成 any
    const paramTypes = g.typeParams.map((t) => {
      if (!t.value) return "any";
      if (t.value.shape.k === "unknown") return "unknown";
      return formatShape(t.value);
    });
    signatures.push({
      name,
      params: g.params,
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
    const unknownParamIdx = g.typeParams.findIndex(
      (t) => t.value && t.value.shape.k === "unknown",
    );
    const budgetExplained =
      truncated.has(name) ||
      g.symbolic?.conf === "opaque" ||
      (g.symbolic?.shape?.k === "sum" &&
        g.symbolic.shape.members.every((m) => m.shape.k === "unknown" || m.shape.k === "any"));
    if ((g.symbolic?.shape?.k === "unknown" || unknownParamIdx >= 0) && !budgetExplained) {
      const where =
        g.symbolic?.shape?.k === "unknown"
          ? `${name} => unknown`
          : `${name} param ${g.params[unknownParamIdx] ?? `#${unknownParamIdx}`}: unknown`;
      issues.push({
        severity: "warning",
        code: "nudo:unknown-inference",
        message: `${name}: signature has true unknown (inference failed)`,
        actual: where,
        expected: "computable Abs (any = unconstrained, unknown = engine debt)",
        suggestion: "add @nudo:case / env mock / refine, or confirm the body is algebraically evaluable",
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
        const contractNames = contractParamNameSet(g.formals ?? []);
        const formalDisplay = new Set(g.params);
        const conflictNames = new Set(eff.conflict?.params ?? []);
        const unknownParams = eff.params
          .map((p) => p.param)
          .filter(
            (p) =>
              p &&
              !formalDisplay.has(p) &&
              !contractNames.has(p) &&
              !conflictNames.has(p),
          );
        if (unknownParams.length > 0) {
          const surface = [...contractNames]
            .filter((n) => !n.startsWith("_p") && n !== "_")
            .join(", ");
          issues.push({
            severity: "error",
            code: "nudo:interface-param-mismatch",
            message: `${name}: contract parameter name(s) not in the formal parameter list (${unknownParams.join(", ")})`,
            actual: unknownParams.join(", "),
            expected: surface || g.params.join(", ") || "(no params)",
            suggestion: `rename the @nudo:contract / sidecar binding parameter to one of: ${
              surface || g.params.join(", ") || "(function has no params)"
            }`,
            fn: name,
          });
        }
      }
      if (eff?.conflict) {
        if (eff.conflict.params.length > 0) {
          issues.push({
            severity: "error",
            code: "nudo:interface-conflict",
            message: `${name}: handwritten contract conjunction unsatisfiable (${eff.conflict.params.join(", ")})`,
            suggestion: "check whether the source @nudo:contract and the same-name sidecar binding have contradictory constant bounds",
            fn: name,
          });
        }
        if (eff.conflict.returns) {
          issues.push({
            severity: "error",
            code: "nudo:interface-conflict",
            message: `${name}: handwritten contract conjunction unsatisfiable on the return slot`,
            suggestion:
              "check whether the source @nudo:contract return and the sidecar fn() return constraint are contradictory (the return slot is not enforced when they are)",
            fn: name,
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
        returnContracts.set(name, { display, constraint: eff.returns.constraint });
        const retIssues = checkReturnConstraint(
          name,
          display,
          eff.returns.constraint,
          g.symbolic,
        );
        if (retIssues.length > 0) returnViolated.add(name);
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
    if (g.symbolic.conf === "opaque" && !truncated.has(name)) {
      issues.push({
        severity: "info",
        code: "nudo:opaque-result",
        message: `${name}(...): conf=opaque (path not covered, or native)`,
        suggestion: "add @nudo:case or a call site",
        fn: name,
      });
    }
  }

  for (const label of truncated) {
    // fork/递归截断 = **预算观测**（A2），不是质量失败——降为 info，避免 agent 绿后空转
    if (label === FORK_TRUNCATION_LABEL) {
      issues.push({
        severity: "info",
        code: "nudo:fork-truncated",
        message: `Branch expansion was truncated (fork budget); affected results widened to unknown#opaque (budget)`,
        suggestion:
          "optional: simplify branching or raise nudo.analysis.maxForks — non-blocking",
      });
      continue;
    }
    issues.push({
      severity: "info",
      code: "nudo:recursion-truncated",
      message: `Recursive evaluation of '${label}' was truncated (depth/size budget); result widened to unknown#opaque (budget — not inference debt)`,
      suggestion: "narrow the recursion base case or declare an explicit @nudo:contract return contract",
      fn: label,
    });
  }

  // 一次执行态求值：结构赋值记录 + 顶层绑定表（scanLiteralCalls 实参
  // 解析用）+ 执行态调用记录（T10a drift 的今日域证据，与 emit 同源）。
  // B-path 优先（迁移件 2：$recordBinding/$assignRecord 插桩 + $callNamed
  // BCallRecord）；失败 fail-closed。
  const records: AbsAssignRecord[] = [];
  const varAbs = new Map<string, Abs>();
  const callRecords: AbsCallRecord[] = [];
  // fail-closed：记录通道唯一源 = B（BCallRecord/$assignRecord）
  const bCalls: BCallRecord[] = [];
  const prevAssign = setBAssignCollector((r) => records.push(r));
  const prevCall = setBCallCollector((r) => bCalls.push(r));
  let bBindings: Map<string, unknown> | undefined;
  const bAnalyze = bAnalyzeOpts(opts);
  try {
    const bRun = tryRunTranspiled(source, bAnalyze);
    bBindings = bRun ? bindingsOf(bRun) : undefined;
    if (bBindings) {
      for (const [k, v] of bBindings) {
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
    setBAssignCollector(prevAssign);
    setBCallCollector(prevCall);
  }
  // fail-closed：B 绑定表缺失（B-incapable 文件）→ 无绑定表（旧 ast-eval
  // 兜底已删——「部分覆盖」改为「显式无信息」，与 unknown=引擎债 原则一致）
  void bBindings;

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

  // 调用点 result 对 return 后置再对账（B 执行态精确值 ⊭ 声明）。
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
      );
      if (retIssues.length > 0) returnViolated.add(rec.fnName);
      issues.push(...retIssues);
    }
  }

  // T10a：固化生成段 drift——generated 快照 ≠ 今日重算 → warning
  // （在执行态调用记录就绪后跑：今日域证据与 emit 的 callsite case 同源）
  if (driftCandidates.length > 0) {
    issues.push(
      // 返回位今日重算经 B（fail-closed：B 失败/类方法 → undefined = 无证据，
      // 宁缺勿滥不判 drift）——闭包缓存一次 run 避免逐调用点重编译
      ...interfaceDriftIssues(driftCandidates, callRecords, (() => {
        let driftRun: Record<string, unknown> | undefined;
        let driftInit = false;
        return (fnName, args) => {
          try {
            if (!driftInit) {
              driftRun = tryRunTranspiled(source, bAnalyze);
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
  issues.push(...structuralAssignIssues(records));

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;

  const budget = getAbsCallBudgetStats();
  return {
    file: filePath,
    issues,
    ok: errors === 0,
    signatures,
    summary: { errors, warnings, infos, functions: signatures.length },
    budget: {
      truncated: budget.truncated,
      callTruncated: budget.callTruncated,
      forkTruncated: budget.forkTruncated,
      calls: budget.calls,
      maxCalls: budget.maxCalls,
      forks: budget.forks,
      maxForks: budget.maxForks,
    },
  };
}

// ---------------------------------------------------------------------------
// L2 入口 may-throw → check-may-throw.ts；签名格式化 → check-signatures.ts
// ---------------------------------------------------------------------------

/**
 * 后置契约：推断返回 Abs ⊭ @nudo:contract return 声明。
 * 只在有确定信息时报（字面量界 / prim 类型 / shape 缺字段）。
 */
// ---------------------------------------------------------------------------
// L1 返回约束对账（声明 returns vs 推断返回 Abs）
// ---------------------------------------------------------------------------

function checkReturnConstraint(
  fnName: string,
  cName: string,
  constraint: NudoConstraint,
  ret: Abs,
): CheckIssue[] {
  const out: CheckIssue[] = [];
  // 无信息不猜
  if (ret.shape.k === "unknown" && !ret.term) return out;
  if (ret.shape.k === "any") return out;

  const push = (actual: string, expected: string, suggestion: string): void => {
    out.push({
      severity: "error",
      code: "nudo:constraint-violated",
      message: `${fnName}: return value ⊭ @nudo:contract return ${cName}`,
      actual,
      expected,
      suggestion,
      fn: fnName,
    });
  };

  // shape 后置
  if (constraint.fields) {
    const slots =
      ret.shape.k === "obj"
        ? (ret.shape as { slots: Record<string, { value: Abs; optional?: boolean }> }).slots
        : undefined;
    if (!slots) {
      if (ret.shape.k !== "never") {
        push(formatAbs(ret), `object shape (${cName})`, `return an object satisfying the ${cName} shape`);
      }
      return out;
    }
    for (const [key, field] of Object.entries(constraint.fields) as Array<
      [string, NudoField]
    >) {
      const slot = getSlot(slots, key);
      if (!slot) {
        if (!field.optional && !field.constraint.isOptional) {
          push(formatAbs(ret), `missing field ${key}`, `add the missing field ${key} to the return value`);
        }
        continue;
      }
      // 字段 prim
      if (field.constraint.prim && slot.value.shape.k === "prim") {
        const actualPrim = (slot.value.shape as { type: string }).type;
        if (actualPrim !== field.constraint.prim) {
          push(
            formatAbs(slot.value),
            `typeof ${key} = "${field.constraint.prim}"`,
            `change the return value's ${key} to ${field.constraint.prim}`,
          );
          continue;
        }
      }
      // 字段数值界
      const lv = litValue(slot.value);
      if (lv !== undefined && typeof lv === "number") {
        for (const p of field.constraint.preds) {
          const flat = p.op === "and" ? p.args : [p];
          for (const atom of flat) {
            if (
              (atom.op === "gt" || atom.op === "ge" || atom.op === "lt" || atom.op === "le") &&
              atom.b.op === "lit" &&
              typeof atom.b.value === "number"
            ) {
              const n = atom.b.value;
              let ok = true;
              if (atom.op === "gt") ok = lv > n;
              if (atom.op === "ge") ok = lv >= n;
              if (atom.op === "lt") ok = lv < n;
              if (atom.op === "le") ok = lv <= n;
              if (!ok) {
                const opSym = { gt: ">", ge: "≥", lt: "<", le: "≤" }[atom.op];
                push(
                  formatAbs(slot.value),
                  `${key} ${opSym} ${n}`,
                  `the return value's ${key} should satisfy ${key} ${opSym} ${n}`,
                );
              }
            }
          }
        }
      }
    }
    return out;
  }

  // 标量后置
  if (constraint.prim && ret.shape.k === "prim") {
    const actualPrim = (ret.shape as { type: string }).type;
    if (actualPrim !== constraint.prim) {
      push(formatAbs(ret), `typeof return = "${constraint.prim}"`, `return ${constraint.prim}`);
      return out;
    }
  }
  const lv = litValue(ret);
  if (lv !== undefined && typeof lv === "number") {
    for (const p of constraint.preds) {
      const flat = p.op === "and" ? p.args : [p];
      for (const atom of flat) {
        if (
          (atom.op === "gt" || atom.op === "ge" || atom.op === "lt" || atom.op === "le") &&
          atom.b.op === "lit" &&
          typeof atom.b.value === "number"
        ) {
          const n = atom.b.value;
          let ok = true;
          if (atom.op === "gt") ok = lv > n;
          if (atom.op === "ge") ok = lv >= n;
          if (atom.op === "lt") ok = lv < n;
          if (atom.op === "le") ok = lv <= n;
          if (!ok) {
            const opSym = { gt: ">", ge: "≥", lt: "<", le: "≤" }[atom.op];
            push(formatAbs(ret), `return ${opSym} ${n}`, `return a value satisfying ${opSym} ${n}`);
          }
        }
      }
    }
  }
  // eq/or/length 域：数值 bounds 分支判不了 eq 与 length(self)，统一走域隶属
  // （string().min/max/length 返回契约此前静默放过）
  if (
    lv !== undefined &&
    (typeof lv === "number" || typeof lv === "string" || typeof lv === "boolean") &&
    ((constraint.members?.length ?? 0) > 0 ||
      constraint.preds.some((p) => p.op === "eq") ||
      (typeof lv === "string" && constraint.preds.length > 0)) &&
    !literalMeetsConstraint(lv, constraint)
  ) {
    push(formatAbs(ret), formatConstraint(constraint), `return a value satisfying ${formatConstraint(constraint)}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// T10a：nudo:interface-drift（固化生成段 ≠ 今日重算，warning）
// 实现见 check-interface-drift.ts；checkSourceInner 收集 DriftCandidate 后
// 统一调用 interfaceDriftIssues。
// ---------------------------------------------------------------------------

