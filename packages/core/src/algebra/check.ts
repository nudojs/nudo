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
  analyzeFn,
  evalProgramAbs,
  setAbsAssignCollector,
  setAbsCallCollector,
  setAbsTruncationCollector,
  resetAbsCallBudget,
  type AbsAssignRecord,
  type AbsCallRecord,
} from "./ast-eval.ts";
import { leqAbs } from "./leq.ts";
import {
  extractRefineReturnFromSource,
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
  instantiateConstraint,
  type NudoConstraint,
  type NudoField,
} from "./constraint.ts";
import { absToConstraint, joinThenProject } from "./projection.ts";
import { literalMeetsConstraint } from "./domain-membership.ts";
import { extractFn, generalizeFromAst } from "./generalize.ts";
import { contractParamNameSet, locateContractParam } from "./param-surface.ts";
import { getSlot } from "./objects.ts";
import { canSkipLiteralCallScan } from "./fn-fp.ts";
import { stableAnalyzeKeySource } from "./stable-source-key.ts";
import { hashSource, resetHashSourceCache } from "./hash-source.ts";
import {
  loadModuleDepsFingerprint,
  normPath,
  type LoadDepsFingerprint,
} from "./load-deps-fp.ts";
import { boolLit, litValue, numLit, strLit } from "./abs.ts";
import type { Abs } from "./abs.ts";
import { abs } from "./abs.ts";
import type { Phi, Pred } from "./pred.ts";
import { pTrue, predToString } from "./pred.ts";
import { formatAbs, formatAbsMultiline, formatShape } from "./format.ts";
import type { CheckIssue, CheckReport, NudoSig } from "./check-report.ts";
import type { PolyFn } from "./generalize.ts";
import { listTopFunctions, scanLiteralCalls } from "./scan.ts";
import { analyzeFnFull } from "./ast-eval.ts";
import { tryRunTranspiled, callTranspiledExportFull, bindingsOf, type TranspiledCallResult } from "./exec/run.ts";
import { setBAssignCollector, setBCallCollector, type BCallRecord } from "./exec/calls.ts";
import {
  setMayThrowCollector,
  runWithMayThrowSession,
  filterIgnoredThrows,
  mayThrowEffectsToAbs,
  formatThrowsAbs,
  type MayThrowEffect,
} from "./exec/may-throw.ts";

/** C4.1：case 见证的解构字段投影（与 scan.projectArgField 同口径） */
function projectCaseArgField(arg: Abs, field: string): Abs | undefined {
  if (!arg) return undefined;
  if (arg.shape.k === "brand") {
    return projectCaseArgField(arg.shape.shape as Abs, field);
  }
  if (arg.shape.k !== "obj") return undefined;
  return getSlot(arg.shape.slots, field)?.value;
}

// --- 整文件 CheckReport memo（LSP/CI 重复 check → O(1)） ---

const checkReportMemo = new Map<string, CheckReport>();
const checkKeyDeps = new Map<string, string[]>();
const checkDepIndex = new Map<string, Set<string>>();
const loadModuleIds = new WeakMap<object, number>();
let nextLoadModuleId = 1;
const MAX_CHECK_MEMO = 256;

export function resetCheckSourceMemo(): void {
  checkReportMemo.clear();
  checkKeyDeps.clear();
  checkDepIndex.clear();
  resetHashSourceCache();
}

function loadModuleId(fn?: (spec: string, fromFile: string) => string | undefined): number {
  if (!fn) return 0;
  let id = loadModuleIds.get(fn);
  if (id === undefined) {
    id = nextLoadModuleId++;
    loadModuleIds.set(fn, id);
  }
  return id;
}

function checkDepsFingerprint(
  source: string,
  opts: CheckOptions,
): LoadDepsFingerprint {
  if (!opts.loadModule || !opts.fromFile) {
    return { fp: "-", paths: [], contents: [], truncated: false };
  }
  return loadModuleDepsFingerprint(source, opts.loadModule, opts.fromFile);
}

function unindexCheckKey(key: string): void {
  const deps = checkKeyDeps.get(key);
  if (!deps) return;
  for (const p of deps) {
    const set = checkDepIndex.get(p);
    if (!set) continue;
    set.delete(key);
    if (set.size === 0) checkDepIndex.delete(p);
  }
  checkKeyDeps.delete(key);
}

/** `*.nudo.js` 变更后定向逐出依赖它的整文件 check 缓存 */
export function evictCheckSourceMemoForPaths(paths: string[]): number {
  let n = 0;
  for (const raw of paths) {
    const p = normPath(raw);
    const keys = checkDepIndex.get(p);
    if (!keys) continue;
    for (const key of [...keys]) {
      checkReportMemo.delete(key);
      unindexCheckKey(key);
      n++;
    }
  }
  return n;
}

function cloneCheckReport(r: CheckReport): CheckReport {
  return {
    file: r.file,
    issues: r.issues.map((i) => ({ ...i })),
    ok: r.ok,
    signatures: r.signatures.map((s) => ({
      ...s,
      params: [...s.params],
      ...(s.paramTypes ? { paramTypes: [...s.paramTypes] } : {}),
    })),
    summary: { ...r.summary },
  };
}

function checkMemoKey(
  filePath: string,
  source: string,
  identityOpts: CheckOptions,
  deps: LoadDepsFingerprint,
  sidecarFp?: string,
): string {
  // identity must stay the caller's raw loadModule or every checkSource
  // allocates a new loadModuleId and memo never hits.
  // autoBind 必须进键：执法档翻转后不得回放另一档报告（disk 键已含）。
  return [
    hashSource(source),
    filePath,
    `${loadModuleId(identityOpts.loadModule)}:${identityOpts.fromFile ?? ""}`,
    deps.fp,
    sidecarFp ?? "-",
    identityOpts.autoBind === false ? "ab0" : "ab1",
    identityOpts.entryThrows ?? "error",
    (identityOpts.ignoreThrows ?? []).join(",") || "-",
  ].join("|");
}

