/**
 * 真·generalize：在新鲜类型变量 α 上执行用户函数，归纳多态签名，
 * 并支持调用点实例化。
 *
 * - generalize 保留 term 结构（λα. α+1）
 * - 调用点实例化把 α 换成具体 Abs 后再求值
 */

import { parseSource as babelParse } from "./parse-source.ts";
import type { Node } from "@babel/types";
import type { Term } from "./term.ts";
import { v as termVar, termToString } from "./term.ts";
import type { Phi, Pred } from "./pred.ts";
import { pTrue, predToString } from "./pred.ts";
import type { Abs, Shape } from "./abs.ts";
import { abs, unknown } from "./abs.ts";
import type { AstEnv } from "./ast-env.ts";
import { evalNode, emptyEnv } from "./ast-eval.ts";
import { defaultLeakBudget, type LeakBudget } from "./leak.ts";
import { formatShapeSlot } from "./format.ts";
import { type RefineResolveOpts } from "./refine.ts";
import { constraintToEntryAbs, instantiateConstraint } from "./constraint.ts";
import {
  effectiveInterface,
  sidecarClosureFingerprint,
  sidecarPathOf,
} from "./interface.ts";
import { generalizeSourceKeyPart, resetFnFpCache } from "./fn-fp.ts";
import { resetHashSourceCache } from "./hash-source.ts";
import {
  loadModuleDepsFingerprint,
  normPath,
  type LoadDepsFingerprint,
} from "./load-deps-fp.ts";
import {
  createHofCollectCtx,
  snapshotAbs,
  type RelSource,
  type HofSite,
} from "./hof.ts";

/** 进程内 L0：同 (source, fn, refine 指纹, budget, label) 的 generalize 结果 */
const generalizeMemo = new Map<string, PolyFn | undefined>();
/** key → 依赖的规范化路径（供定向逐出） */
const memoKeyDeps = new Map<string, string[]>();
/** 依赖路径 → keys */
const memoDepIndex = new Map<string, Set<string>>();
const loadModuleIds = new WeakMap<object, number>();
let nextLoadModuleId = 1;

/** L3：会话常驻 + 上限，超出按 LRU 逐出最旧条目 */
const MAX_GENERALIZE_MEMO = 1024;

export function resetGeneralizeMemo(): void {
  generalizeMemo.clear();
  memoKeyDeps.clear();
  memoDepIndex.clear();
  resetFnFpCache();
  resetHashSourceCache();
}

export function getGeneralizeMemoSize(): number {
  return generalizeMemo.size;
}

function unindexMemoKey(key: string): void {
  const deps = memoKeyDeps.get(key);
  if (!deps) return;
  for (const p of deps) {
    const set = memoDepIndex.get(p);
    if (!set) continue;
    set.delete(key);
    if (set.size === 0) memoDepIndex.delete(p);
  }
  memoKeyDeps.delete(key);
}

/**
 * LSP/宿主：`*.nudo.js` 变更后按路径定向逐出依赖它的 L0 条目。
 * 返回删除的条目数。路径需与 generalize 时 resolveDepPath 形态一致（建议先 norm）。
 */
