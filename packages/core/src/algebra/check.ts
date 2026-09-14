/**
 * nudo check 门禁：对源码跑代数分析，产出 error/warning。
 *
 * 报告是 **Nudo 原生格式**（Abs 优先），不是 TS 诊断的换皮：
 * - 签名表给出无损 Abs（shape/term/pred/conf）
 * - 违例写清 actual ⊭ expected（实参 Abs vs 前置 Pred）
 * - dts/TS 兼容不是本报告的职责
 */

import { parseSource as parse } from "./parse-source.ts";
import type { Node } from "@babel/types";
import {
  analyzeFn,
  evalProgramAbs,
  evalNode,
  emptyEnv,
  setAbsAssignCollector,
  setAbsTruncationCollector,
  resetAbsCallBudget,
  type AbsAssignRecord,
} from "./ast-eval.ts";
import { defaultLeakBudget } from "./leak.ts";
import { leqAbs } from "./leq.ts";
import {
  refineToIndexedFull,
  extractRefineReturnFromSource,
  type RefineEntry,
} from "./refine.ts";
import type { NudoConstraint, NudoField } from "./constraint.ts";
import { extractFn, generalizeFromAst } from "./generalize.ts";
import { canSkipLiteralCallScan } from "./fn-fp.ts";
import { stableAnalyzeKeySource } from "./stable-source-key.ts";
import { hashSource, resetHashSourceCache } from "./hash-source.ts";
import {
  extractAllLoadSpecs,
  loadModuleDepsFingerprint,
  normPath,
  type LoadDepsFingerprint,
} from "./load-deps-fp.ts";
import { numLit, unknown, abs as makeAbs } from "./abs.ts";
import type { Abs } from "./abs.ts";
import type { Phi, Pred } from "./pred.ts";
import { pTrue, predToString } from "./pred.ts";
import { termToString } from "./term.ts";
import { litValue } from "./abs.ts";
import { formatAbs, formatAbsMultiline, formatShape } from "./format.ts";
import { checkCall } from "./diagnostics.ts";
import type { CheckIssue, CheckReport, NudoSig } from "./check-report.ts";
import { getFnImpl } from "./abs-fn.ts";
import type { PolyFn } from "./generalize.ts";

/**
 * HOF 实参是否满足目标 fn 形状。
 * 自定义放宽比较：JS 允许多余实参（src.params.length >= tgt.params.length）。
 * 不直接喂 leqAbs（arity 严格相等对 JS 太严）。
 */
function hofFnArgOk(src: Abs, tgt: Abs): boolean {
  if (src.shape.k !== "fn") return false;
  const t = tgt.shape;
  if (t.k !== "fn") return false;
  // arity：JS 允许多余实参
  if (src.shape.params.length < t.params.length) return false;
  // 有 returnType 槽时不要求 src 也有（弱信息可接受）
  return true;
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

export function getCheckSourceMemoSize(): number {
  return checkReportMemo.size;
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
    return { fp: "-", paths: [], truncated: false };
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
    })),
    summary: { ...r.summary },
  };
}

