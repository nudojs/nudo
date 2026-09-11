/**
 * 真·generalize：在新鲜类型变量 α 上执行用户函数，归纳多态签名，
 * 并支持调用点实例化。
 *
 * - generalize 保留 term 结构（λα. α+1）
 * - 调用点实例化把 α 换成具体 Abs 后再求值
 */

import { parseSource as babelParse } from "./parse-source.ts";
import type { Node } from "@babel/types";
import { v as termVar, termToString } from "./term.ts";
import type { Phi } from "./pred.ts";
import { pTrue, predToString } from "./pred.ts";
import type { Abs } from "./abs.ts";
import { abs, unknown } from "./abs.ts";
import type { AstEnv } from "./ast-eval.ts";
import { evalNode, emptyEnv } from "./ast-eval.ts";
import { defaultLeakBudget, type LeakBudget } from "./leak.ts";
import { formatShape } from "./format.ts";
import {
  extractRequiresFromSource,
  type RequiresResolveOpts,
} from "./requires.ts";
import { constraintToEntryAbs } from "./constraint.ts";

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
  /** 入口契约（@nudo:requires），供签名/inlay 展示 */
  entryReqs?: Array<{ param: string; pred: import("./pred.ts").Pred }>;
};

function extractFn(
  source: string,
  fnName: string,
): { params: string[]; body: Node; env: AstEnv } | undefined {
  const file = babelParse(source);
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
    /** 传入则把 @nudo:requires 挂到入口 param Abs */
    requires?: RequiresResolveOpts;
  } = {},
): PolyFn | undefined {
  const extracted = extractFn(source, fnName);
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
  if (opts.requires) {
    try {
      const reqs = extractRequiresFromSource(source, fnName, opts.requires);
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
      // requires 解析失败时退回 any
    }
  }

  const run = (args: Abs[], phi: Phi = pTrue): Abs => {
    const local: AstEnv = { vars: new Map(env.vars), fns: env.fns };
    params.forEach((p, i) => {
      local.vars.set(p, args[i] ?? unknown);
    });
    return evalNode(body, local, phi, budget).value;
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
