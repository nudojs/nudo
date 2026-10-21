/**
 * uncached 路径的 case 合成与 entry 分析：@nudo:case 指令求值
 * （evaluateCaseDirectives）、调用点 case 合成 call@/call@symbolic
 * （synthesizeCallSiteCases）与 entry@ 兜底评估（evaluateEntryCase）。
 * 自 analyzer-orchestrate-uncached.ts 机械拆出。
 *
 * 不变量 / Invariants:
 * - **见证值 = 观测值**：`call@` 见证的返回值取调用现场语境下观测到的
 *   `rec.resultAbs`；「目标语境重求值」只在闸门（absIsBetter）判定更有
 *   信息量时替换，且**不得**绕过闸门覆盖观测值（否则报告出的调用点真值
 *   与实际调用结果矛盾）。
 * - **见证名 = 调用点身份**：调用点在本文件内 → `call@L<行号>`（行号在
 *   被分析文件里可核对，与既有已固化名字兼容）；调用点在别的文件
 *   （`--from` 现场）→ `call@<现场文件相对路径>:L<行号>`（名字自带来源
 *   限定 ⇒ 跨现场不撞名；行号落在具名文件里可核对）。
 * - **期望值判定 = 值级 + 结构级**：`@nudo:case` 的 `=> expected` 是约束
 *   （带 pred）；`leqAbs` 只做结构判定 ⇒ 值级语义在此补（core 的字面量域
 *   隶属判定），否则 `number().gt(0)` 这类期望恒假红。
 * - **类方法见证走类链**：点号名（`C.m`）只作展示名；见证调用按
 *   「类 Abs → $new → 原型方法槽 $invoke」派发（源码里没有 `C.m` 这个
 *   可调用表达式）。
 * - **侧车加载失败 ≠ 没有契约根**：加载失败（nudo:interface-load）走 error
 *   诊断，并抑制「no contract root」的误导 info。
 * - **函数体内的调用点也是调用点域**：入口求值采集函数体内的调用并入共享
 *   callRecords；被调方若已先回落 entry@，在证据出现后改合成 call@ 见证。
 */