export function evictGeneralizeMemoForPaths(paths: string[]): number {
  let n = 0;
  for (const raw of paths) {
    const p = normPath(raw);
    const keys = memoDepIndex.get(p);
    if (!keys) continue;
    for (const key of [...keys]) {
      generalizeMemo.delete(key);
      unindexMemoKey(key);
      n++;
    }
  }
  return n;
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

type DepFingerprint = { fp: string; paths: string[]; truncated: boolean };

/**
 * L3：loadModule 可达依赖内容指纹（与 check 整文件 memo 同一套 specs/传递规则）。
 * 仅 @nudo:import 不够——body 求值会经 loadModule 读普通 require/from。
 */
function refineDepsFingerprint(source: string, refine?: RefineResolveOpts): DepFingerprint {
  if (!refine?.loadModule || !refine.fromFile) {
    return { fp: "-", paths: [], truncated: false };
  }
  return loadModuleDepsFingerprint(source, refine.loadModule, refine.fromFile);
}

function generalizeMemoKey(
  fnName: string,
  source: string,
  opts: {
    budget?: LeakBudget;
    label?: string;
    refine?: RefineResolveOpts;
    file?: ReturnType<typeof babelParse>;
    /** checkSource 预计算：整文件一次指纹，所有 fn 的 L0 共用 */
    depsFp?: LoadDepsFingerprint;
    /** checkSource 预计算：ambient 侧车闭包指纹（独立调用时现算） */
    sidecarFp?: string;
  },
): { key: string; depPaths: string[]; truncated: boolean } {
  const r = opts.refine;
  const budget = opts.budget ?? defaultLeakBudget;
  const deps =
    opts.depsFp ??
    (r ? refineDepsFingerprint(source, r) : { fp: "-", paths: [], truncated: false });
  // ambient 侧车闭包进键：侧车内容变更 → L0 失效；路径登记供定向逐出。
  // 截断前缀（trunc:）→ 键不可信，调用方 fail-open。
  const sc =
    opts.sidecarFp ??
    (r?.loadModule && r.fromFile ? sidecarClosureFingerprint(r.fromFile, r) : undefined);
  const scPath =
    sc !== undefined && !sc.startsWith("trunc:") && r?.fromFile
      ? normPath(sidecarPathOf(r.fromFile))
      : undefined;
  // AST 可用时用 per-function 指纹：改未引用的兄弟函数不 invalidate 本函数
  const srcPart = generalizeSourceKeyPart(source, fnName, opts.file);
  const key = [
    srcPart,
    fnName,
    opts.label ?? "A",
    r ? `${loadModuleId(r.loadModule)}:${r.fromFile ?? ""}` : "-",
    deps.fp,
    sc ?? "-",
    `${budget.maxDepth}/${budget.maxNodes}`,
  ].join("|");
  return {
    key,
    depPaths: scPath !== undefined ? [...deps.paths, scPath] : deps.paths,
    truncated: deps.truncated || (sc?.startsWith("trunc:") ?? false),
  };
}

function generalizeMemoGet(key: string): PolyFn | undefined | null {
  if (!generalizeMemo.has(key)) return null;
  const v = generalizeMemo.get(key);
  // LRU：命中后移到队尾
  generalizeMemo.delete(key);
  generalizeMemo.set(key, v);
  return v;
}

function generalizeMemoSet(
  key: string,
  value: PolyFn | undefined,
  depPaths: string[],
): void {
  if (generalizeMemo.size >= MAX_GENERALIZE_MEMO) {
    const oldest = generalizeMemo.keys().next().value;
    if (oldest !== undefined) {
      generalizeMemo.delete(oldest);
      unindexMemoKey(oldest);
    }
  }
  generalizeMemo.set(key, value);
  if (depPaths.length > 0) {
    memoKeyDeps.set(key, depPaths);
    for (const p of depPaths) {
      let set = memoDepIndex.get(p);
      if (!set) {
        set = new Set();
        memoDepIndex.set(p, set);
      }
      set.add(key);
    }
  }
}

/** L1/L2 只缓存完整可复用结果；截断/失败产生的 partial|opaque 不进缓存 */
function isCacheableAbs(a: Abs): boolean {
  return (
    a.conf === "exact" ||
    a.conf === "path" ||
    a.conf === "widened" ||
    a.conf === "mock"
  );
}

type VarRename = ReadonlyMap<string, string>;

function termKey(t: Term, rename?: VarRename): string {
  switch (t.op) {
    case "lit":
      return `L:${typeof t.value}:${String(t.value)}`;
    case "var":
      return `V:${rename?.get(t.id) ?? t.id}`;
    case "app":
      return `A:${t.fn}(${t.args.map((a) => termKey(a, rename)).join(",")})`;
  }
}

/** L2：and/or 子约束按键排序，交换律不造成 miss */
function predKey(p: Pred, rename?: VarRename): string {
  switch (p.op) {
    case "true":
      return "T";
    case "false":
      return "F";
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge":
      return `${p.op}(${termKey(p.a, rename)},${termKey(p.b, rename)})`;
    case "and":
    case "or": {
      const keys = p.args.map((a) => predKey(a, rename)).sort();
      return `${p.op}(${keys.join(",")})`;
    }
    case "not":
      return `not(${predKey(p.arg, rename)})`;
    case "typeof":
      return `typeof(${termKey(p.t, rename)},${p.type})`;
  }
}

/** 结构键：shape + term + pred；不含 conf（置信度不参与语义输入） */
function shapeKey(s: Shape, seen: Set<object>, rename?: VarRename): string {
  switch (s.k) {
    case "never":
    case "any":
    case "unknown":
      return s.k;
    case "prim":
      return `p:${s.type}`;
    case "brand":
      return `b:${s.name}(${absKeyInner(s.shape, seen, rename)})`;
    case "eff":
      return `e:${s.eff}<${absKeyInner(s.inner, seen, rename)}>`;
    case "arr":
      return `arr(${absKeyInner(s.element, seen, rename)})`;
    case "tuple": {
      const els = s.elements.map((e) => absKeyInner(e, seen, rename)).join(",");
      const rest = s.rest ? `...${absKeyInner(s.rest, seen, rename)}` : "";
      return `tup[${els}${rest}]`;
    }
    case "fn": {
      const pts = (s.paramTypes ?? [])
        .map((t) => absKeyInner(t, seen, rename))
        .join(",");
      const ret = s.returnType ? absKeyInner(s.returnType, seen, rename) : "?";
      const name = s.name ? `#${s.name}` : "";
      return `fn${name}(${s.params.join(",")}|${pts})=>${ret}`;
    }
    case "sum":
      return `sum(${s.members.map((m) => absKeyInner(m, seen, rename)).join("|")})`;
    case "obj": {
      const slots = Object.keys(s.slots)
        .sort()
        .map((k) => {
          const slot = s.slots[k]!;
          const flags = (slot.optional ? "?" : "") + (slot.readonly ? "r" : "");
          return `${k}${flags}:${absKeyInner(slot.value, seen, rename)}`;
        })
        .join(",");
      const idx = s.index
        ? `idx(${absKeyInner(s.index.key, seen, rename)}→${absKeyInner(s.index.value, seen, rename)})`
        : "";
      const open = s.open ? "open" : "";
      return `obj{${slots}}${idx}${open}`;
    }
  }
}

function absKeyInner(a: Abs, seen: Set<object>, rename?: VarRename): string {
  if (seen.has(a)) return "cycle";
  seen.add(a);
  const t = a.term ? `=${termKey(a.term, rename)}` : "";
  const p = a.pred ? `@${predKey(a.pred, rename)}` : "";
  return `${shapeKey(a.shape, seen, rename)}${t}${p}`;
}

// --- free vars + α-rename (L2) ---

function collectTermVars(t: Term, acc: Set<string>): void {
  if (t.op === "var") acc.add(t.id);
  else if (t.op === "app") for (const a of t.args) collectTermVars(a, acc);
}

function collectPredVars(p: Pred, acc: Set<string>): void {
  switch (p.op) {
    case "true":
    case "false":
      return;
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge":
      collectTermVars(p.a, acc);
      collectTermVars(p.b, acc);
      return;
    case "and":
    case "or":
      for (const a of p.args) collectPredVars(a, acc);
      return;
    case "not":
      collectPredVars(p.arg, acc);
      return;
    case "typeof":
      collectTermVars(p.t, acc);
      return;
  }
}

function collectAbsVars(a: Abs, acc: Set<string>, seen: Set<Abs>): void {
  if (seen.has(a)) return;
  seen.add(a);
  if (a.term) collectTermVars(a.term, acc);
  if (a.pred) collectPredVars(a.pred, acc);
  const s = a.shape;
  switch (s.k) {
    case "brand":
      collectAbsVars(s.shape, acc, seen);
      return;
    case "eff":
      collectAbsVars(s.inner, acc, seen);
      return;
    case "arr":
      collectAbsVars(s.element, acc, seen);
      return;
    case "tuple":
      for (const e of s.elements) collectAbsVars(e, acc, seen);
      if (s.rest) collectAbsVars(s.rest, acc, seen);
      return;
    case "fn":
      for (const t of s.paramTypes ?? []) collectAbsVars(t, acc, seen);
      if (s.returnType) collectAbsVars(s.returnType, acc, seen);
      return;
    case "sum":
      for (const m of s.members) collectAbsVars(m, acc, seen);
      return;
    case "obj":
      for (const slot of Object.values(s.slots)) collectAbsVars(slot.value, acc, seen);
      if (s.index) {
        collectAbsVars(s.index.key, acc, seen);
        collectAbsVars(s.index.value, acc, seen);
      }
      return;
    default:
      return;
  }
}

function renameTerm(t: Term, map: VarRename): Term {
  if (t.op === "var") {
    const to = map.get(t.id);
    return to === undefined ? t : termVar(to);
  }
  if (t.op === "app") {
    return { op: "app", fn: t.fn, args: t.args.map((a) => renameTerm(a, map)) };
  }
  return t;
}

function renamePred(p: Pred, map: VarRename): Pred {
  switch (p.op) {
    case "true":
    case "false":
      return p;
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge":
      return { op: p.op, a: renameTerm(p.a, map), b: renameTerm(p.b, map) };
    case "and":
    case "or":
      return { op: p.op, args: p.args.map((a) => renamePred(a, map)) };
    case "not":
      return { op: "not", arg: renamePred(p.arg, map) };
    case "typeof":
      return { op: "typeof", t: renameTerm(p.t, map), type: p.type };
  }
}

function renameAbs(a: Abs, map: VarRename): Abs {
  const out: Abs = {
    shape: renameShape(a.shape, map),
    conf: a.conf,
  };
  if (a.term) out.term = renameTerm(a.term, map);
  if (a.pred) out.pred = renamePred(a.pred, map);
  return out;
}

function renameShape(s: Shape, map: VarRename): Shape {
  switch (s.k) {
    case "never":
    case "any":
    case "unknown":
    case "prim":
      return s;
    case "brand":
      return { k: "brand", name: s.name, shape: renameAbs(s.shape, map) };
    case "eff":
      return { k: "eff", eff: s.eff, inner: renameAbs(s.inner, map) };
    case "arr":
      return { k: "arr", element: renameAbs(s.element, map) };
    case "tuple": {
      const out: Shape = {
        k: "tuple",
        elements: s.elements.map((e) => renameAbs(e, map)),
      };
      if (s.rest) out.rest = renameAbs(s.rest, map);
      return out;
    }
    case "fn": {
      const out: Shape = { k: "fn", params: s.params };
      if (s.name !== undefined) out.name = s.name;
      if (s.paramTypes) out.paramTypes = s.paramTypes.map((t) => renameAbs(t, map));
      if (s.returnType) out.returnType = renameAbs(s.returnType, map);
      return out;
    }
    case "sum":
      return { k: "sum", members: s.members.map((m) => renameAbs(m, map)) };
    case "obj": {
      const slots: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }> = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        slots[k] = {
          value: renameAbs(slot.value, map),
          ...(slot.optional ? { optional: true } : {}),
          ...(slot.readonly ? { readonly: true } : {}),
        };
      }
      const out: Shape = { k: "obj", slots };
      if (s.index) {
        out.index = { key: renameAbs(s.index.key, map), value: renameAbs(s.index.value, map) };
      }
      if (s.open) out.open = true;
      return out;
    }
  }
}