function checkMemoGet(key: string): CheckReport | null {
  if (!checkReportMemo.has(key)) return null;
  const v = checkReportMemo.get(key)!;
  checkReportMemo.delete(key);
  checkReportMemo.set(key, v);
  return v;
}

function checkMemoSet(key: string, value: CheckReport, depPaths: string[]): void {
  if (checkReportMemo.size >= MAX_CHECK_MEMO) {
    const oldest = checkReportMemo.keys().next().value;
    if (oldest !== undefined) {
      checkReportMemo.delete(oldest);
      unindexCheckKey(oldest);
    }
  }
  checkReportMemo.set(key, value);
  if (depPaths.length > 0) {
    checkKeyDeps.set(key, depPaths);
    for (const p of depPaths) {
      let set = checkDepIndex.get(p);
      if (!set) {
        set = new Set();
        checkDepIndex.set(p, set);
      }
      set.add(key);
    }
  }
}

/**
 * check 选项：core 不碰 fs；host 用 loadModule 喂 require 目标源码。
 */
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
   * L2 入口 may-throw 执法档（design-cli-semantics §3）。
   * error（默认）| warning | off。仅作用于 export/default/CJS 入口函数。
   */
  entryThrows?: "error" | "warning" | "off";
  /** L2 --ignore-throws：按 throws 类型名过滤；不吞 L1 */
  ignoreThrows?: string[];
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
  setAbsTruncationCollector((label) => truncated.add(label));
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
    setAbsTruncationCollector(null);
  }
}

