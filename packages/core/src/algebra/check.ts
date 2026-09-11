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
  type AbsAssignRecord,
} from "./ast-eval.ts";
import { defaultLeakBudget } from "./leak.ts";
import { leqAbs } from "./leq.ts";
import { generalizeFromAst } from "./generalize.ts";
import { numLit, unknown, abs as makeAbs } from "./abs.ts";
import type { Abs, Confidence } from "./abs.ts";
import type { Phi, Pred } from "./pred.ts";
import { pTrue, predToString } from "./pred.ts";
import { termToString } from "./term.ts";
import { litValue } from "./abs.ts";
import { formatAbs, formatAbsMultiline, formatShape } from "./format.ts";
import { checkCall, type Diagnostic } from "./diagnostics.ts";

/** 无损函数签名（类型即计算） */
export type NudoSig = {
  name: string;
  params: string[];
  /** 符号 Abs 本体 */
  abs: Abs;
  /** formatAbs 单行 */
  display: string;
  /** formatAbsMultiline */
  detail: string;
  conf: Confidence;
};

export type CheckIssue = Diagnostic & {
  fn?: string;
  line?: number;
  column?: number;
  /** 实参 / 实际值的 Abs 展示 */
  actual?: string;
  /** 期望约束（Pred 或 Abs 展示） */
  expected?: string;
};

export type CheckReport = {
  file: string;
  issues: CheckIssue[];
  /** 有 error 则 CI 应失败 */
  ok: boolean;
  /** Abs 优先的签名表（替代 TS 式 display-only） */
  signatures: NudoSig[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    functions: number;
  };
};

/**
 * check 选项：core 不碰 fs；host 用 loadModule 喂 require 目标源码。
 */
export type CheckOptions = {
  /** 相对/绝对 require 说明符 → 模块源码；undefined = 解析失败 */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  /** 当前文件路径（供 loadModule 解析相对 spec） */
  fromFile?: string;
};