type InstHit = { result: Abs; varOrder: string[] };

/**
 * L2 键：args+Φ 中自由变元按 id 排序后 α-规范化（→ α0,α1,…）。
 * 同构不同名（x+1 vs y+1）共享条目；命中时把结果变元改回当前名。
 */
function instantiateMemoKey(
  args: Abs[],
  phi: Phi,
): { key: string; varOrder: string[] } {
  const acc = new Set<string>();
  for (const a of args) collectAbsVars(a, acc, new Set());
  collectPredVars(phi, acc);
  const varOrder = [...acc].sort();
  const rename = new Map(varOrder.map((id, i) => [id, `α${i}`]));
  const key = `${args.map((a) => absKeyInner(a, new Set(), rename)).join(";")}#${predKey(phi, rename)}`;
  return { key, varOrder };
}

function alphaRenameResult(
  result: Abs,
  fromOrder: string[],
  toOrder: string[],
): Abs {
  if (fromOrder.length !== toOrder.length) return result;
  let same = true;
  for (let i = 0; i < fromOrder.length; i++) {
    if (fromOrder[i] !== toOrder[i]) {
      same = false;
      break;
    }
  }
  if (same) return result;
  const map = new Map<string, string>();
  for (let i = 0; i < fromOrder.length; i++) {
    map.set(fromOrder[i]!, toOrder[i]!);
  }
  return renameAbs(result, map);
}