/**
 * refine/interface 侧车诊断 → CheckIssue（全部 error；code+message 去重，
 * 同一失败侧车会在 generalize / 返回后置 / case 对账多处被重复探测）。
 */
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
    source.includes("@nudo:refine") || source.includes("@nudo:interface");
  // ambient 侧车存在时预取本地导出表（一次 parse）：侧车同名绑定只落本地 named export
  const exportedNames =
    sidecarFp !== undefined ? localNamedExports(source) : undefined;
  // L2：模块边界入口表（export / default / CJS exports）— 只执法这些函数
  const entryNames = localNamedExports(source);
  const entryThrowsMode = opts.entryThrows ?? "error";
  const ignoreThrows = opts.ignoreThrows;
  // T10a：generated 事实快照的 drift 候选（每函数级，统一在拿到 varAbs 后判定）
  const driftCandidates: DriftCandidate[] = [];
  // generalize L0 用调用方原始 loadModule 身份；opts 可能是 per-call I/O wrapper
  const refineLoad = identityOpts.loadModule ?? opts.loadModule;
  const refineFrom = identityOpts.fromFile ?? opts.fromFile ?? filePath;
  // autoBind（package.json#nudo.contract）统一透传：effectiveInterface /
  // generalize L0 / scan 执法 / case 对账同一开关口径
  const autoBind = opts.autoBind;
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
    });
    eiCache.set(key, eff);
    return eff;
  };
  for (const name of names) {
    const g = generalizeFromAst(name, source, {
      file,
      refine: {
        loadModule: refineLoad,
        fromFile: refineFrom,
        ...(autoBind !== undefined ? { autoBind } : {}),
      },
      depsFp,
      sidecarFp,
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
        const effects = collectEntryMayThrows(source, name, synthetic, file, phi);
        const throwsDisplayFallback = formatThrowsAbs(mayThrowEffectsToAbs(effects));
        const remaining = filterIgnoredThrows(effects, ignoreThrows);
        const gateDisplay = formatThrowsAbs(mayThrowEffectsToAbs(remaining));
        if (gateDisplay && remaining.length > 0) {
          const first = remaining[0]!;
          const loc = findFnLoc(file, name);
          issues.push({
            severity: entryThrowsMode === "warning" ? "warning" : "error",
            code: "nudo:entry-may-throw",
            message: `${name} (export): may throw ${gateDisplay}`,
            actual: `${name}(…)    throws ${gateDisplay}`,
            expected: "entry total, or declare/catch throws",
            suggestion: first.cause
              ? `${first.cause} → refine / guard / try-catch / --ignore-throws ${first.kind}`
              : `refine / guard / try-catch / --ignore-throws ${first.kind}`,
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
        message: `${name}: 无法归纳符号 Abs`,
        suggestion: "补 @nudo:case 或让函数体可代数求值",
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
      const effects = collectEntryMayThrows(source, name, g, file, phi);
      // 展示层始终上屏未过滤 throws（门禁过滤 ≠ 藏事实）
      throwsDisplay = formatThrowsAbs(mayThrowEffectsToAbs(effects));
      const remaining = filterIgnoredThrows(effects, ignoreThrows);
      const gateDisplay = formatThrowsAbs(mayThrowEffectsToAbs(remaining));
      if (gateDisplay && remaining.length > 0) {
        const first = remaining[0]!;
        const loc = findFnLoc(file, name);
        issues.push({
          severity: entryThrowsMode === "warning" ? "warning" : "error",
          code: "nudo:entry-may-throw",
          message: `${name} (export): may throw ${gateDisplay}`,
          actual: `${formatEntrySigLine(name, g, gateDisplay)}`,
          expected: "entry total, or declare/catch throws",
          suggestion: first.cause
            ? `${first.cause} → refine / guard / try-catch / --ignore-throws ${first.kind}`
            : `refine / guard / try-catch / --ignore-throws ${first.kind}`,
          fn: name,
          ...(loc.line !== undefined ? { line: loc.line } : {}),
          ...(loc.column !== undefined ? { column: loc.column } : {}),
        });
      }
    } else if (isEntry) {
      // 展示层仍上屏 throws（off 只关执法，不藏事实）
      const effects = collectEntryMayThrows(source, name, g, file, phi);
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

    // 真 unknown = 推导失败（design §2 / §5）：返回位或参数位都要报引擎债
    const unknownParamIdx = g.typeParams.findIndex(
      (t) => t.value && t.value.shape.k === "unknown",
    );
    if (g.symbolic?.shape?.k === "unknown" || unknownParamIdx >= 0) {
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
        suggestion: "补 @nudo:case / env mock / refine，或确认 body 可代数求值",
        fn: name,
      });
    }

    // 有效契约（源码 @nudo:refine/@nudo:interface ∪ 侧车同名手写绑定）：
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
            message: `${name}: 契约参数名不在形参表（${unknownParams.join(", ")}）`,
            actual: unknownParams.join(", "),
            expected: surface || g.params.join(", ") || "(无参)",
            suggestion: `把 @nudo:refine / 侧车绑定参数名改成形参之一：${
              surface || g.params.join(", ") || "（函数无参）"
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
            message: `${name}: 手写契约合取不可满足（${eff.conflict.params.join(", ")}）`,
            suggestion: "检查源码 @nudo:refine 与侧车同名绑定的常数界是否矛盾",
            fn: name,
          });
        }
        if (eff.conflict.returns) {
          issues.push({
            severity: "error",
            code: "nudo:interface-conflict",
            message: `${name}: 返回位手写契约合取不可满足`,
            suggestion:
              "检查源码 @nudo:refine return 与侧车 fn() 返回约束是否矛盾（矛盾时返回位不执法）",
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
        issues.push(
          ...checkReturnConstraint(name, display, eff.returns.constraint, g.symbolic),
        );
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

    // generalize 已用同一入口实参求过 body；conf 确信时跳过重复 analyzeFn
    // （after-edit 下 L0 命中 → 这里是 O(1)，否则 400 函数会白跑 400 次）
    if (g.symbolic.conf === "opaque" || g.symbolic.conf === "partial") {
      const entryArgs = g.typeParams.map((t) => t.value);
      try {
        const r = analyzeFn(source, name, entryArgs, phi, undefined, file);
        if (r.conf === "opaque" && !truncated.has(name)) {
          issues.push({
            severity: "info",
            code: "nudo:opaque-result",
            message: `${name}(...): conf=opaque（路径未覆盖或 native）`,
            suggestion: "补 @nudo:case 或调用点",
            fn: name,
          });
        }
      } catch (e) {
        issues.push({
          severity: "error",
          code: "nudo:eval-error",
          message: `${name}: 求值失败 — ${(e as Error).message}`,
          fn: name,
        });
      }
    }
  }

  for (const label of truncated) {
    issues.push({
      severity: "warning",
      code: "nudo:recursion-truncated",
      message: `Recursive evaluation of '${label}' was truncated (depth/size budget); result widened to unknown`,
      suggestion: "收窄递归基例或改用显式 @nudo:refine return 契约",
      fn: label,
    });
  }

  // 一次执行态求值：结构赋值记录 + 顶层绑定表（scanLiteralCalls 实参
  // 解析用）+ 执行态调用记录（T10a drift 的今日域证据，与 emit 同源）。
  // B-path 优先（迁移件 2：$recordBinding/$assignRecord 插桩 + $callNamed
  // BCallRecord）；失败回落 Abs 全通道。
  const records: AbsAssignRecord[] = [];
  const varAbs = new Map<string, Abs>();
  const callRecords: AbsCallRecord[] = [];
  setAbsAssignCollector((r) => records.push(r));
  const prevCallCollector = setAbsCallCollector((r) => callRecords.push(r));
  const bCalls: BCallRecord[] = [];
  setBAssignCollector((r) => records.push(r));
  setBCallCollector((r) => bCalls.push(r));
  let bBindings: Map<string, unknown> | undefined;
  try {
    const bRun = tryRunTranspiled(source, { mode: "analyze" });
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
    /* B 失败回落 Abs */
  } finally {
    setBAssignCollector(null);
    setBCallCollector(null);
  }
  if (bBindings === undefined) {
    try {
      const { env } = evalProgramAbs(source, { file });
      for (const [k, v] of env.vars) varAbs.set(k, v);
    } catch {
      /* 求值失败：无赋值记录、无绑定表 */
    }
  }
  setAbsAssignCollector(null);
  setAbsCallCollector(prevCallCollector);

  const callIssues = canSkipLiteralCallScan(source, file)
    ? []
    : scanLiteralCalls(source, names, phi, {
        loadModule: opts.loadModule,
        // 与 generalize / 返回后置同一 fromFile 口径：ambient 侧车按真实
        // 路径解析（opts.fromFile），filePath 仅是报告标签
        fromFile: refineFrom,
        file,
        varAbs,
        ...(autoBind !== undefined ? { autoBind } : {}),
      });
  issues.push(...callIssues);

  // T10a：固化生成段 drift——generated 快照 ≠ 今日重算 → warning
  // （在执行态调用记录就绪后跑：今日域证据与 emit 的 callsite case 同源）
  if (driftCandidates.length > 0) {
    issues.push(
      ...interfaceDriftIssues(driftCandidates, callRecords, (fnName, args) => {
        try {
          return analyzeFn(source, fnName, args, phi, undefined, file);
        } catch {
          return undefined;
        }
      }),
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
    }),
  );

  // 结构可赋值：赋值语句 prev ⊇ next（Abs leq）
  issues.push(...structuralAssignIssues(records));

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;

  return {
    file: filePath,
    issues,
    ok: errors === 0,
    signatures,
    summary: { errors, warnings, infos, functions: signatures.length },
  };
}

/** L0 命中的 symbolic 对象稳定：display/detail 按 Abs 身份缓存 */
const sigFormatCache = new WeakMap<Abs, { display: string; detail: string }>();

/** 入口形参个数估计（CJS / generalize 失败时喂 any 实参） */
function estimateEntryParamCount(
  source: string,
  fnName: string,
  file: ReturnType<typeof parse>,
): number {
  try {
    for (const stmt of file.program.body) {
      const nodes: unknown[] = [stmt];
      if (
        stmt.type === "ExportNamedDeclaration" ||
        stmt.type === "ExportDefaultDeclaration"
      ) {
        nodes.push((stmt as { declaration?: unknown }).declaration);
      }
      if (stmt.type === "ExpressionStatement") {
        const expr = (stmt as { expression?: { right?: unknown } }).expression;
        nodes.push(expr?.right);
      }
      for (const n of nodes) {
        const node = n as {
          type?: string;
          id?: { name?: string };
          params?: unknown[];
          properties?: Array<{
            key?: { type?: string; name?: string; value?: unknown };
            value?: unknown;
          }>;
        };
        if (!node) continue;
        const isFn =
          node.type === "FunctionDeclaration" ||
          node.type === "FunctionExpression" ||
          node.type === "ArrowFunctionExpression";
        if (isFn && (node.id?.name === fnName || !node.id)) {
          return node.params?.length ?? 0;
        }
        if (node.type === "ObjectExpression") {
          for (const p of node.properties ?? []) {
            const keyName =
              p.key?.type === "Identifier"
                ? (p.key as { name?: string }).name
                : p.key && (p.key.type === "StringLiteral" || p.key.type === "NumericLiteral")
                  ? String(p.key.value)
                  : undefined;
            if (String(keyName) !== fnName) continue;
            const v = p.value as { type?: string; params?: unknown[] };
            if (
              v &&
              (v.type === "FunctionExpression" || v.type === "ArrowFunctionExpression")
            ) {
              return v.params?.length ?? 0;
            }
          }
        }
      }
    }
  } catch {
    /* fallthrough */
  }
  const re = new RegExp(
    `(?:function\\s+${fnName}\\s*\\(([^)]*)\\)|${fnName}\\s*=\\s*(?:async\\s*)?function(?:\\s+${fnName})?\\s*\\(([^)]*)\\)|${fnName}\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>)`,
  );
  const m = re.exec(source);
  if (m) {
    const args = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!args) return 0;
    return args.split(",").filter((s) => s.trim().length > 0).length;
  }
  return 1;
}

/** export default 是否绑定到该本地函数名 */
function isDefaultExportName(source: string, fnName: string): boolean {
  // export default function fn / export default fn / export default () =>
  const re = new RegExp(
    `export\\s+default\\s+(?:async\\s+)?(?:function\\s+${fnName}\\b|${fnName}\\b)`,
  );
  return re.test(source);
}

function formatEntrySigLine(name: string, g: PolyFn, throws: string): string {
  const ps = g.params
    .map((p, i) => {
      const t = g.typeParams[i]?.value;
      // design §2：无约束 any；真 unknown 不得伪装
      const shown = !t ? "any" : t.shape.k === "unknown" ? "unknown" : formatShape(t);
      return `${p}: ${shown}`;
    })
    .join(", ");
  return `${name}(${ps}) => ${formatShape(g.symbolic)}    throws ${throws}`;
}

/**
 * 入口 L2 may-throw 收集：用 any 入口实参求值函数体，
 * 捕获 any/nullish 成员访问等 throws 效果；显式 throw 也进 throws 域。
 */
/** 入口函数节点位置（L2 诊断定位；找不到则省略） */
function findFnLoc(
  file: ReturnType<typeof parse>,
  name: string,
): { line?: number; column?: number } {
  type LocNode = { loc?: { start?: { line?: number; column?: number } }; type?: string };
  const startOf = (n: LocNode | null | undefined) => n?.loc?.start;
  try {
    for (const stmt of file.program.body as unknown as LocNode[]) {
      let decl: LocNode | null | undefined = stmt;
      const s = stmt as unknown as {
        type?: string;
        declaration?: LocNode | null;
      };
      if (s.type === "ExportNamedDeclaration" && s.declaration) decl = s.declaration;
      if (s.type === "ExportDefaultDeclaration" && s.declaration) decl = s.declaration;
      if (!decl) continue;
      if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
        const id = (decl as unknown as { id?: { name?: string } }).id;
        if (id?.name === name) {
          const st = startOf(decl);
          return { line: st?.line, column: st?.column };
        }
      }
      if (decl.type === "VariableDeclaration") {
        const decls =
          (decl as unknown as { declarations?: Array<LocNode & { id?: { name?: string } }> })
            .declarations ?? [];
        for (const d of decls) {
          if (d.id?.name === name) {
            const st = startOf(d);
            return { line: st?.line, column: st?.column };
          }
        }
      }
      if (name === "default" && s.type === "ExportDefaultDeclaration") {
        const st = startOf(s.declaration) ?? startOf(stmt);
        return { line: st?.line, column: st?.column };
      }
    }
  } catch {
    /* loc is best-effort */
  }
  return {};
}

function collectEntryMayThrows(
  source: string,
  fnName: string,
  g: PolyFn,
  file: ReturnType<typeof parse>,
  phi: Phi,
): MayThrowEffect[] {
  const effects: MayThrowEffect[] = [];
  const entryArgs = g.typeParams.map((t) => t.value);
  return runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      // P2-a：L2 throws 求值 B-path 优先（B-hosted 诊断同源；may-throw 效果
      // 通道共享 recordMayThrow，B 执行同样落收集器）；类方法/转译失败
      // 回落 ast-eval analyzeFnFull。
      const full = bPathThrowsOf(source, fnName, entryArgs) ?? analyzeFnFull(source, fnName, entryArgs, { phi, file });
      // 显式 throw（未被 try 消化）也进 L2
      if (full.throws && full.throws.shape.k !== "never") {
        const tName = formatThrowsAbs(full.throws) ?? "Error";
        if (!effects.some((e) => e.kind === tName && e.cause.startsWith("throw"))) {
          effects.push({
            kind: tName === "Error" && full.throws.term?.op === "lit" ? "Error" : tName,
            cause: `throw ${formatShape(full.throws)}`,
          });
        }
      }
    } catch {
      /* 求值失败：已有 nudo:eval-error；L2 不叠报 */
    } finally {
      setMayThrowCollector(null);
    }
    return effects;
  });
}

/** L2 throws 的 B-path 求值：顶层导出直调；类方法（.名）/失败 → undefined（回落） */
const bPathRunMemo = new Map<string, Record<string, unknown>>();
function bPathThrowsOf(
  source: string,
  fnName: string,
  args: Abs[],
): TranspiledCallResult | undefined {
  if (fnName.includes(".")) return undefined; // 类方法不在顶层导出表
  // L2 解耦后两引擎口径一致：any 实参的数组方法调用同样记 may-throw
  //（提升是假设、不消除危险），约束与无约束入口都走 B。
  if (bPathRunMemo.size >= MAX_CHECK_MEMO) {
    const oldest = bPathRunMemo.keys().next().value;
    if (oldest !== undefined) bPathRunMemo.delete(oldest);
  }
  let exports = bPathRunMemo.get(source);
  if (exports === undefined) {
    const run = tryRunTranspiled(source, { mode: "analyze" });
    if (run === undefined) return undefined;
    exports = run;
    bPathRunMemo.set(source, exports);
  }
  if (!(fnName in exports)) return undefined;
  try {
    return callTranspiledExportFull(exports, fnName, args);
  } catch {
    return undefined;
  }
}

function formatSigCached(absVal: Abs, name: string): { display: string; detail: string } {
  const hit = sigFormatCache.get(absVal);
  if (hit) return hit;
  const out = {
    display: formatAbs(absVal),
    detail: formatAbsMultiline(absVal, name),
  };
  sigFormatCache.set(absVal, out);
  return out;
}

/**
 * 后置契约：推断返回 Abs ⊭ @nudo:refine return 声明。
 * 只在有确定信息时报（字面量界 / prim 类型 / shape 缺字段）。
 */
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
      message: `${fnName}: 返回值 ⊭ @nudo:refine return ${cName}`,
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
        push(formatAbs(ret), `object shape (${cName})`, `返回满足 ${cName} 形状的 object`);
      }
      return out;
    }
    for (const [key, field] of Object.entries(constraint.fields) as Array<
      [string, NudoField]
    >) {
      const slot = getSlot(slots, key);
      if (!slot) {
        if (!field.optional && !field.constraint.isOptional) {
          push(formatAbs(ret), `missing field ${key}`, `返回值补全字段 ${key}`);
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
            `把返回值的 ${key} 改成 ${field.constraint.prim}`,
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
                  `返回值的 ${key} 应满足 ${key} ${opSym} ${n}`,
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
      push(formatAbs(ret), `typeof return = "${constraint.prim}"`, `返回 ${constraint.prim}`);
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
            push(formatAbs(ret), `return ${opSym} ${n}`, `返回满足 ${opSym} ${n} 的值`);
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
    push(formatAbs(ret), formatConstraint(constraint), `返回满足 ${formatConstraint(constraint)} 的值`);
  }
  return out;
}

/**
 * 结构可赋值：`let a = {x:1}; a = {y:2}` 应报 missing slot x；`let n = 1; n = "str"`
 * （无条件标量改型）报 violation（金标 assign-prim-mismatch-violates）。
 * 输入为 evalProgramAbs 收集的赋值记录（与 scanLiteralCalls 共享一次求值）。
 *
 * 分支/循环体内的重赋值不参与：可变绑定在路径上取并集是合法 JS
 * （特性检测 `if (!x.__proto__) flag = false` 是常见模式），conditional
 * 记录已在 ast-eval 侧标记。
 */
function structuralAssignIssues(records: AbsAssignRecord[]): CheckIssue[] {
  const out: CheckIssue[] = [];
  for (const r of records) {
    if (!r.prev) continue;
    // 分支/循环体内的重赋值：路径并集是合法 JS（特性检测等模式），不报
    if (r.conditional) continue;
    // 跳过 unknown / never 源（无信息）
    if (r.next.shape.k === "unknown" && !r.next.term) continue;
    if (r.prev.shape.k === "unknown" && !r.prev.term) continue;
    const leq = leqAbs(r.next, r.prev);
    if (!leq.ok) {
      out.push({
        severity: "error",
        code: "nudo:assign-mismatch",
        message: `${r.name}: 赋值 ⊭ 原有形状`,
        actual: formatAbs(r.next),
        expected: formatAbs(r.prev),
        suggestion: leq.reason ?? "改用兼容的值，或放宽绑定类型",
        fn: r.name,
        line: r.line,
        column: r.column,
      });
    }
  }
  return out;
}

/**
 * case 是契约的见证：`@nudo:case` 实参 ⊄ refine → nudo:case-inconsistency。
 * 只检查字面量实参（数字/字符串/布尔/null）；非字面量跳过，不猜。
 * 有效契约走 effectiveInterface：只执法 handwritten（generated 段 = 事实
 * 快照不执法）；conflict 参数已由 fn 级 nudo:interface-conflict 覆盖，跳过。
 */
function scanCaseInconsistency(
  source: string,
  knownFns: string[],
  opts: {
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    fromFile?: string;
    file?: ReturnType<typeof parse>;
    /** ambient 侧车存在（checkSource 预探测）：无源码 refine 时侧车契约仍需对账 */
    sidecarPresent?: boolean;
    /** 侧车 ambient 绑定开关（checkSource 的 package.json 配置下传） */
    autoBind?: boolean;
  },
): CheckIssue[] {
  const out: CheckIssue[] = [];
  // 快路径：无 case 指令则免整树 walk；无契约来源时 case 不可能 ⊄ 契约
  if (!source.includes("@nudo:case")) return out;
  const hasContractOrigin =
    source.includes("@nudo:refine") ||
    source.includes("@nudo:interface") ||
    opts.sidecarPresent === true;
  if (!hasContractOrigin) return out;
  const file = opts.file ?? parse(source);

  /** 解析 case 实参列表里的简单字面量 */
  const parseLitArg = (s: string): Abs | undefined => {
    const t = s.trim();
    if (t === "") return undefined;
    if (t === "true") return { shape: { k: "prim", type: "boolean" }, term: { op: "lit", value: true }, conf: "exact" };
    if (t === "false") return { shape: { k: "prim", type: "boolean" }, term: { op: "lit", value: false }, conf: "exact" };
    if (t === "null") return { shape: { k: "unknown" }, term: { op: "lit", value: null }, conf: "exact" };
    if (t === "undefined") return { shape: { k: "unknown" }, term: { op: "lit", value: undefined }, conf: "exact" };
    if (/^-?\d+(\.\d+)?$/.test(t)) return numLit(Number(t));
    const str = t.match(/^(['"])([\s\S]*)\1$/);
    if (str) {
      return {
        shape: { k: "prim", type: "string" },
        term: { op: "lit", value: str[2]! },
        conf: "exact",
      };
    }
    return undefined;
  };

  /** 从 `@nudo:case "name" (a, b)` 抽实参原文 */
  const parseCaseArgs = (raw: string): string[] | undefined => {
    const m = raw.match(/@nudo:case\s+"[^"]+"\s*\(([\s\S]*)\)/);
    if (!m) return undefined;
    const inner = m[1]!.trim();
    if (inner === "") return [];
    // 顶层逗号切分（不处理嵌套对象/数组——那些不是字面量见证）
    const parts: string[] = [];
    let depth = 0;
    let cur = "";
    let quote: string | null = null;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i]!;
      if (quote) {
        cur += ch;
        if (ch === quote && inner[i - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cur += ch;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      if (ch === ")" || ch === "]" || ch === "}") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
  };

  const checkCaseAgainstReqs = (
    fnName: string,
    caseName: string,
    args: string[],
    line: number | undefined,
  ): void => {
    const g = generalizeFromAst(fnName, source, file ? { file } : {});
    if (!g) return;
    const paramNames = g.params;
    // 有效契约单点读取：只执法 handwritten（generated/implicit 不执法）
    const eff = effectiveInterface(source, fnName, {
      loadModule: opts.loadModule,
      fromFile: opts.fromFile ?? "",
      ...(opts.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
    });
    if (!eff || eff.source !== "handwritten") return;
    const conflictParams = new Set(eff.conflict?.params ?? []);
    const formals = g.formals ?? [];
    const reqs: Array<
      [number, { param: string; pred: Pred; constraint: NudoConstraint }, string | undefined]
    > = [];
    for (const p of eff.params) {
      if (conflictParams.has(p.param)) continue;
      // C4.1：display 名命中失败时用 locateContractParam（默认/rest/解构顶层名）
      let idx = paramNames.indexOf(p.param);
      let field: string | undefined;
      if (idx < 0 && formals.length > 0) {
        const hit = locateContractParam(formals, p.param);
        if (hit) {
          idx = hit.index;
          field = hit.field;
        }
      }
      if (idx < 0) continue;
      reqs.push([
        idx,
        {
          param: p.param,
          pred: instantiateConstraint(p.constraint, p.param),
          constraint: p.constraint,
        },
        field,
      ]);
    }
    if (reqs.length === 0) return;

    const absArgs = args.map((a) => parseLitArg(a) ?? abs({ k: "unknown" }, undefined, undefined, "partial"));
    // 标量域：eq/union 形态（lit()/union() 契约）走域隶属判定（bounds 分支
    // 判不了 eq/or，此前静默跳过 = 写了等于没写）；纯 bounds 域沿用逐原子
    // 报告（expected 保持 predToString 原文，既有输出契约零改动）
    for (const req of reqs) {
      const idx = req[0];
      const entry = req[1];
      const field = req[2];
      if (entry.constraint.fields) continue;
      let arg = absArgs[idx];
      if (!arg) continue;
      // C4.1：destructure 契约名 → 实参字段投影后再判 pred；
      // 缺字段不能静默跳过（与 scan.checkReqs 同口径，报 case 见证违例）
      if (field) {
        const projected = projectCaseArgField(arg, field);
        if (!projected) {
          const k = arg.shape.k;
          if (k !== "unknown" && k !== "any") {
            const paramName = entry.param || paramNames[idx] || `arg${idx}`;
            out.push({
              severity: "error",
              code: "nudo:case-inconsistency",
              message: `${fnName} case "${caseName}": 见证 ⊭ 契约`,
              actual: formatAbs(arg),
              expected: `missing field ${field}`,
              suggestion: `case 实参补全字段 ${field}（契约位 ${paramName}）`,
              fn: fnName,
              line,
            });
          }
          continue;
        }
        arg = projected;
      }
      const lv = litValue(arg);
      if (
        lv === undefined ||
        (typeof lv !== "number" && typeof lv !== "string" && typeof lv !== "boolean")
      ) {
        continue;
      }
      const hasEqOr =
        (entry.constraint.members?.length ?? 0) > 0 ||
        entry.constraint.preds.some((p) => p.op === "eq");
      if (hasEqOr) {
        if (!literalMeetsConstraint(lv, entry.constraint)) {
          const paramName = entry.param || paramNames[idx] || `arg${idx}`;
          out.push({
            severity: "error",
            code: "nudo:case-inconsistency",
            message: `${fnName} case "${caseName}": 见证 ⊭ 契约`,
            actual: formatAbs(arg),
            expected: formatConstraint(entry.constraint),
            suggestion: `改 case 实参，或放宽 ${paramName} 的 refine`,
            fn: fnName,
            line,
          });
        }
        continue;
      }
      if (typeof lv !== "number") continue;
      const flatten = (p: Pred): Pred[] => (p.op === "and" ? p.args.flatMap(flatten) : p.op === "true" ? [] : [p]);
      for (const p of flatten(entry.pred)) {
        if (
          (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") &&
          p.b.op === "lit" &&
          typeof p.b.value === "number"
        ) {
          const n = p.b.value;
          let ok = true;
          if (p.op === "gt") ok = lv > n;
          if (p.op === "ge") ok = lv >= n;
          if (p.op === "lt") ok = lv < n;
          if (p.op === "le") ok = lv <= n;
          if (!ok) {
            const paramName = entry.param || paramNames[idx] || `arg${idx}`;
            out.push({
              severity: "error",
              code: "nudo:case-inconsistency",
              message: `${fnName} case "${caseName}": 见证 ⊭ 契约`,
              actual: formatAbs(arg),
              expected: predToString(p),
              suggestion: `改 case 实参，或放宽 ${paramName} 的 refine`,
              fn: fnName,
              line,
            });
          }
        }
      }
    }
  };

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & {
      type?: string;
      leadingComments?: Array<{ value: string; loc?: { start: { line: number } } }>;
      loc?: { start: { line: number } };
    };
    // 顶层函数声明上的 leading comments
    let decl: Record<string, unknown> | undefined = obj;
    if (obj.type === "ExportNamedDeclaration" || obj.type === "ExportDefaultDeclaration") {
      decl = obj.declaration as Record<string, unknown> | undefined;
    }
    if (
      decl &&
      (decl.type === "FunctionDeclaration" ||
        (decl.type === "VariableDeclaration" &&
          ((decl as { declarations?: Array<Record<string, unknown>> }).declarations ?? [])[0]?.init &&
          ["ArrowFunctionExpression", "FunctionExpression"].includes(
            String(
              ((decl as { declarations: Array<Record<string, unknown>> }).declarations[0]!.init as { type?: string })
                .type,
            ),
          )))
    ) {
      const id =
        decl.type === "FunctionDeclaration"
          ? (decl.id as { name?: string } | undefined)?.name
          : ((decl as { declarations: Array<{ id?: { name?: string } }> }).declarations[0]?.id as
              | { name?: string }
              | undefined)?.name;
      if (id && knownFns.includes(id)) {
        for (const c of obj.leadingComments ?? []) {
          const caseArgs = parseCaseArgs(c.value);
          if (!caseArgs) continue;
          const caseName = /@nudo:case\s+"([^"]+)"/.exec(c.value)?.[1] ?? "?";
          checkCaseAgainstReqs(id, caseName, caseArgs, c.loc?.start.line);
        }
      }
    }
    for (const key of Object.keys(obj)) {
      if (key === "loc" || key === "start" || key === "end" || key === "leadingComments") continue;
      const val = obj[key];
      if (Array.isArray(val)) val.forEach(visit);
      else if (val && typeof val === "object") visit(val);
    }
  };
  visit(file);
  return out;
}

// ---------------------------------------------------------------------------
// T10a：nudo:interface-drift（固化生成段 ≠ 今日重算，warning）
//
// generated 段是 emit 时刻的固化事实快照（不执法）；本检查把它与「今日
// 重算」做语义对比（§6 证据门槛：conf∈{exact,path} 且无截断标记，无证据
// 不判——real-package zero-FP 红线）：
// - 参数位：今日 = 该函数**执行态**调用点实参域（evalProgramAbs 的
//   AbsCallRecord，joinThenProject 投影归一；与 emit 的 callsite case 同源）；
// - 返回位：今日 = 逐调用点结果域（全证据实参 analyzeFn 重跑，与 emit 的
//   case-result 投影同源；无结果证据不判）。
// 语义相等 = 双方经 constraintToEntryAbs 进 entry Abs 后 leqAbs(a,b) &&
// leqAbs(b,a)（不比字符串；两侧同构归一是关键——裸 numLit 域不带 pred，
// 直接与 entry Abs 比 leq 会因 typeof/eq 锚定 pred 恒失败）。每 fn 每位
// （参数名 / return）最多一条。
// ---------------------------------------------------------------------------

/** drift 候选：generated 有效契约 + 今日入口签名（checkSourceInner 每函数级收集） */
type DriftCandidate = {
  fnName: string;
  /** generalize 形参名表（eff.params 的参数名 → 调用点实参位） */
  paramNames: string[];
  eff: EffectiveInterface;
};

/** §6 证据门槛：conf∈{exact,path} 且非 unknown/any。截断求值会被宽化为
 *  partial/opaque（或退化为 unknown），自然出局——无需另查截断标记。 */
function driftEvidence(a: Abs | undefined): a is Abs {
  if (!a) return false;
  if (a.conf !== "exact" && a.conf !== "path") return false;
  return a.shape.k !== "unknown" && a.shape.k !== "any";
}

/**
 * 每函数逐调用点实参表——**执行态**通道（evalProgramAbs 的 AbsCallRecord，
 * 与 emit 的 callsite case 同源：只有真正执行了的调用才产证据）。
 * 语法全树扫描会把「兄弟函数体内从未执行的调用」也算进今日域，fresh
 * emit 后立即误报 drift 且重跑 emit 无法消除——两端口径必须一致。
 */
function driftCallsites(
  records: AbsCallRecord[],
  wanted: Set<string>,
): Map<string, Array<{ args: Abs[]; line?: number }>> {
  const out = new Map<string, Array<{ args: Abs[]; line?: number }>>();
  for (const r of records) {
    if (!wanted.has(r.fnName)) continue;
    const list = out.get(r.fnName) ?? [];
    list.push({ args: r.args, line: r.callLoc?.line });
    out.set(r.fnName, list);
  }
  return out;
}

/** generated 快照 vs 今日重算（参数位 + 返回位），每 fn 每位最多一条。
 *  callRecords：evalProgramAbs 的执行态调用记录（今日域证据，与 emit 的
 *  callsite case 同源——analyzeFn 以全证据实参重跑返回位；语法扫描会把
 *  未执行的调用算进今日域，fresh emit 恒误报）。 */
function interfaceDriftIssues(
  candidates: DriftCandidate[],
  callRecords: AbsCallRecord[],
  evalResult: (fnName: string, args: Abs[]) => Abs | undefined,
): CheckIssue[] {
  const out: CheckIssue[] = [];
  const wanted = new Set(candidates.map((c) => c.fnName));
  const callsites = driftCallsites(callRecords, wanted);

  for (const cand of candidates) {
    const sites = callsites.get(cand.fnName) ?? [];

    // 参数位：今日域 = 逐调用点实参（证据门槛过滤）→ joinThenProject 投影
    for (const { param, constraint } of cand.eff.params) {
      const idx = cand.paramNames.indexOf(param);
      if (idx < 0) continue; // 快照参数名已不在今日签名：无位置可对账
      const evidence: Array<{ abs: Abs; line?: number }> = [];
      for (const s of sites) {
        const a = s.args[idx];
        if (driftEvidence(a)) evidence.push({ abs: a, line: s.line });
      }
      if (evidence.length === 0) continue; // 无证据 → 不判 drift（宁缺勿滥）
      const todayC = joinThenProject(evidence.map((e) => e.abs));
      if (!todayC) continue; // 域不可表达（ widened/partial 混入等）→ 不比
      const today = constraintToEntryAbs(todayC, param);
      const expected = constraintToEntryAbs(constraint, param);
      if (leqAbs(today, expected).ok && leqAbs(expected, today).ok) continue;
      out.push({
        severity: "warning",
        code: "nudo:interface-drift",
        message: `${cand.fnName}[${param}]: 固化生成段 ≠ 今日调用点域`,
        actual: formatAbs(today),
        expected: formatConstraint(constraint),
        suggestion: `重跑 nudo contract --emit 刷新生成段，或核对 ${param} 的调用点`,
        fn: cand.fnName,
        line: evidence[0]!.line,
      });
    }

    // 返回位：今日 = 逐调用点结果域（与 emit 同源；generated 无 returns 声明 → 只查参数位）
    const retC = cand.eff.returns?.constraint;
    if (!retC) continue;
    const retEvidence: Array<{ abs: Abs; line?: number }> = [];
    for (const s of sites) {
      if (s.args.some((a) => !driftEvidence(a))) continue; // 全参证据才重跑（与 case 合成同口径）
      const r = evalResult(cand.fnName, s.args as Abs[]);
      if (driftEvidence(r)) retEvidence.push({ abs: r, line: s.line });
    }
    if (retEvidence.length === 0) continue; // 无结果证据 → 不判 drift（宁缺勿滥）
    const todayRetC = joinThenProject(retEvidence.map((e) => e.abs));
    if (!todayRetC) continue;
    const today = constraintToEntryAbs(todayRetC, "return");
    const expected = constraintToEntryAbs(retC, "return");
    if (leqAbs(today, expected).ok && leqAbs(expected, today).ok) continue;
    out.push({
      severity: "warning",
      code: "nudo:interface-drift",
      message: `${cand.fnName}[return]: 固化生成段 ≠ 今日推断返回`,
      actual: formatAbs(today),
      expected: formatConstraint(retC),
      suggestion: `重跑 nudo contract --emit 刷新生成段，或核对返回值`,
      fn: cand.fnName,
      line: retEvidence[0]!.line,
    });
  }
  return out;
}

