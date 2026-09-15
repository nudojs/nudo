/**
 * nudo check 门禁：对源码跑代数分析，产出 error/warning。
 *
 * 报告是 **Nudo 原生格式**（Abs 优先），不是 TS 诊断的换皮：
 * - 签名表给出无损 Abs（shape/term/pred/conf）
 * - 违例写清 actual ⊭ expected（实参 Abs vs 前置 Pred）
 * - dts/TS 兼容不是本报告的职责
 */

import { parseSource as parse } from "./parse-source.ts";
import {
  analyzeFn,
  evalProgramAbs,
  setAbsAssignCollector,
  setAbsTruncationCollector,
  resetAbsCallBudget,
  type AbsAssignRecord,
} from "./ast-eval.ts";
import { leqAbs } from "./leq.ts";
import {
  refineToIndexedFull,
  extractRefineReturnFromSource,
} from "./refine.ts";
import type { NudoConstraint, NudoField } from "./constraint.ts";
import { extractFn, generalizeFromAst } from "./generalize.ts";
import { getSlot } from "./objects.ts";
import { canSkipLiteralCallScan } from "./fn-fp.ts";
import { stableAnalyzeKeySource } from "./stable-source-key.ts";
import { hashSource, resetHashSourceCache } from "./hash-source.ts";
import {
  loadModuleDepsFingerprint,
  normPath,
  type LoadDepsFingerprint,
} from "./load-deps-fp.ts";
import { numLit, litValue } from "./abs.ts";
import type { Abs } from "./abs.ts";
import type { Phi, Pred } from "./pred.ts";
import { pTrue, predToString } from "./pred.ts";
import { formatAbs, formatAbsMultiline } from "./format.ts";
import type { CheckIssue, CheckReport, NudoSig } from "./check-report.ts";
import type { PolyFn } from "./generalize.ts";
import { absUnknown, listTopFunctions, scanLiteralCalls } from "./scan.ts";

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