export type TypeParam = {
  id: string;
  value: Abs;
};

export type PolyFn = {
  name: string;
  params: string[];
  typeParams: TypeParam[];
  instantiate: (args: Abs[], phi?: Phi) => Abs;
  symbolic: Abs;
  display: string;
  /** 入口契约（@nudo:refine），供签名/inlay 展示 */
  entryReqs?: Array<{ param: string; pred: import("./pred.ts").Pred }>;
  /**
   * 函数形参的符号外延（与 typeParams 同 α 空间）。
   * symbolic 一次跑正常结束时从 env 快照拷出；instantiate 重跑不写。
   */
  fnRels?: Map<string, { abs: Abs; source: import("./hof.ts").RelSource }>;
  /**
   * 值形参（非函数）的提升快照，如 `items → arr(A1)`。
   */
  entryShapes?: Map<string, { abs: Abs; source: import("./hof.ts").RelSource }>;
  /** body 内对该形参的应用点（check/hover/dts 用） */
  hofSites?: import("./hof.ts").HofSite[];
};

export function extractFn(
  source: string,
  fnName: string,
  fileAst?: ReturnType<typeof babelParse>,
): { params: string[]; body: Node; env: AstEnv } | undefined {
  const file = fileAst ?? babelParse(source);
  const env = emptyEnv();

  for (const stmt of file.program.body) {
    // export function / export const = fn / export default function
    let decl: Node = stmt;
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    if (decl.type === "FunctionDeclaration" && decl.id) {
      env.fns.set(decl.id.name, {
        params: decl.params.map((p) => (p.type === "Identifier" ? p.name : "_")),
        body: decl.body,
        async: decl.async === true,
      });
    }
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (
          d.id.type === "Identifier" &&
          d.init &&
          (d.init.type === "ArrowFunctionExpression" ||
            d.init.type === "FunctionExpression")
        ) {
          const init = d.init as {
            params: Array<{ type: string; name?: string }>;
            body: Node;
            async?: boolean;
          };
          env.fns.set(d.id.name, {
            params: init.params.map((p) =>
              p.type === "Identifier" ? (p.name ?? "_") : "_",
            ),
            body: init.body,
            async: init.async === true,
          });
        }
      }
    }
  }

  const fn = env.fns.get(fnName);
  if (!fn) return undefined;
  return { params: fn.params, body: fn.body, env };
}

