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
import type { AstEnv } from "./ast-eval.ts";
import { evalNode, emptyEnv } from "./ast-eval.ts";
import { defaultLeakBudget, type LeakBudget } from "./leak.ts";
import { formatShape } from "./format.ts";
import {
  extractRefinesFromSource,
  type RefineResolveOpts,
} from "./refine.ts";
import { constraintToEntryAbs } from "./constraint.ts";

/** 进程内 L0：同 (source, fn, refine, budget, label) 的 generalize 结果 */
const generalizeMemo = new Map<string, PolyFn | undefined>();
const loadModuleIds = new WeakMap<object, number>();
let nextLoadModuleId = 1;

export function resetGeneralizeMemo(): void {
  generalizeMemo.clear();
}

function hashSource(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
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

function generalizeMemoKey(
  fnName: string,
  source: string,
  opts: {
    budget?: LeakBudget;
    label?: string;
    refine?: RefineResolveOpts;
  },
): string {
  const r = opts.refine;
  const budget = opts.budget ?? defaultLeakBudget;
  return [
    hashSource(source),
    fnName,
    opts.label ?? "A",
    r ? `${loadModuleId(r.loadModule)}:${r.fromFile ?? ""}` : "-",
    `${budget.maxDepth}/${budget.maxNodes}`,
  ].join("|");
}

/** L1 只缓存完整可复用结果；截断/失败产生的 partial|opaque 不进缓存 */
function isCacheableAbs(a: Abs): boolean {
  return (
    a.conf === "exact" ||
    a.conf === "path" ||
    a.conf === "widened" ||
    a.conf === "mock"
  );
}

function termKey(t: Term): string {
  switch (t.op) {
    case "lit":
      return `L:${typeof t.value}:${String(t.value)}`;
    case "var":
      return `V:${t.id}`;
    case "app":
      return `A:${t.fn}(${t.args.map(termKey).join(",")})`;
  }
}

function predKey(p: Pred): string {
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
      return `${p.op}(${termKey(p.a)},${termKey(p.b)})`;
    case "and":
    case "or":
      return `${p.op}(${p.args.map(predKey).join(",")})`;
    case "not":
      return `not(${predKey(p.arg)})`;
    case "typeof":
      return `typeof(${termKey(p.t)},${p.type})`;
  }
}

/** 结构键：shape + term + pred；不含 conf（置信度不参与语义输入） */
function shapeKey(s: Shape, seen: Set<object>): string {
  switch (s.k) {
    case "never":
    case "any":
    case "unknown":
      return s.k;
    case "prim":
      return `p:${s.type}`;
    case "brand":
      return `b:${s.name}(${absKeyInner(s.shape, seen)})`;
    case "eff":
      return `e:${s.eff}<${absKeyInner(s.inner, seen)}>`;
    case "arr":
      return `arr(${absKeyInner(s.element, seen)})`;
    case "tuple": {
      const els = s.elements.map((e) => absKeyInner(e, seen)).join(",");
      const rest = s.rest ? `...${absKeyInner(s.rest, seen)}` : "";
      return `tup[${els}${rest}]`;
    }
    case "fn": {
      const pts = (s.paramTypes ?? []).map((t) => absKeyInner(t, seen)).join(",");
      const ret = s.returnType ? absKeyInner(s.returnType, seen) : "?";
      const name = s.name ? `#${s.name}` : "";
      return `fn${name}(${s.params.join(",")}|${pts})=>${ret}`;
    }
    case "sum":
      return `sum(${s.members.map((m) => absKeyInner(m, seen)).join("|")})`;
    case "obj": {
      const slots = Object.keys(s.slots)
        .sort()
        .map((k) => {
          const slot = s.slots[k]!;
          const flags = (slot.optional ? "?" : "") + (slot.readonly ? "r" : "");
          return `${k}${flags}:${absKeyInner(slot.value, seen)}`;
        })
        .join(",");
      const idx = s.index
        ? `idx(${absKeyInner(s.index.key, seen)}→${absKeyInner(s.index.value, seen)})`
        : "";
      const open = s.open ? "open" : "";
      return `obj{${slots}}${idx}${open}`;
    }
  }
}