function listTopFunctions(source: string): string[] {
  const file = parse(source);
  const names: string[] = [];
  for (const stmt of file.program.body) {
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
 */
export function checkSource(
  filePath: string,
  source: string,
  phi: Phi = pTrue,
  opts: CheckOptions = {},
): CheckReport {
  const issues: CheckIssue[] = [];
  const signatures: NudoSig[] = [];
  const names = listTopFunctions(source);

  for (const name of names) {
    const g = generalizeFromAst(name, source);
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
    signatures.push({
      name,
      params: g.params,
      abs: g.symbolic,
      display: formatAbs(g.symbolic),
      detail: formatAbsMultiline(g.symbolic, name),
      conf: g.symbolic.conf,
    });

    const entryArgs = g.params.map((): Abs => absUnknown());
    try {
      const r = analyzeFn(source, name, entryArgs, phi);
      if (r.conf === "opaque") {
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

  const callIssues = scanLiteralCalls(source, names, phi, {
    loadModule: opts.loadModule,
    fromFile: filePath,
  });
  issues.push(...callIssues);

  // 结构可赋值：赋值语句 prev ⊇ next（Abs leq）
  issues.push(...scanStructuralAssign(source));

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

/**
 * 结构可赋值：`let a = {x:1}; a = {y:2}` 应报 missing slot x。
 * 顺序 Abs 求值 + leqAbs；仅检查有 prev 绑定的标识符赋值。
 */
function scanStructuralAssign(source: string): CheckIssue[] {
  const out: CheckIssue[] = [];
  const records: AbsAssignRecord[] = [];
  setAbsAssignCollector((r) => records.push(r));
  try {
    evalProgramAbs(source);
  } catch {
    return out;
  } finally {
    setAbsAssignCollector(null);
  }
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

/** 从函数体抽参数必填 slot：`function f(p){ return p.x + p.y }` → {p: {x,y}} */
function collectParamStructReqs(
  source: string,
  fnName: string,
): Map<string, Set<string>> {
  const reqs = new Map<string, Set<string>>();
  const g = generalizeFromAst(fnName, source);
  if (!g) return reqs;
  const params = new Set(g.params);
  const file = parse(source);

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };
    if (obj.type === "MemberExpression" && !obj.computed) {
      const o = obj.object as { type?: string; name?: string } | undefined;
      const p = obj.property as { type?: string; name?: string } | undefined;
      if (o?.type === "Identifier" && o.name && params.has(o.name) && p?.type === "Identifier" && p.name) {
        let set = reqs.get(o.name);
        if (!set) {
          set = new Set();
          reqs.set(o.name, set);
        }
        set.add(p.name);
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
  return reqs;
}

/** 静态求值实参节点 → Abs（标识符走绑定表） */
function evalArgAbs(
  node: Record<string, unknown>,
  lookupVar?: (name: string) => Abs | undefined,
): Abs | undefined {
  if (node.type === "Identifier" && typeof node.name === "string" && lookupVar) {
    return lookupVar(node.name);
  }
  try {
    const env = emptyEnv();
    return evalNode(node as unknown as Node, env, pTrue, defaultLeakBudget).value;
  } catch {
    return undefined;
  }
}

/** 整文件顺序求值后的绑定表（标识符实参用） */
function snapshotVarAbs(source: string): Map<string, Abs> {
  const map = new Map<string, Abs>();
  try {
    const { env } = evalProgramAbs(source);
    for (const [k, v] of env.vars) map.set(k, v);
  } catch {
    // ignore
  }
  return map;
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

function collectCallResolvers(
  source: string,
  knownFns: string[],
  opts?: { loadModule?: (spec: string, fromFile: string) => string | undefined; fromFile?: string },
): CallResolve {
  const aliasToFn = new Map<string, string>();
  const memberToFn = new Map<string, string>();
  const externalFn = new Map<string, { source: string; fnName: string }>();
  const externalMember = new Map<string, { source: string; fnName: string }>();
  const file = parse(source);
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
        if (init.type === "Identifier" && typeof init.name === "string" && knownFns.includes(init.name)) {
          aliasToFn.set(id.name, init.name);
        }
        // const api = { needsPositive }
        if (init.type === "ObjectExpression") {
          for (const p of (init.properties as Array<Record<string, unknown>> | undefined) ?? []) {
            if (p.type !== "ObjectProperty") continue;
            const key = p.key as { type?: string; name?: string; value?: unknown };
            const value = p.value as { type?: string; name?: string } | undefined;
            if (value?.type === "Identifier" && value.name && knownFns.includes(value.name)) {
              const propKey =
                key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? String(key.value) : undefined;
              if (propKey) memberToFn.set(`${id.name}.${propKey}`, value.name);
            }
          }
        }
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
  return { aliasToFn, memberToFn, externalFn, externalMember };
}

/** 解析 callee → 同文件名或外部模块描述 */
function resolveCalleeFn(
  callee: Record<string, unknown>,
  resolve: CallResolve,
  knownFns: string[],
): string | { external: { source: string; fnName: string } } | undefined {
  if (callee.type === "Identifier" && typeof callee.name === "string") {
    const ext = resolve.externalFn.get(callee.name);
    if (ext) return { external: ext };
    const aliased = resolve.aliasToFn.get(callee.name);
    if (aliased) return aliased;
    if (knownFns.includes(callee.name)) return callee.name;
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
  knownFns: string[],
  resolve: CallResolve,
): Map<string, Forward> {
  const forwards = new Map<string, Forward>();
  const file = parse(source);

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
    if (!knownFns.includes(resolved) || resolved === name) return;

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

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };
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
    for (const key of Object.keys(obj)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const val = obj[key];
      if (Array.isArray(val)) val.forEach(visit);
      else if (val && typeof val === "object") visit(val);
    }
  };
  visit(file);
  return forwards;
}

/** 找 `name(literalArgs)` / `alias(lit)` / `obj.fn(lit)` / require 导入，检查约束 */
function scanLiteralCalls(
  source: string,
  knownFns: string[],
  phi: Phi,
  opts?: { loadModule?: (spec: string, fromFile: string) => string | undefined; fromFile?: string },
): CheckIssue[] {
  const out: CheckIssue[] = [];
  const file = parse(source);
  const resolve = collectCallResolvers(source, knownFns, opts);
  const forwards = collectForwarders(source, knownFns, resolve);
  const varAbs = snapshotVarAbs(source);

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
      if (
        lv !== undefined &&
        (pred.op === "gt" || pred.op === "ge" || pred.op === "lt" || pred.op === "le") &&
        pred.b.op === "lit" &&
        typeof pred.b.value === "number"
      ) {
        const n = pred.b.value;
        let ok = true;
        if (pred.op === "gt") ok = (lv as number) > n;
        if (pred.op === "ge") ok = (lv as number) >= n;
        if (pred.op === "lt") ok = (lv as number) < n;
        if (pred.op === "le") ok = (lv as number) <= n;
        if (!ok) {
          const paramName = paramNames[idx] ?? `arg${idx}`;
          out.push({
            severity: "error",
            code: "nudo:constraint-violated",
            message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
            actual: formatAbs(arg),
            expected: predToString(pred),
            suggestion: `改用满足 ${predToString(pred)} 的值，或放宽 ${paramName} 的前置`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
      }
    }
  };

  const parseLitArgs = (
    args: Array<Record<string, unknown>>,
  ): { absArgs: Abs[]; allLit: boolean } => {
    const absArgs: Abs[] = [];
    let allLit = true;
    for (const a of args ?? []) {
      if (a.type === "NumericLiteral" && typeof a.value === "number") {
        absArgs.push(numLit(a.value));
      } else if (
        a.type === "UnaryExpression" &&
        (a as { operator?: string }).operator === "-" &&
        (a as { argument?: Record<string, unknown> }).argument?.type === "NumericLiteral"
      ) {
        const num = (a as { argument: { value: number } }).argument;
        absArgs.push(numLit(-num.value));
      } else {
        allLit = false;
        absArgs.push(absUnknown());
      }
    }
    return { absArgs, allLit };
  };

  const checkOneCall = (
    fnName: string,
    args: Array<Record<string, unknown>>,
    loc?: { start: { line: number; column: number } },
  ): void => {
    if (!knownFns.includes(fnName)) return;

    // 传参结构：实参字面量 Abs ≤ 形参必填 slot
    checkArgStructures(fnName, source, args, loc);

    const { absArgs, allLit } = parseLitArgs(args);
    if (!allLit || absArgs.length === 0) return;

    const ownReqs = extractParamReqsFromSource(source, fnName);
    const g = generalizeFromAst(fnName, source);
    const paramNames = g?.params ?? [];
    checkReqs(fnName, ownReqs, paramNames, absArgs, (i) => i, loc);

    const fwd = forwards.get(fnName);
    if (fwd) {
      const tReqs = extractParamReqsFromSource(source, fwd.target);
      if (tReqs.length > 0) {
        const tg = generalizeFromAst(fwd.target, source);
        const tParams = tg?.params ?? [];
        const wrapperArgOfTarget = new Map<number, number>();
        fwd.map.forEach((wrapperIdx, targetIdx) => {
          wrapperArgOfTarget.set(targetIdx, wrapperIdx);
        });
        checkReqs(
          `${fnName}→${fwd.target}`,
          tReqs,
          tParams,
          absArgs,
          (targetIdx) => wrapperArgOfTarget.get(targetIdx),
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
    const { absArgs, allLit } = parseLitArgs(args);
    if (!allLit || absArgs.length === 0) return;
    let reqs: Array<[number, Pred]> = [];
    let paramNames: string[] = [];
    try {
      reqs = extractParamReqsFromSource(ext.source, ext.fnName);
      const g = generalizeFromAst(ext.fnName, ext.source);
      paramNames = g?.params ?? [];
    } catch {
      return;
    }
    checkReqs(displayName, reqs, paramNames, absArgs, (i) => i, loc);
  };

  /**
   * 实参结构 ≤ 形参必填 slot（从 `p.foo` 访问推出）。
   * 字面量节点静态求 Abs；标识符用文件绑定表。
   */
  const checkArgStructures = (
    fnName: string,
    fnSource: string,
    args: Array<Record<string, unknown>>,
    loc?: { start: { line: number; column: number } },
    displayName?: string,
  ): void => {
    let structReqs: Map<string, Set<string>>;
    let paramNames: string[];
    try {
      structReqs = collectParamStructReqs(fnSource, fnName);
      const g = generalizeFromAst(fnName, fnSource);
      paramNames = g?.params ?? [];
    } catch {
      return;
    }
    if (structReqs.size === 0) return;
    for (let i = 0; i < args.length; i++) {
      const pname = paramNames[i];
      if (!pname) continue;
      const keys = structReqs.get(pname);
      if (!keys || keys.size === 0) continue;
      const argNode = args[i];
      if (!argNode) continue;
      const absArg = evalArgAbs(argNode, (n) => varAbs.get(n));
      if (!absArg || absArg.shape.k === "unknown") continue;
      const slots: Record<string, { value: Abs }> = {};
      for (const k of keys) slots[k] = { value: absUnknown() };
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
      const resolved = resolveCalleeFn(callee, resolve, knownFns);
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

/** 从函数体抽 if (param ≷ n) return param 形态的前置约束（含 && 双侧） */
function extractParamReqsFromSource(
  source: string,
  fnName: string,
): Array<[number, import("./pred.ts").Pred]> {
  const g = generalizeFromAst(fnName, source);
  if (!g) return [];
  const paramIndex = new Map(g.params.map((p, i) => [p, i]));
  const file = parse(source);
  const out: Array<[number, import("./pred.ts").Pred]> = [];

  const pushCmp = (
    test: Record<string, unknown>,
    consequent: Record<string, unknown> | undefined,
  ): void => {
    if (test?.type !== "BinaryExpression") return;
    const left = test.left as { type?: string; name?: string };
    const right = test.right as { type?: string; value?: number };
    const op = test.operator as string;
    if (
      left?.type !== "Identifier" ||
      !left.name ||
      !paramIndex.has(left.name) ||
      right?.type !== "NumericLiteral" ||
      typeof right.value !== "number"
    ) {
      return;
    }
    // 仅 `if (param ≷ n) return param` 视为成功路径前置；
    // `if (id > 9999) return 9999` 是 clamp，不是调用前置。
    const isReturnParam =
      consequent?.type === "ReturnStatement" &&
      (consequent.argument as { type?: string; name?: string })?.type ===
        "Identifier" &&
      (consequent.argument as { name?: string }).name === left.name;
    if (!isReturnParam) return;
    const idx = paramIndex.get(left.name)!;
    const t = { op: "var" as const, id: left.name };
    const b = { op: "lit" as const, value: right.value };
    if (op === ">") out.push([idx, { op: "gt", a: t, b }]);
    else if (op === ">=") out.push([idx, { op: "ge", a: t, b }]);
    else if (op === "<") out.push([idx, { op: "lt", a: t, b }]);
    else if (op === "<=") out.push([idx, { op: "le", a: t, b }]);
  };

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };
    if (obj.type === "IfStatement") {
      const test = obj.test as Record<string, unknown>;
      const consequent = obj.consequent as Record<string, unknown> | undefined;
      pushCmp(test, consequent);
      // `if (a > 0 && a <= 100) return a`
      if (test?.type === "LogicalExpression" && test.operator === "&&") {
        pushCmp(test.left as Record<string, unknown>, consequent);
        pushCmp(test.right as Record<string, unknown>, consequent);
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

/**
 * `nudo check --json` 稳定契约（供 CI / Agent）。
 * 字段只增不改语义；Abs 以 formatAbs 字符串给出，不序列化内部 shape 图。
 */
export type CheckJson = {
  version: 1;
  file: string;
  ok: boolean;
  summary: CheckReport["summary"];
  signatures: Array<{
    name: string;
    params: string[];
    display: string;
    detail: string;
    conf: string;
    abs: string;
  }>;
  issues: Array<{
    severity: string;
    code: string;
    message: string;
    fn?: string;
    line?: number;
    column?: number;
    actual?: string;
    expected?: string;
    suggestion?: string;
  }>;
};

export function serializeCheckJson(r: CheckReport): CheckJson {
  return {
    version: 1,
    file: r.file,
    ok: r.ok,
    summary: { ...r.summary },
    signatures: r.signatures.map((s) => ({
      name: s.name,
      params: [...s.params],
      display: s.display,
      detail: s.detail,
      conf: s.conf,
      abs: formatAbs(s.abs),
    })),
    issues: r.issues.map((i) => ({
      severity: i.severity,
      code: i.code,
      message: i.message,
      ...(i.fn !== undefined ? { fn: i.fn } : {}),
      ...(i.line !== undefined ? { line: i.line } : {}),
      ...(i.column !== undefined ? { column: i.column } : {}),
      ...(i.actual !== undefined ? { actual: i.actual } : {}),
      ...(i.expected !== undefined ? { expected: i.expected } : {}),
      ...(i.suggestion !== undefined ? { suggestion: i.suggestion } : {}),
    })),
  };
}

/**
 * Nudo 原生报告：Abs 签名表 + actual ⊭ expected。
 * 不是 tsc 输出的换皮。
 */
export function formatCheckReport(r: CheckReport, opts: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(`nudo check  ${r.file}`);
  lines.push(r.ok ? "OK" : "FAILED");
  lines.push(
    `  ${r.summary.errors} error · ${r.summary.warnings} warning · ${r.summary.infos} info · ${r.summary.functions} fn`,
  );

  if (r.signatures.length > 0) {
    lines.push("");
    lines.push("signatures");
    for (const s of r.signatures) {
      lines.push(`  ${s.name}(${s.params.join(", ")})  ${s.display}`);
      if (opts.verbose) {
        for (const ln of s.detail.split("\n").slice(1)) {
          lines.push(`  ${ln}`);
        }
      }
    }
  }

  if (r.issues.length === 0) {
    lines.push("");
    lines.push("(no issues)");
  } else {
    lines.push("");
    lines.push("issues");
    for (const i of r.issues) {
      const loc = i.line != null ? `L${i.line}` : "";
      const head = [i.severity.toUpperCase(), loc, i.fn].filter(Boolean).join(" ");
      lines.push(`  [${head}] ${i.message}  (${i.code})`);
      if (i.actual) lines.push(`      actual:   ${i.actual}`);
      if (i.expected) lines.push(`      expected: ${i.expected}`);
      if (i.suggestion) lines.push(`      → ${i.suggestion}`);
    }
  }
  return lines.join("\n");
}