export function generalizeFromAst(
  fnName: string,
  source: string,
  opts: {
    budget?: LeakBudget;
    label?: string;
    /** 传入则把 @nudo:refine 挂到入口 param Abs */
    refine?: RefineResolveOpts;
    /** 预解析 AST，避免 check 批量场景重复 parse */
    file?: ReturnType<typeof babelParse>;
    /** 预计算 load-deps 指纹（checkSource 整文件一次，避免 per-fn 重读） */
    depsFp?: LoadDepsFingerprint;
    /** 预计算 ambient 侧车闭包指纹（checkSource 整文件一次） */
    sidecarFp?: string;
  } = {},
): PolyFn | undefined {
  const { key, depPaths, truncated } = generalizeMemoKey(fnName, source, opts);
  // 截断指纹不可信：不读也不写 L0
  if (!truncated) {
    const cached = generalizeMemoGet(key);
    if (cached !== null) {
      return cached;
    }
  }
  const result = generalizeFromAstUncached(fnName, source, opts);
  if (!truncated) {
    generalizeMemoSet(key, result, depPaths);
  }
  return result;
}

function generalizeFromAstUncached(
  fnName: string,
  source: string,
  opts: {
    budget?: LeakBudget;
    label?: string;
    refine?: RefineResolveOpts;
    file?: ReturnType<typeof babelParse>;
    /** checkSource 预计算：ambient 侧车闭包指纹（独立调用时现算） */
    sidecarFp?: string;
  } = {},
): PolyFn | undefined {
  const extracted = extractFn(source, fnName, opts.file);
  if (!extracted) return undefined;
  const { params, body, env } = extracted;
  const budget = opts.budget ?? defaultLeakBudget;
  const label = opts.label ?? "A";

  const typeParams: TypeParam[] = params.map((p, i) => ({
    id: `${label}${i + 1}`,
    // 无约束参数 = any（任意 JS 值），不是 unknown（分析无信息）
    value: abs({ k: "any" }, termVar(`${label}${i + 1}`), pTrue, "path"),
  }));

  let entryReqs: Array<{ param: string; pred: import("./pred.ts").Pred }> | undefined;
  /** refine 契约带来的 entryShapes（source=refine，不重复提升） */
  const refineEntryShapes = new Map<
    string,
    { abs: Abs; source: RelSource }
  >();
  if (opts.refine) {
    try {
      // 有效契约单点读取（handwritten 与 generated 都可用——这是推导/展示
      // 入口面，非执法）。无源码指令且无 ambient 侧车时保持旧快路径行为。
      const r = opts.refine;
      const hasDirective =
        source.includes("@nudo:refine") || source.includes("@nudo:interface");
      const sc =
        opts.sidecarFp ??
        (r.loadModule && r.fromFile
          ? sidecarClosureFingerprint(r.fromFile, r)
          : undefined);
      const eff =
        hasDirective || sc !== undefined
          ? effectiveInterface(source, fnName, r)
          : undefined;
      const reqs = eff?.params ?? [];
      if (reqs.length > 0) {
        entryReqs = reqs.map((e) => ({
          param: e.param,
          pred: instantiateConstraint(e.constraint, e.param),
        }));
        for (const e of reqs) {
          const idx = params.indexOf(e.param);
          if (idx >= 0) {
            // 契约挂入口：term 用真实参数名，pred 一并带上
            const entryAbs = constraintToEntryAbs(e.constraint, e.param);
            typeParams[idx] = {
              id: typeParams[idx]!.id,
              value: entryAbs,
            };
            refineEntryShapes.set(e.param, {
              abs: snapshotAbs(entryAbs),
              source: "refine",
            });
          }
        }
      }
    } catch {
      // refine 解析失败时退回 any
    }
  }

  // L1+L2：同一 PolyFn 上按 (α-规范化 args, Φ) 缓存实例化。
  // 随 L0 的 PolyFn 共享；resetGeneralizeMemo 一并丢弃。
  const instMemo = new Map<string, InstHit>();

  const paramNames = new Set(params);
  const alphaIds = typeParams.map((t) => t.id);

  const run = (
    args: Abs[],
    phi: Phi = pTrue,
    collector?: import("./hof.ts").HofCollectCtx,
  ): Abs => {
    const { key, varOrder } = instantiateMemoKey(args, phi);
    const hit = instMemo.get(key);
    if (hit !== undefined) {
      return alphaRenameResult(hit.result, hit.varOrder, varOrder);
    }
    // symbolic 传入 collector 以沉淀关系；instantiate 装 throwaway collector——
    // 形状提升仍生效（§5.2.5），但 run 结束即丢，不写 PolyFn 共享状态。
    const hc = collector ?? createHofCollectCtx(paramNames, alphaIds);
    const local: AstEnv = {
      vars: new Map(env.vars),
      fns: env.fns,
      hofCollect: hc,
    };
    params.forEach((p, i) => {
      local.vars.set(p, args[i] ?? unknown);
    });
    const result = evalNode(body, local, phi, budget).value;
    // 截断/失败结果不缓存，避免固化过宽或不稳定结论
    if (isCacheableAbs(result)) {
      instMemo.set(key, { result, varOrder });
    }
    return result;
  };

  // symbolic 一次跑安装 collector 并沉淀；instantiate 不读其结果
  const hofCollector = createHofCollectCtx(paramNames, alphaIds);

  const symbolic = run(
    typeParams.map((t) => t.value),
    // 入口契约进 Φ，让 body 内的单调性可传播
    entryReqs && entryReqs.length > 0
      ? entryReqs.length === 1
        ? entryReqs[0]!.pred
        : { op: "and", args: entryReqs.map((r) => r.pred) }
      : pTrue,
    hofCollector,
  );

  // opaque = call-budget 截断/泄漏 → 不写关系；
  // partial 是 for-of/join 等诚实降级，提升过程完整，仍可沉淀快照。
  // （不得用 isCacheableAbs 当「run 成功」代理——它拒 partial，会误丢 applyEach 型关系。）
  let fnRels: Map<string, { abs: Abs; source: RelSource }> | undefined;
  let entryShapes: Map<string, { abs: Abs; source: RelSource }> | undefined;
  let hofSites: HofSite[] | undefined;

  if (symbolic.conf !== "opaque") {
    // refine 契约 entryShapes 优先；fn 形状同时进 fnRels（source=refine，供 P4 error）
    if (refineEntryShapes.size > 0) {
      entryShapes = new Map(refineEntryShapes);
      for (const [param, rec] of refineEntryShapes) {
        if (rec.abs.shape.k !== "fn") continue;
        if (!fnRels) fnRels = new Map();
        fnRels.set(param, { abs: snapshotAbs(rec.abs), source: rec.source });
      }
    }
    for (const [param, rec] of hofCollector.fnRels) {
      if (refineEntryShapes.has(param)) continue;
      if (!fnRels) fnRels = new Map();
      fnRels.set(param, { abs: snapshotAbs(rec.abs), source: rec.source });
    }
    for (const [param, rec] of hofCollector.entryShapes) {
      if (refineEntryShapes.has(param)) continue;
      if (!entryShapes) entryShapes = new Map();
      entryShapes.set(param, { abs: snapshotAbs(rec.abs), source: rec.source });
    }
    if (hofCollector.sites.length > 0) {
      hofSites = hofCollector.sites.map((s) => ({
        ...s,
        argTerms: [...s.argTerms],
        result: snapshotAbs(s.result),
      }));
    }
  }

  return {
    name: fnName,
    params,
    typeParams,
    symbolic,
    instantiate: (args, phi) => run(args, phi ?? pTrue),
    display: formatPoly(
      fnName,
      params,
      typeParams,
      symbolic,
      entryReqs,
      entryShapes,
      fnRels,
    ),
    ...(entryReqs ? { entryReqs } : {}),
    ...(fnRels ? { fnRels } : {}),
    ...(entryShapes ? { entryShapes } : {}),
    ...(hofSites ? { hofSites } : {}),
  };
}