import { dirname, relative, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import type { Node } from "@babel/types";
import {
  anyAbs,
  abs as makeAbsVal,
  formatShape,
  leqAbs,
  localNamedExports,
  effectiveInterface,
  unknown as absUnknown,
  $invoke,
  $new,
  getEvalClass,
  interfaceDiagCount,
  literalMeetsConstraint,
  litValue,
  SELF,
  substPred,
  takeInterfaceDiagsSince,
  type NudoConstraint,
  type Pred,
  type Term,
  type TypeofName,
} from "@nudojs/core";
import {
  DIAG,
  setMayThrowCollector,
  mayThrowEffectsToAbs,
  formatThrowsAbs,
  type MayThrowEffect,
  type EvalMemberDiag,
} from "@nudojs/core/internal";
import type { CaseDirective } from "@nudojs/parser";
import {
  collapseAbsLits,
  isLeakedCallRecord,
  neverAbs,
  undefAbs,
  widenJoinAbs,
  type CallRecord,
} from "./evaluator/call-record.ts";
import { mockSeedsToAbsMocks, mockScopeSelected, type AbsMockSeeds } from "./mock-abs.ts";
import type { CallSiteRecord } from "./analyzer-orchestrate-calls.ts";
import { findProjectConfig, interfaceConfig, analysisConfig } from "./evaluator/config.ts";
import { defaultLoadModule } from "./load-module.ts";
import { tryEvalCall, tryEvalCallFull, tryRunEval } from "./eval-run.ts";
import {
  buildAbsImportLocalMap,
  callRecordFromAbsCall,
  tryEvalAbsFull,
  tryEvalAbsRaw,
  tryEvalEntryAbs,
  tryAttachIntension,
  attachAbsToIntension,
  attachHofSnapshot,
  absIsBetter,
} from "./analyzer-abs-eval.ts";
import { COLLAPSE_LITERAL_THRESHOLD, dedupeCallRecords } from "./analyzer-diagnose.ts";
import { extractFormals, extractParamNames, resolveFunctionNode } from "./analyzer-ast.ts";
import { tsAnnotationArgAbs } from "./ts-annotation.ts";
import type {
  AnalyzeLoadModule,
  CaseHint,
  CaseResult,
  Diagnostic,
  FunctionAnalysis,
  SourceLocation,
} from "./analyzer-types.ts";
import type { Abs } from "@nudojs/core";

/**
 * case 合成 / entry 分析共享的求值环境（uncached 主流程一次组装；
 * diagnostics / caseHints / callRecords 按引用共享，函数内原地追加）。
 */
export type UncachedCaseEnv = {
  source: string;
  filePath: string;
  envNames: string[];
  seeds: AbsMockSeeds;
  loadModule?: AnalyzeLoadModule;
  /** dep 内容指纹段（evaluator 缓存键；模块图组装产物） */
  fnDepSeg: string | null;
  /** B 成功跑通本文件（weak-unknown 放宽判定） */
  evalHosted: boolean;
  selfContained: boolean;
  canAbsModules: boolean;
  pushMemberDiag: (d: EvalMemberDiag, fallbackLine: number) => void;
  diagnostics: Diagnostic[];
  caseHints: CaseHint[];
  callRecords: CallRecord[];
  /**
   * 本文件的侧车（`*.nudo.js`）**加载失败**（nudo:interface-load 已报）。
   * 粘滞标记：加载失败与「根本没有侧车」必须可区分——否则会把
   * 「用户写了契约但写坏了」误报成「没有契约根」（误导性 info）。
   */
  sidecarLoadFailed?: boolean;
  /**
   * 已回落 entry@ 的候选（调用点证据出现得晚：调用点在**别的函数体内**，
   * 被调方先于调用方被处理）。证据出现后据此把 entry@ 换成 call@（503）。
   */
  entryOnlyCandidates?: Map<string, EntryOnlyCandidate>;
  /**
   * 外部注入的调用点记录（`--from` 使用现场采集）。主流程注入；缺省时
   * 「已固化函数的二次 freeze」看不到现场调用点（跨分片接线点，见报告）。
   */
  externalCallRecords?: CallRecord[];
};

/** 已回落 entry@ 的候选（待 settle：entry@ 见证 + 候选本身）。 */
export type EntryOnlyCandidate = {
  candidate: SynthCandidate;
  /** entry@ 见证（settle 时撤掉，改合成 call@） */
  entryCase: CaseResult;
};

/** entry@ 兜底候选（无 @nudo:case 指令函数 + 顶层无指令函数） */
export type SynthCandidate = {
  name: string;
  /** AST 节点（合成 symbolic 聚合见证时需要；缺省则不产聚合见证） */
  node?: Node;
  analysis: FunctionAnalysis;
  assignedName?: string;
  /**
   * **隔离调用点证据**（Bug 511）。
   *
   * 函数已带 case 见证（且只是**点观测**）⇒ 入口兜底求值只为产出**推断域**
   * （点观测不得独占返回面，见 analyzer-orchestrate-uncached.ts 的接线）。
   * 此时入口求值带出的调用点证据**不并入**共享台账：否则一次为取域而做的
   * 求值会给别的函数凭空多出一条 call@ 见证（被调方的证据面被污染）。
   */
  domainOnly?: boolean;
};

/** @nudo:case 指令求值目标（主流程逐函数组装） */
export type CaseDirectiveTarget = {
  name: string;
  fnLoc: SourceLocation;
  analysis: FunctionAnalysis;
  caseDirectives: CaseDirective[];
  caseIdxsToRun: number[];
  activeCaseIdx: number;
};

// ---------------------------------------------------------------------------
// 期望值（`@nudo:case "t" (…) => expected`）的判定
//
// `expected` 是**约束**（`number()` / `number().gt(0)` / `shape()` / `union()`…），
// 落成 Abs 后带 pred。`leqAbs` 只做**结构/蕴含**判定（源无 pred ⇒ 目标有 pred
// ⇒ 不蕴含），不做**值级**判定 ⇒ `number().gt(0)` 这类期望恒判失败（假红）。
// 这里按 core 的字面量域隶属判定（literalMeetsConstraint）补上值级语义：
// 实际值是字面量且落在期望的域内 ⇒ 满足。
// ---------------------------------------------------------------------------

/** case-arg 侧把约束锚在 `__arg` 变量上（parser：constraintToEntryAbs(c, "__arg")）。 */
const CASE_ARG_SELF = "__arg";

/** 期望里的「自身」变量集合：约束锚点（__arg / 契约侧 SELF）+ 期望自身的 term。 */
function expectedSelfIds(expected: Abs): Set<string> {
  const ids = new Set<string>([SELF, CASE_ARG_SELF]);
  const t = expected.term;
  if (t && t.op === "var") ids.add(t.id);
  return ids;
}

function isSelfTerm(t: Term, selfIds: Set<string>): boolean {
  return t.op === "var" && selfIds.has(t.id);
}

/** 把 pred 里的「自身」变量重锚到 SELF（core 的域判定锚在 SELF 上）。 */
function anchorPredOnSelf(pred: Pred, selfIds: Set<string>): Pred | undefined {
  let anchored = false;
  const selfTerm: Term = { op: "var", id: SELF };
  const reanchor = (t: Term): Term => {
    if (t.op === "var" && selfIds.has(t.id)) {
      anchored = true;
      return selfTerm;
    }
    if (t.op === "app") {
      let touched = false;
      const args = t.args.map((a): Term => {
        if (a.op === "var" && selfIds.has(a.id)) {
          anchored = true;
          touched = true;
          return selfTerm;
        }
        return a;
      });
      return touched ? { ...t, args } : t;
    }
    return t;
  };
  const p = substPred(pred, reanchor);
  return anchored ? p : undefined;
}

/** 期望的 prim 门（number/string/…）；非 prim 期望（对象/数组/函数）→ undefined。 */
function expectedPrim(expected: Abs): TypeofName | undefined {
  const s = expected.shape;
  return s.k === "prim" ? s.type : undefined;
}

/**
 * 实际值是否满足期望（结构面 leqAbs + 值面谓词）。
 * 实际值不是字面量（unknown / 结构值）时**不**做值级判定（判不了 ⇒ 不满足）。
 */
export function caseExpectedSatisfied(actual: Abs, expected: Abs): boolean {
  const pred = expected.pred;
  if (!pred || pred.op === "true") return leqAbs(actual, expected).ok;
  const anchored = anchorPredOnSelf(pred, expectedSelfIds(expected));
  if (!anchored) return leqAbs(actual, expected).ok;
  const lv = litValue(actual);
  if (!lv.ok) return leqAbs(actual, expected).ok;
  // bigint 字面量不在 core 域判定的标量子集内（判不了 ⇒ 不满足）
  if (typeof lv.value === "bigint") return leqAbs(actual, expected).ok;
  const constraint: NudoConstraint = {
    prim: expectedPrim(expected),
    preds: [anchored],
  } as NudoConstraint;
  return literalMeetsConstraint(lv.value, constraint);
}

/** 期望值的可读文本（带谓词）：`number (> 0)` / `number`。 */
export function formatExpected(expected: Abs): string {
  const base = formatShape(expected);
  const pred = expected.pred;
  if (!pred || pred.op === "true") return base;
  const rendered = renderExpectedPred(pred, expectedSelfIds(expected));
  return rendered ? `${base} (${rendered})` : base;
}

function renderExpectedPred(p: Pred, selfIds: Set<string>): string | undefined {
  switch (p.op) {
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge": {
      const op =
        p.op === "eq" ? "=" : p.op === "ne" ? "≠" : p.op === "lt" ? "<" : p.op === "le" ? "≤" : p.op === "gt" ? ">" : "≥";
      const aIsSelf = isSelfTerm(p.a, selfIds);
      const bIsSelf = isSelfTerm(p.b, selfIds);
      const other = aIsSelf ? p.b : bIsSelf ? p.a : undefined;
      if (!other || other.op !== "lit") return undefined;
      const litText =
        other.value === undefined ? "undefined" : JSON.stringify(other.value);
      return `${op} ${litText}`;
    }
    case "typeof":
      return `typeof = "${p.type}"`;
    case "and": {
      const parts = p.args.map((a) => renderExpectedPred(a, selfIds)).filter(Boolean);
      return parts.length > 0 ? parts.join(" ∧ ") : undefined;
    }
    case "or": {
      const parts = p.args.map((a) => renderExpectedPred(a, selfIds)).filter(Boolean);
      return parts.length > 0 ? parts.join(" ∨ ") : undefined;
    }
    case "not": {
      const inner = renderExpectedPred(p.arg, selfIds);
      return inner ? `¬(${inner})` : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * 期望值的「可比较」形态：实际值**已满足**谓词时，把谓词从期望里摘掉
 * （`leqAbs` 不做值级判定；不摘则 test 面的断言恒假红）。不满足时原样保留
 * （`leqAbs` 失败 ⇒ 断言红 + 诊断报出）。
 */
function comparableExpected(actual: Abs, expected: Abs): Abs {
  if (!expected.pred || expected.pred.op === "true") return expected;
  if (!caseExpectedSatisfied(actual, expected)) return expected;
  return { ...expected, pred: undefined };
}

/** 点号名（类方法 `C.m`）——源码里不存在同名可调用表达式。 */
function isDottedName(name: string): boolean {
  return name.includes(".");
}

/**
 * 入口求值采集到的调用点证据落到**已回落 entry@** 的候选上（503）。
 *
 * 调用点位于**导出函数体内**时，被调方的候选先于调用方被处理 ⇒ 那一刻它
 * 还没有调用点证据，只能回落 entry@；等调用方的入口求值跑完，证据才出现。
 * 这里把这类候选的 entry@ 撤掉、改合成 call@ 见证（调用点域恢复 ⇒ 不再
 * 误报 entry-only，`--freeze` 也能固化，`health --from` 的 drift 才有意义）。
 */
function settleEntryOnlyCandidates(env: UncachedCaseEnv): void {
  const registry = env.entryOnlyCandidates;
  if (!registry || registry.size === 0) return;
  const currentModulePath = normalizeModulePath(env.filePath);
  for (const [name, entry] of [...registry.entries()]) {
    // 只处理**导出**函数：调用点域丢失的缺陷面是「导出函数没有调用点域
    // ⇒ 误报 entry-only / 无法固化」；本地非导出函数的入口面保持原样。
    if (!localNamedExports(env.source).has(name)) continue;
    const records = dedupeCallRecords(
      env.callRecords.filter(
        (r) => !isLeakedCallRecord(r) && recordMatchesCandidate(r, name, currentModulePath),
      ),
    );
    if (records.length === 0) continue;
    registry.delete(name);
    // 撤掉 entry@ 见证（改由 call@ 见证承担调用点域）
    const cases = entry.candidate.analysis.cases;
    const idx = cases.indexOf(entry.entryCase);
    if (idx >= 0) cases.splice(idx, 1);
    entry.candidate.analysis.entryOnly = false;
    // 「没有契约根且无调用点域」在有调用点域后不再成立 ⇒ 撤掉该 info
    const di = env.diagnostics.findIndex(
      (d) =>
        d.code === DIAG.interfaceEntryOnly &&
        d.message.includes(`export '${name}'`),
    );
    if (di >= 0) env.diagnostics.splice(di, 1);
    synthesizeCallSiteCases(
      env,
      entry.candidate,
      records,
      analysisConfig(findProjectConfig(dirname(env.filePath))?.config).callSiteBudget,
    );
  }
}

/** 记录是否指向本文件里的候选（名字路 + 模块归属；与主流程同口径）。 */
function recordMatchesCandidate(
  r: CallRecord,
  name: string,
  currentModulePath: string,
): boolean {
  const targetsThisFile =
    r.targetModule === undefined ||
    normalizeModulePath(r.targetModule) === currentModulePath;
  if (!targetsThisFile) return false;
  return (
    r.fnName === name ||
    r.targetExport === name ||
    (r.targetAliases?.includes(name) ?? false)
  );
}

/** 模块路径归一（realpath 对齐符号链接；读不到时回落原路径）。 */
function normalizeModulePath(p: string): string {
  try {
    return realpathSync(resolve(p));
  } catch {
    return resolve(p);
  }
}

/**
 * 调用点见证名（命名规则；service 侧与 LSP 侧共用同一口径）：
 *
 * - 调用点在本文件内 → `call@L<行号>`。行号在被分析文件里**可核对**，
 *   且与既有已固化名字**兼容**（不引起 freeze 抖动）。
 * - 调用点在别的文件（`--from` 使用现场）→ `call@<现场文件相对路径>:L<行号>`。
 *   名字自带**来源限定** ⇒ 两个现场文件在同一行调用同一函数不再撞名；
 *   行号落在**具名文件**里可核对，不再指向被分析文件里的无关行。
 */
export function callsiteCaseName(
  rec: CallRecord,
  analyzedFilePath: string,
  fallbackLine: number,
): string {
  const line = rec.callLoc?.line ?? fallbackLine;
  const site = (rec as CallSiteRecord).callSiteFile;
  if (site === undefined) return `call@L${line}`;
  return `call@${siteLabel(analyzedFilePath, site)}:L${line}`;
}

/** 现场文件相对被分析文件的路径（POSIX 分隔；树外退到 basename）。 */
function siteLabel(analyzedFilePath: string, site: string): string {
  try {
    const rel = relative(dirname(analyzedFilePath), site);
    if (rel && !rel.startsWith("..") && !isAbsolutePath(rel)) return rel.split(sep).join("/");
    if (rel) return rel.split(sep).join("/");
  } catch {
    /* 路径不可比 → 退 basename */
  }
  const base = site.split(/[\\/]/).pop();
  return base && base.length > 0 ? base : site;
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * 类方法（`C.m`）的见证派发。
 *
 * 源码里没有名为 `C.m` 的可调用表达式 ⇒ 以点号名调用必然失败 ⇒ 见证结果
 * 恒 unknown ⇒ 任何期望都必假红。这里按「类 Abs → $new（构造参数 any，
 * 入口无约束口径）→ 原型方法槽 $invoke」链直接派发见证调用；静态方法走
 * 「类 Abs → $invoke（静态槽）」。判不出（类不可见/派发失败）时返回
 * undefined，由调用方回落既有 unknown 路径（诚实：判不了就说判不了）。
 */
function evalClassMethodWitness(
  source: string,
  filePath: string,
  dottedName: string,
  args: Abs[],
  opts: {
    envNames?: string[];
    mocks?: Record<string, Abs>;
    loadModule?: AnalyzeLoadModule;
    depKey?: string | null;
  },
): Abs | undefined {
  const dot = dottedName.indexOf(".");
  if (dot <= 0) return undefined;
  const clsName = dottedName.slice(0, dot);
  const methodName = dottedName.slice(dot + 1);
  if (!methodName) return undefined;
  let clsAbs: Abs | undefined;
  try {
    const run = tryRunEval(source, filePath, {
      envNames: opts.envNames,
      // 类方法见证**不经过** tryEvalCallFull / tryEvalAbsFull（它自己拿类 Abs
      // 再派发方法槽）⇒ mock 作用域选择必须在这里自己做：作用域名是点号名
      // （`C.m`，与指令作用域同名，directive-scan 的 binding name 口径）。
      ...(opts.mocks ? { mocks: mockScopeSelected(opts.mocks, dottedName) } : {}),
      ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
      ...(opts.depKey !== undefined ? { depKey: opts.depKey } : {}),
    });
    const exported = run?.exports?.[clsName] as unknown;
    if (exported && typeof exported === "object" && "shape" in (exported as object)) {
      clsAbs = exported as Abs;
    }
  } catch {
    return undefined;
  }
  if (!clsAbs) return undefined;
  const spec = getEvalClass(clsName);
  const dispatch = (recv: Abs): Abs | undefined => {
    try {
      const r = $invoke(recv, methodName, args);
      if (!r || r.shape.k === "unknown" || r.shape.k === "never") return undefined;
      return r;
    } catch {
      return undefined;
    }
  };
  // 静态方法：类 Abs 上的静态槽（注册表命中 staticMethods 时优先）。
  if (spec?.staticMethods?.[methodName] && !spec?.methods?.[methodName]) {
    return dispatch(clsAbs);
  }
  // 实例方法：类 Abs → $new → 原型方法槽。构造参数按入口口径 any。
  const ctorArity = Math.max(0, (spec?.ctor?.length ?? 1) - 1);
  try {
    const inst = $new(clsAbs, Array.from({ length: ctorArity }, () => anyAbs));
    const r = dispatch(inst);
    if (r) return r;
  } catch {
    /* 构造失败 → 退到静态槽派发 */
  }
  // 静态方法兜底（注册表未登记 / 同名歧义）。
  return dispatch(clsAbs);
}

export function evaluateCaseDirectives(
  env: UncachedCaseEnv,
  fn: CaseDirectiveTarget,
): void {
  const {
    source,
    filePath,
    envNames,
    seeds,
    loadModule,
    fnDepSeg,
    evalHosted,
    selfContained,
    canAbsModules,
    pushMemberDiag: pushBMemberDiag,
    diagnostics,
    caseHints,
    callRecords,
  } = env;
  const { fnLoc, analysis, caseDirectives, caseIdxsToRun, activeCaseIdx } = fn;
    for (const ci of caseIdxsToRun) {
      const directive = caseDirectives[ci]!;

      let caseAbs: Abs | undefined;
      let caseThrowsAbs: Abs | undefined;
      let caseThrowLoc: SourceLocation | undefined;

      if (filePath) {
        const caseArgsAbs = directive.argsAbs;
        const evalFull = tryEvalCallFull(
          source,
          filePath,
          fn.name,
          caseArgsAbs,
          {
            collectCalls: true,
            envNames,
            mocks: mockSeedsToAbsMocks(seeds),
            ...(loadModule ? { loadModule } : {}),
            depKey: fnDepSeg,
          },
        );
        const res = evalFull?.result;
        const weakUnknown =
          !!res &&
          res.shape.k === "unknown" &&
          (!res.term || (res.term.op === "lit" && res.term.value === undefined));
        const evalOk = !!res && (evalHosted || (!weakUnknown && res.conf !== "opaque"));
        if (evalOk && evalFull) {
          caseAbs = evalFull.result;
          caseThrowsAbs = evalFull.throws;
          for (const d of evalFull.memberDiags ?? []) {
            pushBMemberDiag(d, fnLoc.start.line);
          }
          if (evalFull.calls?.length) {
            const impMap = buildAbsImportLocalMap(source, filePath);
            for (const c of evalFull.calls) {
              callRecords.push(callRecordFromAbsCall(c, impMap));
            }
          }
        } else if (!evalFull && isDottedName(fn.name)) {
          // 类方法（`C.m`）：源码里没有名为 "C.m" 的可调用表达式 ⇒
          // tryEvalCallFull 必然失败 ⇒ 见证恒 unknown（假红）。改走
          // 「类 Abs → $new → 原型方法槽 $invoke」链直接派发见证调用
          // （点号名只作展示名，不作被调表达式）。
          const methodAbs = evalClassMethodWitness(source, filePath, fn.name, caseArgsAbs, {
            envNames,
            mocks: mockSeedsToAbsMocks(seeds),
            ...(loadModule ? { loadModule } : {}),
            depKey: fnDepSeg,
          });
          if (methodAbs) {
            caseAbs = methodAbs;
            caseThrowsAbs = neverAbs;
          }
        }
      }

      if (!caseAbs) {
        if (evalHosted) {
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
        // 期望值落成可比较形态（实际值已满足谓词时摘掉 pred）——
        // 下游（nudo test 报告面）用 leqAbs 判定，值级语义在此归一。
        expected: directive.expected
          ? comparableExpected(caseAbs, directive.expected)
          : directive.expected,
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
          // 值级判定（谓词面）+ 结构判定：number().gt(0) 这类期望不再恒假红
          ok = caseExpectedSatisfied(caseAbs, directive.expected);
          if (!ok) {
            diagnostics.push({
              range: { start: { line: directive.commentLine, column: 0 }, end: { line: directive.commentLine, column: 999 } },
              severity: "error",
              message: `debug "${directive.name}": expected ${formatExpected(directive.expected)}, got ${formatShape(caseAbs)}. The inferred return type does not match the expected type declared in the @nudo:case witness`,
              code: DIAG.caseExpected,
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
            code: DIAG.mayThrow,
          });
        }
        // unreachable 诊断已由文件级 collectEvalDiagnostics 统一上报（无 case 级重复扫描）
      }
    }
  // 已固化（`call@` 指令）的函数：把**新**调用点也合成成 callsite 见证，
  // 否则二次 freeze 看不到新增调用点（函数级「已有 case 指令」会吞掉它们）。
  // 只针对「指令名全是 call@」的函数——手写 case 的函数不受影响。
  synthesizeFrozenCallSiteCases(env, fn);
}

/**
 * 已固化函数的**新增**调用点 → callsite 见证（465 症状 3）。
 *
 * 已固化的见证名（`call@<现场>:L<行>`）已在指令里 ⇒ 不重复合成；名字不同的
 * （新增调用点）才合成 ⇒ 二次 freeze 能把新见证追加进源码。
 *
 * 只取**外部**记录（`--from` 现场）：本地调用点的见证名带**本文件行号**，
 * 固化会往文件里插 JSDoc 块 ⇒ 行号漂移 ⇒ 名字对不上已固化的见证 ⇒ 会写出
 * 同一调用点的重复见证。外部现场文件不改 ⇒ 名字稳定 ✔。
 */
function synthesizeFrozenCallSiteCases(env: UncachedCaseEnv, fn: CaseDirectiveTarget): void {
  const { analysis, caseDirectives } = fn;
  const filePath = env.filePath;
  if (caseDirectives.length === 0) return;
  // 只处理「已固化」：指令名全部是 call@ 形态（手写 case 不动）
  if (!caseDirectives.every((d) => d.name.startsWith("call@"))) return;
  const external = env.externalCallRecords;
  if (!external || external.length === 0) return;
  const budget = analysisConfig(findProjectConfig(dirname(filePath))?.config).callSiteBudget;
  const currentModulePath = normalizeModulePath(filePath);
  const records = dedupeCallRecords(
    external.filter(
      (r) =>
        !isLeakedCallRecord(r) &&
        (normalizeModulePath(r.fnModule ?? r.targetModule ?? "") === currentModulePath) &&
        recordMatchesCandidate(r, fn.name, currentModulePath),
    ),
  );
  if (records.length === 0) return;
  // 已固化的见证名：不再重复合成
  const frozenNames = new Set(caseDirectives.map((d) => d.name));
  const fresh = records.filter(
    (r) => !frozenNames.has(callsiteCaseName(r, filePath, analysis.loc.start.line)),
  );
  if (fresh.length === 0) return;
  // 超预算会额外产出 call@symbolic 聚合见证（不可固化成指令）→ 保守不合成
  if (fresh.length > budget) return;
  synthesizeCallSiteCases(
    env,
    { name: fn.name, analysis },
    fresh,
    budget,
  );
}

export function synthesizeCallSiteCases(
  env: UncachedCaseEnv,
  candidate: SynthCandidate,
  records: CallRecord[],
  callSiteBudget: number,
): void {
  const { source, filePath, envNames, seeds, loadModule, fnDepSeg, evalHosted } = env;
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
        // 记录自带的无损结果 Abs：重求值失败/跳过时作兜底（evaluator 产物）
        if (!absRaw && rec.resultAbs.shape.k !== "never") {
          absRaw = rec.resultAbs;
        }
        // 见证值 = 闸门后的值（重求值只在「更有信息量」时替换观测值）。
        // 观测值是**调用现场语境**下的真值；重求值跑在**被分析文件语境**里
        // （模块状态不同 ⇒ 值可能不同），不得越过闸门覆盖观测值。
        const caseAbs = absResult ?? rec.resultAbs;
        const caseResult: CaseResult = {
          name: callsiteCaseName(rec, filePath, candidate.analysis.loc.start.line),
          argAbs: [...rec.argAbs],
          abs: caseAbs,
          throwsAbs: rec.throwsAbs,
          source: "callsite",
        };
        tryAttachIntension(caseResult, source, candidate.name);
        // 挂**闸门后**的值（caseAbs），不挂重求值原值：后者会在闸门判定
        // 「观测值已足够精确」时用**目标语境**的值覆盖**现场语境**的观测值
        // （模块状态不同时值不同 ⇒ 报告出的调用点真值与实际调用结果矛盾）。
        if (absRaw) attachAbsToIntension(caseResult, caseAbs, candidate.name);
        candidate.analysis.cases.push(caseResult);
      }
      // symbolic 聚合只用全已知实参的记录：含 unknown 分量的记录不可重求值
      // （unknown 吸收整个 union，一条循环引用 fixture 的记录就能毒化全部
      // 剩余聚合——clone 704 条中的 53 条 unknown 实参曾拖垮其余 651 条）。
      // 排除不声明覆盖，sound；全部不可求值时不产 symbolic case（诚实）。
      const remaining = ordered
        .slice(callSiteBudget)
        .filter((rec) => !rec.argAbs.some((a) => a.shape.k === "unknown" && !a.term));
      if (remaining.length > 0 && candidate.node) {
        const fnNode = resolveFunctionNode(candidate.node);
        const paramCount = extractParamNames(fnNode).length;
        const widenedArgsAbs = Array.from({ length: paramCount }, (_, i) =>
          // 缺参按真实 JS 语义 widen 成 undefined 而非 unknown——可选参守卫
          // （target || [] 等）对 unknown 全塌，对 undefined 正常走默认分支
          widenJoinAbs(remaining.map((rec) => rec.argAbs[i] ?? undefAbs)),
        );
        // 求值引擎优先；否则 Abs 优先
        let symAbs: Abs | undefined;
        if (filePath) {
          const evalSym = tryEvalCall(
            source,
            filePath,
            candidate.name,
            widenedArgsAbs,
            {
              envNames,
              mocks: mockSeedsToAbsMocks(seeds),
              ...(loadModule ? { loadModule } : {}),
              depKey: fnDepSeg,
            },
          );
          if (evalSym && (evalHosted || !(evalSym.shape.k === "unknown" && !evalSym.term))) {
            symAbs = evalSym;
          }
        }
        if (!symAbs && !evalHosted) {
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
}

/**
 * rest 形参的入口实参：**变长**（元素未知的数组 Abs）。
 *
 * Bug 1008：入口兜底只造**一个**占位实参 ⇒ `...xs` 的长度被观测成字面量 1
 * ⇒ 投影面把这次兜底观测当出口域（`literal(1)`），导出校验器拒绝被导出
 * 函数自己的返回值（dts 面写 number ⇒ 四方言矛盾）。变长实参让
 * `xs.length` 落到 `number`（长度不确信 ⇒ 不是字面量）。
 */
function restEntryArgAbs(): Abs {
  return makeAbsVal({ k: "arr", element: anyAbs }, undefined, undefined, "partial");
}

export function evaluateEntryCase(env: UncachedCaseEnv, candidate: SynthCandidate): void {
  const {
    source,
    filePath,
    envNames,
    seeds,
    loadModule,
    fnDepSeg,
    evalHosted,
    pushMemberDiag: pushBMemberDiag,
    diagnostics,
  } = env;
    const fnNode = candidate.node ? resolveFunctionNode(candidate.node) : undefined;
    // 入口无约束参数 = any（design-cli-semantics §2）；不是 unknown（推导失败）
    //
    // Bug 479：`.ts` 源的形参带**声明类型**（剥除 pass 的旁路 `nudoTypeText`，
    // 经 `FormalParam.tsType` 带出）⇒ 入口实参按声明类型构造 Abs，而不是一律
    // any。效果：① `nudo test` 的 entry@ 实参显示真实类型；② 合法 TypeScript
    // 不再因「参数无约束」产生 `a.toUpperCase()` 之类的假红（成员访问落在
    // string 形状上 ⇒ 不抛）。
    // 无注解（.js 源 / 未标注）或不可映射的类型（别名、泛型、对象类型）⇒
    // 仍是 any（不猜）——与 core `ts-type-shape.ts` 同口径。
    //
    // Bug 1008：rest 形参按**变长**造实参（元素未知的数组 Abs），不能按一个
    // 占位实参造——否则 `withRest(...xs){ return xs.length; }` 的兜底观测会把
    // `xs.length` 记成字面量 1 ⇒ 三方言（zod / standard / guard）把这次兜底
    // 观测当出口域（literal(1)），导出校验器拒绝被导出函数自己的返回值；dts
    // 面写 number ⇒ 四方言矛盾。
    const argAbsEntry = (fnNode ? extractFormals(fnNode) : []).map((f) =>
      f.kind === "rest" ? restEntryArgAbs() : tsAnnotationArgAbs(f.tsType),
    );
    // Bug 511：domainOnly 模式（函数已带点观测见证）——入口求值只为产出推断域。
    const domainOnly = candidate.domainOnly === true;
    const callRecordsBefore = env.callRecords.length;
    // evaluator 唯一求值；失败 fail-closed（entryAbs 保持 undefined）
    let entryAbs: Abs | undefined;
    let entryThrowsAbs: Abs = makeAbsVal({ k: "never" }, undefined, undefined, "exact");
    const entryEffects: MayThrowEffect[] = [];
    setMayThrowCollector((e) => entryEffects.push(e));
    try {
      if (filePath) {
        const evalEntryFull =
          tryEvalCallFull(
            source,
            filePath,
            candidate.analysis.name,
            argAbsEntry,
            {
              envNames,
              mocks: mockSeedsToAbsMocks(seeds),
              collectMemberDiags: true,
              // 函数体内的调用点证据（被调函数在本文件其它函数体内被调用）
              // —— 入口求值时一并采集，落进共享 callRecords ⇒ 被调方能
              // 合成 call@ 见证（否则永远只有 entry@ ⇒ 调用点域丢失）。
              collectCalls: true,
              ...(loadModule ? { loadModule } : {}),
              depKey: fnDepSeg,
            },
          ) ??
          (candidate.assignedName
            ? tryEvalCallFull(source, filePath, candidate.assignedName, argAbsEntry, {
                envNames,
                mocks: mockSeedsToAbsMocks(seeds),
                ...(loadModule ? { loadModule } : {}),
                depKey: fnDepSeg,
              })
            : undefined);
        if (evalEntryFull?.memberDiags?.length) {
          for (const d of evalEntryFull.memberDiags) {
            pushBMemberDiag(d, candidate.analysis.loc.start.line);
          }
        }
        if (evalEntryFull?.calls?.length) {
          // 入口求值期间在**函数体内**发生的调用 ⇒ 调用点证据（503）。
          // 并入共享 callRecords：被调方（若尚未处理）随后能合成 call@ 见证。
          const impMap = buildAbsImportLocalMap(source, filePath);
          for (const c of evalEntryFull.calls) {
            env.callRecords.push(callRecordFromAbsCall(c, impMap));
          }
        }
        const evalEntry = evalEntryFull?.result;
        if (evalEntry && (evalHosted || !(evalEntry.shape.k === "unknown" && !evalEntry.term))) {
          entryAbs = evalEntry;
          if (evalEntryFull?.throws) entryThrowsAbs = evalEntryFull.throws;
        }
      }
      if (!entryAbs) {
        if (evalHosted) {
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
    // Bug 511（domainOnly 模式）：这次入口求值只为产出**推断域**——它带出的
    // 调用点证据**不并入**共享台账（否则一次为取域而做的求值会污染别的函数
    // 的证据面：被调方凭空多出一条 call@ 见证）。
    if (domainOnly && env.callRecords.length > callRecordsBefore) {
      env.callRecords.length = callRecordsBefore;
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
    // Bug 1008：rest 形参的 entry@ 兜底观测**长度是合成调用元数的产物**
    // （`...xs` 把那一个占位实参收进数组 ⇒ `xs.length` = 1），不是函数的行为
    // ⇒ 该观测不确信（conf `partial`）⇒ 投影面可放宽成基类型，不把这次兜底
    // 观测当出口域（zod/standard/guard 投影成 literal(1) ⇒ 导出校验器拒绝被
    // 导出函数自己的返回值；dts 面写 number ⇒ 四方言矛盾）。
    const hasRestFormal = (fnNode ? extractFormals(fnNode) : []).some((f) => f.kind === "rest");
    const entryWitnessAbs =
      hasRestFormal && entryAbs && entryAbs.conf === "exact"
        ? { ...entryAbs, conf: "partial" as const }
        : entryAbs;
    const caseResult: CaseResult = {
      name: `entry@L${candidate.analysis.loc.start.line}`,
      argAbs: argAbsEntry,
      abs: entryWitnessAbs,
      throwsAbs: entryThrowsAbs,
    };
    // display 来自 generalize；attachAbs 补无损 abs 字段（后写覆盖 abs/conf）
    tryAttachIntension(caseResult, source, candidate.analysis.name);
    attachAbsToIntension(caseResult, entryWitnessAbs, candidate.analysis.name);
    candidate.analysis.cases.push(caseResult);
    candidate.analysis.entryOnly = true;
    candidate.analysis.combinedAbs = entryWitnessAbs;
    attachHofSnapshot(candidate.analysis, source);
    // 登记为「已回落 entry@」：调用点证据可能**稍后**才出现（调用点在
    // 别的函数体内 ⇒ 被调方先于调用方被处理）——见 settleEntryOnlyCandidates。
    env.entryOnlyCandidates ??= new Map();
    env.entryOnlyCandidates.set(candidate.analysis.name, { candidate, entryCase: caseResult });
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
        // 侧车**加载失败**与「根本没有侧车」必须可区分：加载失败已由 core
        // 侧 nudo:interface-load 通道上报，这里取走新诊断并转成 error 诊断
        // （test 面此前**不收集**该通道 ⇒ 坏侧车在 test 面彻底隐形），
        // 且**不再**发「没有契约根」——那条 info 的事实陈述在侧车存在时
        // 是错的（用户明明写了契约，只是写坏了），修复建议也会误导。
        const ifaceSince = interfaceDiagCount();
        const eff = effectiveInterface(source, candidate.analysis.name, {
          loadModule: loadModule ?? defaultLoadModule,
          fromFile: filePath,
          ...(autoBind === false ? { autoBind: false } : {}),
        });
        const loadDiags = takeInterfaceDiagsSince(ifaceSince).filter(
          (d) => d.code === DIAG.interfaceLoad,
        );
        if (loadDiags.length > 0) {
          env.sidecarLoadFailed = true;
          for (const d of loadDiags) {
            diagnostics.push({
              range: {
                start: candidate.analysis.loc.start,
                end: candidate.analysis.loc.start,
              },
              severity: "error",
              message: d.message,
              code: d.code,
            });
          }
        }
        // domainOnly（Bug 511）：函数已带 case 见证 ⇒ 它**有**证据（只是不是域
        // 声明）⇒ 不发「没有调用点域」的 entry-only info（该 info 说的是
        // 「没有契约根且没有调用点域」，与带见证的事实不符）。
        if (!eff && !env.sidecarLoadFailed && !domainOnly) {
          diagnostics.push({
            range: {
              start: candidate.analysis.loc.start,
              end: candidate.analysis.loc.start,
            },
            severity: "info",
            message: `export '${candidate.analysis.name}' has no contract root and no call-site domain (entry-only)`,
            code: DIAG.interfaceEntryOnly,
          });
        }
      }
    } catch {
      /* 诊断不得打断分析 */
    }
    // 入口求值可能带出了**别的**候选的调用点证据（调用点在函数体内）——
    // 此刻才出现的证据要落到那些「先回落 entry@」的候选上（503）。
    settleEntryOnlyCandidates(env);
}