function checkMemoKey(
  filePath: string,
  source: string,
  identityOpts: CheckOptions,
  deps: LoadDepsFingerprint,
): string {
  // identity must stay the caller's raw loadModule or every checkSource
  // allocates a new loadModuleId and memo never hits.
  return [
    hashSource(source),
    filePath,
    `${loadModuleId(identityOpts.loadModule)}:${identityOpts.fromFile ?? ""}`,
    deps.fp,
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
};

function listTopFunctions(source: string, file?: ReturnType<typeof parse>): string[] {
  const f = file ?? parse(source);
  const names: string[] = [];
  for (const stmt of f.program.body) {
    let decl: Node = stmt;
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    if (decl.type === "FunctionDeclaration" && decl.id) names.push(decl.id.name);
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (
          d.id.type === "Identifier" &&
          d.init &&
          (d.init.type === "ArrowFunctionExpression" ||
            d.init.type === "FunctionExpression")
        ) {
          names.push(d.id.name);
        }
      }
    }
  }
  return names;
}

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

  const useMemo = phi.op === "true";
  let memoKey: string | undefined;
  // 尾部无 @nudo 的注释/空行不进键：comment-only 编辑复用 CheckReport
  const stable = stableAnalyzeKeySource(source);
  // 一次指纹：check 整文件 memo + 所有 generalize L0 共用（避免 per-fn 重读 dep）
  const depsFp = checkDepsFingerprint(stable, callOpts);
  // 截断指纹不可信：fail-open，整文件与 L0 都不 memo
  const allowMemo = useMemo && !depsFp.truncated;
  if (allowMemo) {
    memoKey = checkMemoKey(filePath, stable, opts, depsFp);
    const hit = checkMemoGet(memoKey);
    if (hit) return cloneCheckReport(hit);
  }

  const issues: CheckIssue[] = [];
  const signatures: NudoSig[] = [];
  // 单次 parse：listTopFunctions / generalize / analyzeFn / scan 共用
  const file = parse(source);
  const names = listTopFunctions(source, file);

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
    );
    if (memoKey) checkMemoSet(memoKey, report, depsFp.paths);
    return cloneCheckReport(report);
  } finally {
    setAbsTruncationCollector(null);
  }
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
): CheckReport {
  // 整文件一次判定，避免 per-function includes 全文扫
  const hasRefineDirective = source.includes("@nudo:refine");
  // generalize L0 用调用方原始 loadModule 身份；opts 可能是 per-call I/O wrapper
  const refineLoad = identityOpts.loadModule ?? opts.loadModule;
  const refineFrom = identityOpts.fromFile ?? opts.fromFile ?? filePath;
  for (const name of names) {
    const g = generalizeFromAst(name, source, {
      file,
      refine: {
        loadModule: refineLoad,
        fromFile: refineFrom,
      },
      depsFp,
    });
    if (!g) {
      issues.push({
        severity: "warning",
        code: "nudo:no-signature",
        message: `${name}: 无法归纳符号 Abs`,
        suggestion: "补 @nudo:case 或让函数体可代数求值",
        fn: name,
      });
      continue;
    }
    // L0 命中时 symbolic 是稳定对象：格式化结果可 WeakMap 复用
    const fmt = formatSigCached(g.symbolic, name);
    signatures.push({
      name,
      params: g.params,
      abs: g.symbolic,
      display: fmt.display,
      detail: fmt.detail,
      conf: g.symbolic.conf,
    });

    // 后置：@nudo:refine return <constraint> —— 推断返回值 ⊭ 契约
    if (hasRefineDirective) {
      const ret = extractRefineReturnFromSource(source, name, {
        loadModule: refineLoad,
        fromFile: refineFrom,
      });
      if (ret) {
        issues.push(
          ...checkReturnConstraint(name, ret.name, ret.constraint, g.symbolic),
        );
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

  // 一次 evalProgramAbs：结构赋值记录 + 顶层绑定表（scanLiteralCalls 实参解析用）
  const records: AbsAssignRecord[] = [];
  const varAbs = new Map<string, Abs>();
  setAbsAssignCollector((r) => records.push(r));
  try {
    const { env } = evalProgramAbs(source, { file });
    for (const [k, v] of env.vars) varAbs.set(k, v);
  } catch {
    /* 求值失败：无赋值记录、无绑定表 */
  } finally {
    setAbsAssignCollector(null);
  }

  const callIssues = canSkipLiteralCallScan(source, file)
    ? []
    : scanLiteralCalls(source, names, phi, {
        loadModule: opts.loadModule,
        fromFile: filePath,
        file,
        varAbs,
      });
  issues.push(...callIssues);

  // case 是见证：@nudo:case 实参 ⊄ refine → inconsistency
  issues.push(
    ...scanCaseInconsistency(source, names, {
      loadModule: opts.loadModule,
      fromFile: filePath,
      file,
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

function absUnknown(): Abs {
  return { shape: { k: "unknown" }, conf: "partial" };
}

/** L0 命中的 symbolic 对象稳定：display/detail 按 Abs 身份缓存 */
const sigFormatCache = new WeakMap<Abs, { display: string; detail: string }>();

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
      const slot = slots[key];
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
  return out;
}

/**
 * 结构可赋值：`let a = {x:1}; a = {y:2}` 应报 missing slot x。
 * 输入为 evalProgramAbs 收集的赋值记录（与 scanLiteralCalls 共享一次求值）。
 */
function structuralAssignIssues(records: AbsAssignRecord[]): CheckIssue[] {
  const out: CheckIssue[] = [];
  for (const r of records) {
    if (!r.prev) continue;
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
 */
function scanCaseInconsistency(
  source: string,
  knownFns: string[],
  opts: {
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    fromFile?: string;
    file?: ReturnType<typeof parse>;
  },
): CheckIssue[] {
  const out: CheckIssue[] = [];
  // 快路径：无 case 指令则免整树 walk；无 refine 时 case 不可能 ⊄ 契约
  if (!source.includes("@nudo:case")) return out;
  if (!source.includes("@nudo:refine")) return out;
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
    const reqs = refineToIndexedFull(source, fnName, paramNames, {
      loadModule: opts.loadModule,
      fromFile: opts.fromFile ?? "",
    });
    if (reqs.length === 0) return;

    const absArgs = args.map((a) => parseLitArg(a) ?? absUnknown());
    // 标量界
    for (const [idx, entry] of reqs) {
      if (entry.constraint.fields) continue;
      const arg = absArgs[idx];
      if (!arg) continue;
      const lv = litValue(arg);
      if (lv === undefined || typeof lv !== "number") continue;
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

/** 从函数体抽参数必填 slot：`function f(p){ return p.x + p.y }` → {p: {x,y}} */
function collectParamStructReqs(
  source: string,
  fnName: string,
  fileAst?: ReturnType<typeof parse>,
): Map<string, Set<string>> {
  const reqs = new Map<string, Set<string>>();
  // 只走目标函数自身的 body：走整个文件会把同名参数在兄弟函数里的
  // 访问（p.y）漏进本函数的必填 slot（p.x），造成跨函数污染。
  const extracted = extractFn(source, fnName, fileAst);
  if (!extracted) return reqs;
  const params = new Set(extracted.params);
  const body = extracted.body;

  /** 方法名（数组/字符串内置）——`p.some` / `p.replace` 不是数据字段 */
  const BUILTIN_METHODS = new Set([
    "map", "filter", "reduce", "flatMap", "forEach", "some", "every", "find",
    "findIndex", "includes", "indexOf", "lastIndexOf", "join", "slice", "splice",
    "push", "pop", "shift", "unshift", "sort", "reverse", "concat", "at",
    "replace", "replaceAll", "split", "trim", "toLowerCase", "toUpperCase",
    "startsWith", "endsWith", "charAt", "charCodeAt", "padStart", "padEnd",
    "repeat", "toString", "valueOf", "substring", "match", "search",
    "hasOwnProperty", "keys", "values", "entries", "then", "catch", "finally",
  ]);

  const visit = (n: unknown, isMethodCallee = false): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };
    if (obj.type === "MemberExpression" && !obj.computed && !isMethodCallee) {
      const o = obj.object as { type?: string; name?: string } | undefined;
      const p = obj.property as { type?: string; name?: string } | undefined;
      if (o?.type === "Identifier" && o.name && params.has(o.name) && p?.type === "Identifier" && p.name) {
        // 方法调用（p.some()）或内置方法名 → 不是必填数据字段
        if (BUILTIN_METHODS.has(p.name)) return;
        let set = reqs.get(o.name);
        if (!set) {
          set = new Set();
          reqs.set(o.name, set);
        }
        set.add(p.name);
      }
    }
    if (obj.type === "CallExpression") {
      // callee 上的 p.method 是方法调用，不进必填 slot
      visit(obj.callee, true);
      for (const key of Object.keys(obj)) {
        if (key === "loc" || key === "start" || key === "end" || key === "callee") continue;
        const val = obj[key];
        if (Array.isArray(val)) val.forEach((v) => visit(v, false));
        else if (val && typeof val === "object") visit(val, false);
      }
      return;
    }
    for (const key of Object.keys(obj)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const val = obj[key];
      if (Array.isArray(val)) val.forEach((v) => visit(v, isMethodCallee));
      else if (val && typeof val === "object") visit(val, isMethodCallee);
    }
  };
  visit(body);
  return reqs;
}

/** 静态求值实参节点 → Abs（标识符走绑定表；对象/数组字面量内的标识符也走绑定表） */
function evalArgAbs(
  node: Record<string, unknown>,
  lookupVar?: (name: string) => Abs | undefined,
): Abs | undefined {
  if (node.type === "Identifier" && typeof node.name === "string" && lookupVar) {
    return lookupVar(node.name);
  }
  try {
    const env = emptyEnv();
    // 把文件级绑定表灌进 env，使 `{...base}` / `[x]` 等复合实参能解析标识符
    if (lookupVar) {
      // lookupVar 只支持按名查；用 Proxy 包一层 vars 不可行——改为在
      // evalNode 前手工预绑定已知名。scanLiteralCalls 的 varAbs 通常很小。
      // 这里通过包装 env.vars 的 get 实现按需注入。
      const rawGet = env.vars.get.bind(env.vars);
      env.vars.get = ((name: string) => {
        const hit = rawGet(name);
        if (hit !== undefined) return hit;
        return lookupVar(name);
      }) as typeof env.vars.get;
    }
    return evalNode(node as unknown as Node, env, pTrue, defaultLeakBudget).value;
  } catch {
    return undefined;
  }
}

/** 扫描前收集：别名 / 对象属性 / require 导入 */
type CallResolve = {
  /** 本地名 → 真实函数名（同文件） */
  aliasToFn: Map<string, string>;
  /** 对象名.属性名 → 真实函数名（同文件） */
  memberToFn: Map<string, string>;
  /** 本地名 → 外部模块函数（源码 + 导出名） */
  externalFn: Map<string, { source: string; fnName: string }>;
  /** 对象名.属性名 → 外部模块函数 */
  externalMember: Map<string, { source: string; fnName: string }>;
};

function requireSpecOf(init: Record<string, unknown>): string | undefined {
  // require('./x')
  if (init.type === "CallExpression") {
    const callee = init.callee as { type?: string; name?: string } | undefined;
    const args = init.arguments as Array<{ type?: string; value?: unknown }> | undefined;
    if (
      callee?.type === "Identifier" &&
      callee.name === "require" &&
      args?.[0]?.type === "StringLiteral"
    ) {
      return String(args[0].value);
    }
  }
  // require('./x').fn
  if (init.type === "MemberExpression") {
    const obj = init.object as Record<string, unknown> | undefined;
    if (obj) return requireSpecOf(obj);
  }
  return undefined;
}

function requireExportName(init: Record<string, unknown>): string | undefined {
  // require('./x').fn
  if (init.type === "MemberExpression" && !init.computed) {
    const prop = init.property as { type?: string; name?: string } | undefined;
    if (prop?.type === "Identifier") return prop.name;
  }
  return undefined;
}

/** `await import('./m')` / `import('./m')` → spec */
function dynamicImportSpec(node: Record<string, unknown>): string | undefined {
  let n: Record<string, unknown> | undefined = node;
  if (n?.type === "AwaitExpression") {
    n = n.argument as Record<string, unknown> | undefined;
  }
  if (n?.type !== "CallExpression") return undefined;
  const callee = n.callee as { type?: string } | undefined;
  // Babel: dynamic import callee.type === "Import"
  if (callee?.type !== "Import") return undefined;
  const args = n.arguments as Array<{ type?: string; value?: unknown }> | undefined;
  if (args?.[0]?.type === "StringLiteral") return String(args[0].value);
  return undefined;
}

/**
 * 模块源码里找不到 fnName 时，沿 `export { fn } from './other'` / `export * from` 一跳跟进。
 * 返回定义了该函数的源码。
 */
function resolveExportSource(
  modSrc: string,
  fnName: string,
  loadSpec: (spec: string) => string | undefined,
  depth = 0,
): string {
  if (depth > 3) return modSrc;
  try {
    if (listTopFunctions(modSrc).includes(fnName)) return modSrc;
  } catch {
    return modSrc;
  }
  const file = parse(modSrc);
  let nextSpec: string | undefined;
  for (const stmt of file.program.body) {
    if (stmt.type !== "ExportNamedDeclaration" && stmt.type !== "ExportAllDeclaration") continue;
    const src = (stmt as { source?: { type?: string; value?: unknown } }).source;
    if (src?.type !== "StringLiteral" || typeof src.value !== "string") continue;
    if (stmt.type === "ExportAllDeclaration") {
      nextSpec = String(src.value);
      break;
    }
    const clause = ((stmt as { specifiers?: unknown[] }).specifiers ?? []) as Array<Record<string, unknown>>;
    for (const sp of clause) {
      if (sp.type !== "ExportSpecifier") continue;
      const local = sp.local as { type?: string; name?: string } | undefined;
      if (local?.type === "Identifier" && local.name === fnName) {
        nextSpec = String(src.value);
        break;
      }
    }
    if (nextSpec) break;
  }
  if (!nextSpec) return modSrc;
  const next = loadSpec(nextSpec);
  if (!next) return modSrc;
  return resolveExportSource(next, fnName, loadSpec, depth + 1);
}

/** 只递归可能含 Import/VariableDeclaration 的语句容器（resolvers/forwarders 用） */
const STMT_CONTAINER = new Set([
  "File",
  "Program",
  "BlockStatement",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "SwitchCase",
  "TryStatement",
  "CatchClause",
  "LabeledStatement",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "ClassDeclaration",
  "ClassBody",
  "ClassMethod",
  "StaticBlock",
  "ObjectMethod",
]);

function walkStatements(n: unknown, onStmt: (obj: Record<string, unknown> & { type?: string }) => void): void {
  if (!n || typeof n !== "object") return;
  const obj = n as Record<string, unknown> & { type?: string };
  if (typeof obj.type === "string") onStmt(obj);
  if (!STMT_CONTAINER.has(String(obj.type))) return;
  for (const key of Object.keys(obj)) {
    if (key === "loc" || key === "start" || key === "end" || key === "leadingComments") continue;
    const val = obj[key];
    if (Array.isArray(val)) val.forEach((x) => walkStatements(x, onStmt));
    else if (val && typeof val === "object") walkStatements(val, onStmt);
  }
}

function collectCallResolvers(
  source: string,
  knownFns: string[],
  opts?: {
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    fromFile?: string;
    file?: ReturnType<typeof parse>;
  },
): CallResolve {
  const knownSet = new Set(knownFns);
  const aliasToFn = new Map<string, string>();
  const memberToFn = new Map<string, string>();
  const externalFn = new Map<string, { source: string; fnName: string }>();
  const externalMember = new Map<string, { source: string; fnName: string }>();
  const file = opts?.file ?? parse(source);
  const load = opts?.loadModule;
  const fromFile = opts?.fromFile ?? "";
  const modCache = new Map<string, string | undefined>();
  const loadSpec = (spec: string): string | undefined => {
    if (!load) return undefined;
    if (!modCache.has(spec)) modCache.set(spec, load(spec, fromFile));
    return modCache.get(spec);
  };
  const bindExternal = (local: string, modSrc: string, fnName: string): void => {
    externalFn.set(local, {
      source: resolveExportSource(modSrc, fnName, loadSpec),
      fnName,
    });
  };

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };

    // ESM：import { fn } / import { fn as x } / import * as ns from '...'
    if (obj.type === "ImportDeclaration") {
      const spec = obj.source as { type?: string; value?: unknown } | undefined;
      if (spec?.type === "StringLiteral" && typeof spec.value === "string") {
        const modSrc = loadSpec(String(spec.value));
        if (modSrc) {
          for (const sp of (obj.specifiers as Array<Record<string, unknown>> | undefined) ?? []) {
            if (sp.type === "ImportSpecifier") {
              const imported = sp.imported as { type?: string; name?: string; value?: unknown } | undefined;
              const local = sp.local as { type?: string; name?: string } | undefined;
              const exportName =
                imported?.type === "Identifier"
                  ? imported.name
                  : imported?.type === "StringLiteral"
                    ? String(imported.value)
                    : undefined;
              if (exportName && local?.name) {
                bindExternal(local.name, modSrc, exportName);
              }
            } else if (sp.type === "ImportNamespaceSpecifier") {
              const local = sp.local as { type?: string; name?: string } | undefined;
              if (local?.name) {
                externalMember.set(`${local.name}.__module__`, { source: modSrc, fnName: "" });
              }
            }
            // ImportDefaultSpecifier：默认导出名不定，暂不绑定
          }
        }
      }
    }

    if (obj.type === "VariableDeclaration") {
      for (const d of (obj.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
        const id = d.id as { type?: string; name?: string; properties?: Array<Record<string, unknown>> };
        const init = d.init as Record<string, unknown> | null | undefined;
        if (!id || !init) continue;

        // 动态 import：const m = await import('./x') / const { fn } = await import('./x')
        const dynSpec = dynamicImportSpec(init);
        if (dynSpec) {
          const modSrc = loadSpec(dynSpec);
          if (modSrc && id.type === "ObjectPattern") {
            for (const p of id.properties ?? []) {
              const key = p.key as { type?: string; name?: string; value?: unknown } | undefined;
              const val = p.value as { type?: string; name?: string } | undefined;
              const exported =
                key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? String(key.value) : undefined;
              const local = val?.type === "Identifier" ? val.name : exported;
              if (exported && local) bindExternal(local, modSrc, exported);
            }
          }
          if (modSrc && id.type === "Identifier" && id.name) {
            externalMember.set(`${id.name}.__module__`, { source: modSrc, fnName: "" });
          }
        }

        // require 导入
        const spec = requireSpecOf(init);
        if (spec) {
          const modSrc = loadSpec(spec);
          // const { fn } = require(...)
          if (id.type === "ObjectPattern" && modSrc) {
            for (const p of id.properties ?? []) {
              const key = p.key as { type?: string; name?: string; value?: unknown } | undefined;
              const val = p.value as { type?: string; name?: string } | undefined;
              const exported =
                key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? String(key.value) : undefined;
              const local = val?.type === "Identifier" ? val.name : exported;
              if (exported && local) {
                bindExternal(local, modSrc, exported);
              }
            }
          }
          // const m = require(...) → m.fn
          if (id.type === "Identifier" && id.name && modSrc) {
            const exportName = requireExportName(init);
            if (exportName) {
              bindExternal(id.name, modSrc, exportName);
            } else {
              externalMember.set(`${id.name}.__module__`, { source: modSrc, fnName: "" });
            }
          }
        }

        if (id.type !== "Identifier" || !id.name) continue;
        // const f = needsPositive
        if (init.type === "Identifier" && typeof init.name === "string" && knownSet.has(init.name)) {
          aliasToFn.set(id.name, init.name);
        }
        // const api = { needsPositive }
        if (init.type === "ObjectExpression") {
          for (const p of (init.properties as Array<Record<string, unknown>> | undefined) ?? []) {
            if (p.type !== "ObjectProperty") continue;
            const key = p.key as { type?: string; name?: string; value?: unknown };
            const value = p.value as { type?: string; name?: string } | undefined;
            if (value?.type === "Identifier" && value.name && knownSet.has(value.name)) {
              const propKey =
                key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? String(key.value) : undefined;
              if (propKey) memberToFn.set(`${id.name}.${propKey}`, value.name);
            }
          }
        }
      }
    }
  };
  // 语句容器 walk：不进表达式树，O(语句) 而非 O(全部节点)
  walkStatements(file, visit);
  return { aliasToFn, memberToFn, externalFn, externalMember };
}

/** 解析 callee → 同文件名或外部模块描述 */
function resolveCalleeFn(
  callee: Record<string, unknown>,
  resolve: CallResolve,
  knownFns: Set<string>,
): string | { external: { source: string; fnName: string } } | undefined {
  if (callee.type === "Identifier" && typeof callee.name === "string") {
    const ext = resolve.externalFn.get(callee.name);
    if (ext) return { external: ext };
    const aliased = resolve.aliasToFn.get(callee.name);
    if (aliased) return aliased;
    if (knownFns.has(callee.name)) return callee.name;
    return undefined;
  }
  if (callee.type === "MemberExpression") {
    const obj = callee.object as { type?: string; name?: string } | undefined;
    const prop = callee.property as { type?: string; name?: string } | undefined;
    if (
      !callee.computed &&
      obj?.type === "Identifier" &&
      obj.name &&
      prop?.type === "Identifier" &&
      prop.name
    ) {
      const key = `${obj.name}.${prop.name}`;
      const extM = resolve.externalMember.get(key);
      if (extM) return { external: extM };
      // m = require(...)；调用 m.fn
      const mod = resolve.externalMember.get(`${obj.name}.__module__`);
      if (mod?.source) {
        return { external: { source: mod.source, fnName: prop.name } };
      }
      const local = resolve.memberToFn.get(key);
      if (local) return local;
    }
  }
  return undefined;
}

/**
 * 无条件转发：`function w(a,b){ return target(a,b); }`
 * 或箭头 `const w = (a) => target(a)`。
 * map[i] = wrapper 第 i 参 → target 的第几参。
 */
type Forward = { target: string; map: number[] };

function collectForwarders(
  source: string,
  knownFns: Set<string>,
  resolve: CallResolve,
  fileAst?: ReturnType<typeof parse>,
): Map<string, Forward> {
  const forwards = new Map<string, Forward>();
  const file = fileAst ?? parse(source);

  const tryFn = (
    name: string,
    params: Array<{ type?: string; name?: string }>,
    body: Record<string, unknown> | undefined,
  ): void => {
    if (!name || !params.length) return;
    const paramNames = params.map((p) => (p?.type === "Identifier" ? p.name : undefined));
    if (paramNames.some((n) => !n)) return;

    // body: BlockStatement 仅一条 ReturnStatement(CallExpression)
    //      或箭头表达式体 CallExpression
    let call: Record<string, unknown> | undefined;
    if (body?.type === "BlockStatement") {
      const stmts = (body.body as Array<Record<string, unknown>> | undefined) ?? [];
      if (stmts.length !== 1 || stmts[0]!.type !== "ReturnStatement") return;
      const arg = stmts[0]!.argument as Record<string, unknown> | undefined;
      if (arg?.type !== "CallExpression") return;
      call = arg;
    } else if (body?.type === "CallExpression") {
      call = body;
    }
    if (!call) return;

    const resolved = resolveCalleeFn(call.callee as Record<string, unknown>, resolve, knownFns);
    if (!resolved || typeof resolved !== "string") return;
    if (!knownFns.has(resolved) || resolved === name) return;

    const args = (call.arguments as Array<Record<string, unknown>> | undefined) ?? [];
    if (args.length === 0) return;
    // 每个实参必须是 wrapper 自己的参数标识符
    const map: number[] = [];
    for (const a of args) {
      if (a.type !== "Identifier" || typeof a.name !== "string") return;
      const idx = paramNames.indexOf(a.name);
      if (idx < 0) return;
      map.push(idx);
    }
    forwards.set(name, { target: resolved, map });
  };

  walkStatements(file, (obj) => {
    if (obj.type === "FunctionDeclaration") {
      const id = obj.id as { name?: string } | undefined;
      tryFn(
        id?.name ?? "",
        (obj.params as Array<{ type?: string; name?: string }>) ?? [],
        obj.body as Record<string, unknown>,
      );
    }
    if (obj.type === "VariableDeclaration") {
      for (const d of (obj.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
        const id = d.id as { type?: string; name?: string };
        const init = d.init as Record<string, unknown> | null | undefined;
        if (
          id?.type === "Identifier" &&
          id.name &&
          init &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        ) {
          tryFn(
            id.name,
            (init.params as Array<{ type?: string; name?: string }>) ?? [],
            init.body as Record<string, unknown>,
          );
        }
      }
    }
  });
  return forwards;
}

/** 找 `name(literalArgs)` / `alias(lit)` / `obj.fn(lit)` / require 导入，检查约束 */
function scanLiteralCalls(
  source: string,
  knownFns: string[],
  phi: Phi,
  opts?: {
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    fromFile?: string;
    file?: ReturnType<typeof parse>;
    /** 顶层绑定表（与结构赋值共享的 evalProgramAbs 结果） */
    varAbs?: Map<string, Abs>;
  },
): CheckIssue[] {
  const out: CheckIssue[] = [];
  const file = opts?.file ?? parse(source);
  const knownSet = new Set(knownFns);
  const resolve = collectCallResolvers(source, knownFns, opts);
  const forwards = collectForwarders(source, knownSet, resolve, file);
  const varAbs = opts?.varAbs ?? new Map<string, Abs>();

  const flattenPred = (p: Pred): Pred[] =>
    p.op === "and" ? p.args.flatMap(flattenPred) : p.op === "true" ? [] : [p];

  const checkReqs = (
    displayName: string,
    reqs: Array<[number, import("./pred.ts").Pred]>,
    paramNames: string[],
    absArgs: Abs[],
    /** target 参下标 → 实参下标；缺省恒等 */
    argIndexOf: (reqIdx: number) => number | undefined,
    loc?: { start: { line: number; column: number } },
  ): void => {
    for (const [idx, pred] of reqs) {
      const argIdx = argIndexOf(idx);
      if (argIdx === undefined) continue;
      const arg = absArgs[argIdx];
      if (!arg) continue;
      const lv = litValue(arg);
      const isStr = arg.shape.k === "prim" && (arg.shape as { type: string }).type === "string";
      const strLen = typeof lv === "string" ? lv.length : undefined;
      const paramName = paramNames[idx] ?? `arg${idx}`;
      for (const p of flattenPred(pred)) {
        // typeof 约束（string() / number() / boolean() 裸 prim）
        // 只检查挂在参数自身上的 typeof；字段访问（u.name）交给 shape 路径
        if (p.op === "typeof") {
          if (p.t.op !== "var") continue;
          const expected = p.type;
          const actualPrim =
            arg.shape.k === "prim"
              ? (arg.shape as { type: string }).type
              : arg.shape.k === "obj" || arg.shape.k === "arr" || arg.shape.k === "tuple"
                ? "object"
                : arg.shape.k === "fn"
                  ? "function"
                  : undefined;
          // 只在有确定 prim 信息且不匹配时拦截；unknown/any 不猜
          if (actualPrim !== undefined && actualPrim !== expected) {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
              actual: formatAbs(arg),
              expected: `typeof ${paramName} = "${expected}"`,
              suggestion: `改用 ${expected} 类型的值，或放宽 ${paramName} 的 refine`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
          continue;
        }
        if (lv === undefined) continue;
        if (
          (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") &&
          p.b.op === "lit" &&
          typeof p.b.value === "number"
        ) {
          const n = p.b.value;
          const opSym = { gt: ">", ge: "≥", lt: "<", le: "≤" }[p.op];
          // length(t) 形式（string().min/max）
          if (p.a.op === "app" && p.a.fn === "length" && strLen !== undefined) {
            let ok = true;
            if (p.op === "gt") ok = strLen > n;
            if (p.op === "ge") ok = strLen >= n;
            if (p.op === "lt") ok = strLen < n;
            if (p.op === "le") ok = strLen <= n;
            if (!ok) {
              const paramName = paramNames[idx] ?? `arg${idx}`;
              out.push({
                severity: "error",
                code: "nudo:constraint-violated",
                message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
                actual: formatAbs(arg),
                expected: `length(${paramName}) ${opSym} ${n}`,
                suggestion: `改用满足长度 ${opSym} ${n} 的值，或放宽 ${paramName} 的前置`,
                fn: displayName,
                line: loc?.start.line,
                column: loc?.start.column,
              });
            }
            continue;
          }
          // 普通数值界
          if (isStr || typeof lv !== "number") continue;
          let ok = true;
          if (p.op === "gt") ok = (lv as number) > n;
          if (p.op === "ge") ok = (lv as number) >= n;
          if (p.op === "lt") ok = (lv as number) < n;
          if (p.op === "le") ok = (lv as number) <= n;
          if (!ok) {
            const paramName = paramNames[idx] ?? `arg${idx}`;
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
              actual: formatAbs(arg),
              expected: predToString(p),
              suggestion: `改用满足 ${predToString(p)} 的值，或放宽 ${paramName} 的前置`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
        }
      }
    }
  };

  /**
   * shape 约束：实参 object Abs 的每个字段 ⊭ 嵌套约束。
   * 缺字段 / 类型不符 / 数值界违例 → nudo:constraint-violated。
   */
  const checkShapeAgainstAbs = (
    displayName: string,
    paramName: string,
    constraint: NudoConstraint,
    absArg: Abs,
    path: string,
    loc?: { start: { line: number; column: number } },
  ): void => {
    if (!constraint.fields) return;
    // unknown 实参：无信息，不猜
    if (absArg.shape.k === "unknown" && !absArg.term) return;

    const slots =
      absArg.shape.k === "obj"
        ? (absArg.shape as { slots: Record<string, { value: Abs; optional?: boolean }> }).slots
        : undefined;

    if (!slots) {
      // 有形状信息但不是 object
      if (absArg.shape.k !== "unknown" && absArg.shape.k !== "never") {
        out.push({
          severity: "error",
          code: "nudo:constraint-violated",
          message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
          actual: formatAbs(absArg),
          expected: `object shape at ${path}`,
          suggestion: `改用满足 ${path} 形状约束的 object`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
      }
      return;
    }

    for (const [key, field] of Object.entries(constraint.fields) as Array<
      [string, NudoField]
    >) {
      const slot = slots[key];
      const fieldPath = path === paramName ? `${paramName}.${key}` : `${path}.${key}`;
      if (!slot) {
        if (!field.optional && !field.constraint.isOptional) {
          out.push({
            severity: "error",
            code: "nudo:constraint-violated",
            message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
            actual: formatAbs(absArg),
            expected: `missing field ${fieldPath}`,
            suggestion: `补全字段 ${fieldPath}`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
        continue;
      }
      checkFieldConstraint(displayName, paramName, field.constraint, slot.value, fieldPath, loc);
    }
  };

  /** 单字段：prim 类型 + 数值界 + 嵌套 shape + array 元素 + int + 长度 */
  const checkFieldConstraint = (
    displayName: string,
    paramName: string,
    constraint: NudoConstraint,
    fieldAbs: Abs,
    fieldPath: string,
    loc?: { start: { line: number; column: number } },
  ): void => {
    if (fieldAbs.shape.k === "unknown" && !fieldAbs.term) return;

    // prim 类型
    if (constraint.prim && fieldAbs.shape.k === "prim") {
      const actualPrim = (fieldAbs.shape as { type: string }).type;
      if (actualPrim !== constraint.prim) {
        out.push({
          severity: "error",
          code: "nudo:constraint-violated",
          message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
          actual: formatAbs(fieldAbs),
          expected: `typeof ${fieldPath} = "${constraint.prim}"`,
          suggestion: `把 ${fieldPath} 改成 ${constraint.prim}`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
        return;
      }
    }

    // int：字面量必须是整数
    if (constraint.int) {
      const iv = litValue(fieldAbs);
      if (typeof iv === "number" && !Number.isInteger(iv)) {
        out.push({
          severity: "error",
          code: "nudo:constraint-violated",
          message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
          actual: formatAbs(fieldAbs),
          expected: `${fieldPath} is int`,
          suggestion: `把 ${fieldPath} 改成整数`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
      }
    }

    // 嵌套 shape
    if (constraint.fields) {
      checkShapeAgainstAbs(displayName, paramName, constraint, fieldAbs, fieldPath, loc);
    }

    // array 元素：逐元素检查
    if (constraint.element) {
      if (fieldAbs.shape.k === "arr") {
        checkFieldConstraint(
          displayName,
          paramName,
          constraint.element,
          (fieldAbs.shape as { element: Abs }).element,
          `${fieldPath}[]`,
          loc,
        );
      } else if (fieldAbs.shape.k === "tuple") {
        const els = (fieldAbs.shape as { elements: Abs[] }).elements;
        els.forEach((el, i) => {
          checkFieldConstraint(
            displayName,
            paramName,
            constraint.element!,
            el,
            `${fieldPath}[${i}]`,
            loc,
          );
        });
      }
    }

    // 数值界 + 长度界（preds 里可能含 length(t) 比较）
    const lv = litValue(fieldAbs);
    const sv = typeof lv === "string" ? lv.length : undefined;
    const isStr = fieldAbs.shape.k === "prim" && (fieldAbs.shape as { type: string }).type === "string";
    for (const p of constraint.preds) {
      const flat = p.op === "and" ? p.args : [p];
      for (const atom of flat) {
        if (
          (atom.op === "gt" || atom.op === "ge" || atom.op === "lt" || atom.op === "le") &&
          atom.b.op === "lit" &&
          typeof atom.b.value === "number"
        ) {
          const n = atom.b.value;
          const opSym = { gt: ">", ge: "≥", lt: "<", le: "≤" }[atom.op];
          // length(t) 形式
          if (atom.a.op === "app" && atom.a.fn === "length") {
            if (sv === undefined) continue;
            let ok = true;
            if (atom.op === "gt") ok = sv > n;
            if (atom.op === "ge") ok = sv >= n;
            if (atom.op === "lt") ok = sv < n;
            if (atom.op === "le") ok = sv <= n;
            if (!ok) {
              out.push({
                severity: "error",
                code: "nudo:constraint-violated",
                message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
                actual: formatAbs(fieldAbs),
                expected: `length(${fieldPath}) ${opSym} ${n}`,
                suggestion: `改用满足长度 ${opSym} ${n} 的 ${fieldPath}`,
                fn: displayName,
                line: loc?.start.line,
                column: loc?.start.column,
              });
            }
            continue;
          }
          // 普通数值界
          if (lv === undefined || typeof lv !== "number" || isStr) continue;
          let ok = true;
          if (atom.op === "gt") ok = lv > n;
          if (atom.op === "ge") ok = lv >= n;
          if (atom.op === "lt") ok = lv < n;
          if (atom.op === "le") ok = lv <= n;
          if (!ok) {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
              actual: formatAbs(fieldAbs),
              expected: `${fieldPath} ${opSym} ${n}`,
              suggestion: `改用满足 ${fieldPath} ${opSym} ${n} 的值，或放宽 ${paramName} 的前置`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
        }
      }
    }
  };

  /** 对带 shape / array / int / prim 的 refine 做结构检查 */
  const checkShapeReqs = (
    displayName: string,
    reqs: Array<[number, RefineEntry]>,
    paramNames: string[],
    absArgs: Abs[],
    argIndexOf: (reqIdx: number) => number | undefined,
    loc?: { start: { line: number; column: number } },
  ): void => {
    for (const [idx, entry] of reqs) {
      const c = entry.constraint;
      if (!c.fields && !c.element && !c.int && !c.prim) continue;
      const argIdx = argIndexOf(idx);
      if (argIdx === undefined) continue;
      const arg = absArgs[argIdx];
      if (!arg) continue;
      const paramName = entry.param || paramNames[idx] || `arg${idx}`;
      // 裸 prim 已由 checkReqs 的 typeof pred 覆盖；此处只处理 shape/array/int
      // shape 字段
      if (c.fields) {
        checkShapeAgainstAbs(displayName, paramName, c, arg, paramName, loc);
      }
      // 顶层 array 元素
      if (c.element) {
        if (arg.shape.k === "arr") {
          checkFieldConstraint(
            displayName,
            paramName,
            c.element,
            (arg.shape as { element: Abs }).element,
            `${paramName}[]`,
            loc,
          );
        } else if (arg.shape.k === "tuple") {
          const els = (arg.shape as { elements: Abs[] }).elements;
          els.forEach((el, i) => {
            checkFieldConstraint(
              displayName,
              paramName,
              c.element!,
              el,
              `${paramName}[${i}]`,
              loc,
            );
          });
        } else if (arg.shape.k !== "unknown" && arg.shape.k !== "any") {
          out.push({
            severity: "error",
            code: "nudo:constraint-violated",
            message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
            actual: formatAbs(arg),
            expected: `array at ${paramName}`,
            suggestion: `改用满足 array 约束的值`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
      }
      // 顶层 int
      if (c.int) {
        const iv = litValue(arg);
        if (typeof iv === "number" && !Number.isInteger(iv)) {
          out.push({
            severity: "error",
            code: "nudo:constraint-violated",
            message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
            actual: formatAbs(arg),
            expected: `${paramName} is int`,
            suggestion: `改用整数`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
      }
    }
  };

  const parseCallArgs = (
    args: Array<Record<string, unknown>>,
  ): { absArgs: Abs[]; hasInfo: boolean } => {
    const absArgs: Abs[] = [];
    let hasInfo = false;
    for (const a of args ?? []) {
      if (a.type === "NumericLiteral" && typeof a.value === "number") {
        absArgs.push(numLit(a.value));
        hasInfo = true;
      } else if (
        a.type === "UnaryExpression" &&
        (a as { operator?: string }).operator === "-" &&
        (a as { argument?: Record<string, unknown> }).argument?.type === "NumericLiteral"
      ) {
        const num = (a as { argument: { value: number } }).argument;
        absArgs.push(numLit(-num.value));
        hasInfo = true;
      } else if (a.type === "ObjectExpression") {
        const abs = evalArgAbs(a, (n) => varAbs.get(n));
        absArgs.push(abs ?? absUnknown());
        if (abs && abs.shape.k === "obj") hasInfo = true;
      } else if (a.type === "ArrayExpression") {
        const abs = evalArgAbs(a, (n) => varAbs.get(n));
        absArgs.push(abs ?? absUnknown());
        if (abs && (abs.shape.k === "arr" || abs.shape.k === "tuple")) hasInfo = true;
      } else if (a.type === "StringLiteral" && typeof a.value === "string") {
        absArgs.push({
          shape: { k: "prim", type: "string" },
          term: { op: "lit", value: a.value },
          conf: "exact",
        });
        hasInfo = true;
      } else if (a.type === "Identifier" && typeof a.name === "string") {
        const abs = varAbs.get(a.name);
        absArgs.push(abs ?? absUnknown());
        if (abs && abs.shape.k !== "unknown") hasInfo = true;
      } else {
        absArgs.push(absUnknown());
      }
    }
    return { absArgs, hasInfo };
  };

  const checkOneCall = (
    fnName: string,
    args: Array<Record<string, unknown>>,
    loc?: { start: { line: number; column: number } },
  ): void => {
    if (!knownFns.includes(fnName)) return;

    // 传参结构：实参字面量 Abs ≤ 形参必填 slot
    checkArgStructures(fnName, source, args, loc);

    const { absArgs, hasInfo } = parseCallArgs(args);
    if (!hasInfo || absArgs.length === 0) return;

    const g = generalizeFromAst(fnName, source, {
      file,
      refine: {
        loadModule: opts?.loadModule,
        fromFile: opts?.fromFile ?? "",
      },
    });
    const paramNames = g?.params ?? [];
    const optsR = {
      loadModule: opts?.loadModule,
      fromFile: opts?.fromFile ?? "",
    };
    const ownFull = refineToIndexedFull(source, fnName, paramNames, optsR);
    checkShapeReqs(fnName, ownFull, paramNames, absArgs, (i) => i, loc);
    checkReqs(
      fnName,
      ownFull.map(([i, e]) => [i, e.pred] as [number, Pred]),
      paramNames,
      absArgs,
      (i) => i,
      loc,
    );

    const fwd = forwards.get(fnName);
    if (fwd) {
      const tg = generalizeFromAst(fwd.target, source, file ? { file } : {});
      const tParams = tg?.params ?? [];
      const tFull = refineToIndexedFull(source, fwd.target, tParams, optsR);
      if (tFull.length > 0) {
        const wrapperArgOfTarget = new Map<number, number>();
        fwd.map.forEach((wrapperIdx, targetIdx) => {
          wrapperArgOfTarget.set(targetIdx, wrapperIdx);
        });
        const mapArg = (targetIdx: number) => wrapperArgOfTarget.get(targetIdx);
        checkShapeReqs(`${fnName}→${fwd.target}`, tFull, tParams, absArgs, mapArg, loc);
        checkReqs(
          `${fnName}→${fwd.target}`,
          tFull.map(([i, e]) => [i, e.pred] as [number, Pred]),
          tParams,
          absArgs,
          mapArg,
          loc,
        );
      }
    }
  };

  const checkExternalCall = (
    ext: { source: string; fnName: string },
    args: Array<Record<string, unknown>>,
    displayName: string,
    loc?: { start: { line: number; column: number } },
  ): void => {
    checkArgStructures(ext.fnName, ext.source, args, loc, displayName);
    const { absArgs, hasInfo } = parseCallArgs(args);
    if (!hasInfo || absArgs.length === 0) return;
    let full: Array<[number, RefineEntry]> = [];
    let paramNames: string[] = [];
    try {
      const g = generalizeFromAst(ext.fnName, ext.source);
      paramNames = g?.params ?? [];
      full = refineToIndexedFull(ext.source, ext.fnName, paramNames, {
        loadModule: opts?.loadModule,
        fromFile: opts?.fromFile ?? "",
      });
    } catch {
      return;
    }
    checkShapeReqs(displayName, full, paramNames, absArgs, (i) => i, loc);
    checkReqs(
      displayName,
      full.map(([i, e]) => [i, e.pred] as [number, Pred]),
      paramNames,
      absArgs,
      (i) => i,
      loc,
    );
  };

  /**
   * 实参结构 ≤ 形参必填 slot（从 `p.foo` 访问推出）。
   * 字面量节点静态求 Abs；标识符用文件绑定表。
   */
  /** P4：HOF 实参 fn 形状检查（§6.3 豁免规则） */
  const checkHofFnRelArgs = (
    g: PolyFn,
    args: Array<Record<string, unknown>>,
    loc: { start: { line: number; column: number } } | undefined,
    displayName: string,
    evalArg: (n: Record<string, unknown>) => Abs | undefined,
  ): void => {
    const fnRels = g.fnRels;
    if (!fnRels) return;
    for (let i = 0; i < g.params.length; i++) {
      const pname = g.params[i]!;
      const rel = fnRels.get(pname);
      if (!rel) continue;
      const expected = rel.abs;
      if (expected.shape.k !== "fn") continue;
      const argNode = args[i];
      if (!argNode) continue;
      const absArg = evalArg(argNode);
      if (!absArg) continue;
      // 豁免：any / unknown / 无信息
      if (absArg.shape.k === "any" || absArg.shape.k === "unknown") continue;
      // 豁免：有真实 body 的 impl
      if (getFnImpl(absArg)) continue;
      // 豁免：sum 且任一 member 满足
      if (absArg.shape.k === "sum") {
        const okAny = absArg.shape.members.some((m) =>
          hofFnArgOk(m, expected),
        );
        if (okAny) continue;
      }
      if (!hofFnArgOk(absArg, expected)) {
        // promote 来源 → warning；refine / relationFn → error
        const isPromote = rel.source === "promote";
        out.push({
          severity: isPromote ? "warning" : "error",
          code: "nudo:arg-structure",
          message: `${displayName}[${pname}]: 实参不是可调用的 fn`,
          actual: formatAbs(absArg),
          expected: formatShape(expected),
          suggestion: `期望 ${formatShape(expected)}`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
      }
    }
  };

  const checkArgStructures = (
    fnName: string,
    fnSource: string,
    args: Array<Record<string, unknown>>,
    loc?: { start: { line: number; column: number } },
    displayName?: string,
  ): void => {
    let structReqs: Map<string, Set<string>>;
    let paramNames: string[];
    let gFn: ReturnType<typeof generalizeFromAst>;
    try {
      // 同文件调用复用预解析 AST；跨文件源码各自 parse
      const sameFile = fnSource === source;
      structReqs = collectParamStructReqs(fnSource, fnName, sameFile ? file : undefined);
      gFn = generalizeFromAst(
        fnName,
        fnSource,
        sameFile && file ? { file } : {},
      );
      paramNames = gFn?.params ?? [];
    } catch {
      return;
    }
    // P4：HOF 实参 arity/shape 检查（依赖 P2 的 fnRels + RelSource）
    if (gFn?.fnRels && gFn.fnRels.size > 0) {
      checkHofFnRelArgs(gFn, args, loc, displayName ?? fnName, (n) =>
        evalArgAbs(n, (x) => varAbs.get(x)),
      );
    }
    if (structReqs.size === 0) return;
    // refine 契约优先：有 @nudo:refine 的形参不再用 body 方法访问推形状
    let refinedParams: Set<string> | undefined;
    try {
      const sameFile = fnSource === source;
      const reqs = refineToIndexedFull(fnSource, fnName, paramNames, {
        loadModule: opts?.loadModule,
        fromFile: opts?.fromFile ?? "",
      });
      if (reqs.length > 0) {
        refinedParams = new Set(reqs.map(([, e]) => e.param));
      }
    } catch {
      /* refine 解析失败时退回 body 结构推断 */
    }
    for (let i = 0; i < args.length; i++) {
      const pname = paramNames[i];
      if (!pname) continue;
      if (refinedParams?.has(pname)) continue;
      const keys = structReqs.get(pname);
      if (!keys || keys.size === 0) continue;
      const argNode = args[i];
      if (!argNode) continue;
      const absArg = evalArgAbs(argNode, (n) => varAbs.get(n));
      if (!absArg || absArg.shape.k === "unknown") continue;
      // 数组/元组天然有 length；string 也有 length
      const isLeny =
        absArg.shape.k === "arr" ||
        absArg.shape.k === "tuple" ||
        (absArg.shape.k === "prim" &&
          (absArg.shape as { type: string }).type === "string");
      const needKeys = isLeny
        ? [...keys].filter((k) => k !== "length")
        : [...keys];
      if (needKeys.length === 0) continue;
      const slots: Record<string, { value: Abs }> = {};
      for (const k of needKeys) slots[k] = { value: absUnknown() };
      const target = makeAbs({ k: "obj", slots }, undefined, undefined, "exact");
      const leq = leqAbs(absArg, target);
      if (!leq.ok) {
        const name = displayName ?? fnName;
        out.push({
          severity: "error",
          code: "nudo:arg-structure",
          message: `${name}[${pname}]: 实参结构 ⊭ 形参`,
          actual: formatAbs(absArg),
          expected: formatAbs(target),
          suggestion: leq.reason ?? `补全 ${pname} 上被访问的字段`,
          fn: name,
          line: loc?.start.line,
          column: loc?.start.column,
        });
      }
    }
  };

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & {
      type?: string;
      loc?: { start: { line: number; column: number } };
    };
    if (obj.type === "CallExpression") {
      const callee = obj.callee as Record<string, unknown>;
      const args = (obj.arguments as Array<Record<string, unknown>>) ?? [];
      const resolved = resolveCalleeFn(callee, resolve, knownSet);
      if (typeof resolved === "string") {
        checkOneCall(resolved, args, obj.loc);
      } else if (resolved?.external) {
        const name = resolved.external.fnName || "require()";
        checkExternalCall(resolved.external, args, name, obj.loc);
      }
    }
    for (const key of Object.keys(obj)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const val = obj[key];
      if (Array.isArray(val)) val.forEach(visit);
      else if (val && typeof val === "object") visit(val);
    }
  };
  visit(file);
  return out;
}