function formatPoly(
  name: string,
  params: string[],
  typeParams: TypeParam[],
  symbolic: Abs,
  entryReqs?: Array<{ param: string; pred: import("./pred.ts").Pred }>,
  entryShapes?: Map<string, { abs: Abs; source: RelSource }>,
  fnRels?: Map<string, { abs: Abs; source: RelSource }>,
): string {
  const reqByParam = new Map((entryReqs ?? []).map((r) => [r.param, r.pred]));
  const ps = params
    .map((p, i) => {
      const id = typeParams[i]?.id ?? "unknown";
      const pred = reqByParam.get(p);
      // 提升快照优先（entryShapes / fnRels）
      const promoted =
        entryShapes?.get(p)?.abs ?? fnRels?.get(p)?.abs;
      if (promoted) {
        const slot = formatShapeSlot(promoted);
        if (pred && pred.op !== "true") {
          return `${p}: ${slot} where ${predToString(pred)}`;
        }
        return `${p}: ${slot}`;
      }
      if (pred && pred.op !== "true") {
        return `${p}: ${id} where ${predToString(pred)}`;
      }
      return `${p}: ${id}`;
    })
    .join(", ");
  const ret = formatShapeSlot(symbolic);
  const termPart =
    symbolic.term && symbolic.term.op !== "lit"
      ? ` = ${termToString(symbolic.term)}`
      : "";
  const predPart =
    symbolic.pred && symbolic.pred.op !== "true"
      ? `  where ${predToString(symbolic.pred)}`
      : "";
  return `${name}: (${ps}) => ${ret}${termPart}${predPart}`;
}