function absKeyInner(a: Abs, seen: Set<object>): string {
  if (seen.has(a)) return "cycle";
  seen.add(a);
  const t = a.term ? `=${termKey(a.term)}` : "";
  const p = a.pred ? `@${predKey(a.pred)}` : "";
  return `${shapeKey(a.shape, seen)}${t}${p}`;
}

function absStructKey(a: Abs): string {
  return absKeyInner(a, new Set());
}

function instantiateMemoKey(args: Abs[], phi: Phi): string {
  return `${args.map(absStructKey).join(";")}#${predKey(phi)}`;
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
};

function extractFn(
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
  } = {},
): PolyFn | undefined {
  const key = generalizeMemoKey(fnName, source, opts);
  if (generalizeMemo.has(key)) {
    return generalizeMemo.get(key);
  }
  const result = generalizeFromAstUncached(fnName, source, opts);
  generalizeMemo.set(key, result);
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
  if (opts.refine) {
    try {
      const reqs = extractRefinesFromSource(source, fnName, opts.refine);
      if (reqs.length > 0) {
        entryReqs = reqs.map((r) => ({ param: r.param, pred: r.pred }));
        for (const r of reqs) {
          const idx = params.indexOf(r.param);
          if (idx >= 0) {
            // 契约挂入口：term 用真实参数名，pred 一并带上
            typeParams[idx] = {
              id: typeParams[idx]!.id,
              value: constraintToEntryAbs(r.constraint, r.param),
            };
          }
        }
      }
    } catch {
      // refine 解析失败时退回 any
    }
  }

  // L1：同一 PolyFn 上按 (args Abs 结构, Φ) 缓存实例化结果。
  // 随 L0 的 PolyFn 共享；resetGeneralizeMemo 一并丢弃。
  const instMemo = new Map<string, Abs>();

  const run = (args: Abs[], phi: Phi = pTrue): Abs => {
    const key = instantiateMemoKey(args, phi);
    const hit = instMemo.get(key);
    if (hit !== undefined) return hit;
    const local: AstEnv = { vars: new Map(env.vars), fns: env.fns };
    params.forEach((p, i) => {
      local.vars.set(p, args[i] ?? unknown);
    });
    const result = evalNode(body, local, phi, budget).value;
    // 截断/失败结果不缓存，避免固化过宽或不稳定结论
    if (isCacheableAbs(result)) {
      instMemo.set(key, result);
    }
    return result;
  };

  const symbolic = run(
    typeParams.map((t) => t.value),
    // 入口契约进 Φ，让 body 内的单调性可传播
    entryReqs && entryReqs.length > 0
      ? entryReqs.length === 1
        ? entryReqs[0]!.pred
        : { op: "and", args: entryReqs.map((r) => r.pred) }
      : pTrue,
  );

  return {
    name: fnName,
    params,
    typeParams,
    symbolic,
    instantiate: (args, phi) => run(args, phi ?? pTrue),
    display: formatPoly(fnName, params, typeParams, symbolic, entryReqs),
    ...(entryReqs ? { entryReqs } : {}),
  };
}

function formatPoly(
  name: string,
  params: string[],
  typeParams: TypeParam[],
  symbolic: Abs,
  entryReqs?: Array<{ param: string; pred: import("./pred.ts").Pred }>,
): string {
  const reqByParam = new Map((entryReqs ?? []).map((r) => [r.param, r.pred]));
  const ps = params
    .map((p, i) => {
      const id = typeParams[i]?.id ?? "unknown";
      const pred = reqByParam.get(p);
      if (pred && pred.op !== "true") {
        return `${p}: ${id} where ${predToString(pred)}`;
      }
      return `${p}: ${id}`;
    })
    .join(", ");
  const ret = formatShape(symbolic);
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