export function generalizeAll(
  source: string,
  opts: { budget?: LeakBudget } = {},
): PolyFn[] {
  const file = babelParse(source);
  const names: string[] = [];
  for (const stmt of file.program.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id) names.push(stmt.id.name);
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
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
  const out: PolyFn[] = [];
  for (const n of names) {
    const g = generalizeFromAst(n, source, opts);
    if (g) out.push(g);
  }
  return out;
}

/** 列出源码中的顶层函数名 */
export function listFunctionNames(source: string): string[] {
  const file = babelParse(source);
  const names: string[] = [];
  for (const stmt of file.program.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id) names.push(stmt.id.name);
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
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
 * 按 assume 集合构造实参：被 assume 的参数给带约束的符号，其余 unknown。
 */
export function buildArgsFromAssume(
  source: string,
  fnName: string,
  assumeIds: Set<string>,
): Abs[] {
  const extracted = extractFn(source, fnName);
  if (!extracted) return [];
  return extracted.params.map((p) => {
    if (assumeIds.has(p)) {
      // 默认假设 >0；更细的 assume 由 CLI 拼 Phi
      return abs(
        { k: "prim", type: "number" },
        termVar(p),
        { op: "gt", a: termVar(p), b: { op: "lit", value: 0 } },
        "path",
      );
    }
    return abs({ k: "unknown" }, undefined, undefined, "partial");
  });
}
