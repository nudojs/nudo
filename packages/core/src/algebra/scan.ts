/**
 * 源码级调用图侦察：从 check 门禁拆出的 AST 扫描层。
 *
 * 职责：不做代数求值结论，只回答「谁在调用谁、实参长什么样」——
 * - listTopFunctions：顶层函数清单
 * - collectCallResolvers / resolveCalleeFn / collectForwarders：别名 / 对象属性 /
 *   require / 动态 import / 无条件转发 的调用解析
 * - scanLiteralCalls：字面量调用点实参 vs 前置约束的违例收集
 */

import { parseSource as parse } from "./parse-source.ts";
import type { Node } from "@babel/types";
import { emptyEnv, evalNode, evalProgramAbs } from "./ast-eval.ts";
import { defaultLeakBudget } from "./leak.ts";
import { leqAbs } from "./leq.ts";
import type { RefineEntry } from "./refine.ts";
import { instantiateConstraint, type NudoConstraint, type NudoField } from "./constraint.ts";
import {
  effectiveInterface,
  formatConstraint,
  type EffectiveInterface,
  type EffectiveInterfaceOpts,
} from "./interface.ts";
import { literalMeetsConstraint } from "./domain-membership.ts";
import { getTvConfidence } from "./bridge.ts";
import type { TypeValue } from "../type-value.ts";
import { resolveDepPath } from "./load-deps-fp.ts";
import { extractFn, generalizeFromAst, type PolyFn } from "./generalize.ts";
import { numLit, abs as makeAbs, litValue } from "./abs.ts";
import type { Abs } from "./abs.ts";
import type { Phi, Pred } from "./pred.ts";
import { pTrue, predToString } from "./pred.ts";
import { formatAbs, formatShape } from "./format.ts";
import type { CheckIssue } from "./check-report.ts";
import { getFnImpl } from "./abs-fn.ts";

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

/** 顶层函数清单：function 声明 + const 箭头/函数表达式（含 export 包装） */
export function listTopFunctions(source: string, file?: ReturnType<typeof parse>): string[] {
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

export function absUnknown(): Abs {
  return { shape: { k: "unknown" }, conf: "partial" };
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

  const visit = (n: unknown, isMethodCallee = false, guarded = false): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };
    // 守卫保护的访问不构成必填：`x && x.__esModule && x.default` 里
    // __esModule/default 只在 x 真值时才读——缺失不应报 arg-structure。
    if (obj.type === "LogicalExpression") {
      // 左侧不受本表达式守卫（沿用外层语境），右侧被左侧的真值/假值守卫
      visit(obj.left, false, guarded);
      visit(obj.right, false, true);
      return;
    }
    if (obj.type === "ConditionalExpression") {
      visit(obj.test, false, guarded);
      visit(obj.consequent, false, true);
      visit(obj.alternate, false, true);
      return;
    }
    if (obj.type === "IfStatement") {
      visit(obj.test, false, guarded);
      visit(obj.consequent, false, true);
      visit(obj.alternate, false, true);
      return;
    }
    if (obj.type === "MemberExpression" && !obj.computed && !isMethodCallee) {
      const o = obj.object as { type?: string; name?: string } | undefined;
      const p = obj.property as { type?: string; name?: string } | undefined;
      if (o?.type === "Identifier" && o.name && params.has(o.name) && p?.type === "Identifier" && p.name) {
        // 方法调用（p.some()）或内置方法名 → 不是必填数据字段
        if (BUILTIN_METHODS.has(p.name)) return;
        if (guarded) return;
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
      visit(obj.callee, true, guarded);
      for (const key of Object.keys(obj)) {
        if (key === "loc" || key === "start" || key === "end" || key === "callee") continue;
        const val = obj[key];
        if (Array.isArray(val)) val.forEach((v) => visit(v, false, guarded));
        else if (val && typeof val === "object") visit(val, false, guarded);
      }
      return;
    }
    for (const key of Object.keys(obj)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const val = obj[key];
      if (Array.isArray(val)) val.forEach((v) => visit(v, isMethodCallee, guarded));
      else if (val && typeof val === "object") visit(val, isMethodCallee, guarded);
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

/** 外部模块函数：源码 + 导出名 + 定义文件虚拟路径（interface 侧车解析基；不可得 → 省略） */
type ExternalFnRef = { source: string; fnName: string; fromFile?: string };

/** 扫描前收集：别名 / 对象属性 / require 导入 */
type CallResolve = {
  /** 本地名 → 真实函数名（同文件） */
  aliasToFn: Map<string, string>;
  /** 对象名.属性名 → 真实函数名（同文件） */
  memberToFn: Map<string, string>;
  /** 本地名 → 外部模块函数（源码 + 导出名 + 定义文件路径） */
  externalFn: Map<string, ExternalFnRef>;
  /** 对象名.属性名 → 外部模块函数 */
  externalMember: Map<string, ExternalFnRef>;
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
 * 返回定义了该函数的源码及其虚拟路径——interface 侧车绑定按最终定义文件定位。
 * 跳转 spec 由 loadSpec 相对 baseFromFile 解析（既有口径），路径用 resolveDepPath 同基拼接，保证与实际装载位置一致。
 */
function resolveExportSource(
  modSrc: string,
  fnName: string,
  loadSpec: (spec: string) => string | undefined,
  depth = 0,
  baseFromFile = "",
  modFromFile = "",
): { source: string; fromFile: string } {
  const here = (): { source: string; fromFile: string } => ({
    source: modSrc,
    fromFile: modFromFile,
  });
  if (depth > 3) return here();
  try {
    if (listTopFunctions(modSrc).includes(fnName)) return here();
  } catch {
    return here();
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
  if (!nextSpec) return here();
  const next = loadSpec(nextSpec);
  if (!next) return here();
  return resolveExportSource(
    next,
    fnName,
    loadSpec,
    depth + 1,
    baseFromFile,
    baseFromFile ? resolveDepPath(baseFromFile, nextSpec) : "",
  );
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
  const externalFn = new Map<string, ExternalFnRef>();
  const externalMember = new Map<string, ExternalFnRef>();
  const file = opts?.file ?? parse(source);
  const load = opts?.loadModule;
  const fromFile = opts?.fromFile ?? "";
  const modCache = new Map<string, string | undefined>();
  const loadSpec = (spec: string): string | undefined => {
    if (!load) return undefined;
    if (!modCache.has(spec)) modCache.set(spec, load(spec, fromFile));
    return modCache.get(spec);
  };
  /** import spec → 被引模块的虚拟路径（interface 侧车解析基；无 fromFile 时不可得） */
  const extFromFile = (spec: string): string | undefined =>
    fromFile ? resolveDepPath(fromFile, spec) : undefined;
  const bindExternal = (local: string, modSrc: string, fnName: string, spec: string): void => {
    const r = resolveExportSource(modSrc, fnName, loadSpec, 0, fromFile, extFromFile(spec) ?? "");
    externalFn.set(local, {
      source: r.source,
      fnName,
      ...(r.fromFile ? { fromFile: r.fromFile } : {}),
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
                bindExternal(local.name, modSrc, exportName, String(spec.value));
              }
            } else if (sp.type === "ImportNamespaceSpecifier") {
              const local = sp.local as { type?: string; name?: string } | undefined;
              if (local?.name) {
                const from = extFromFile(String(spec.value));
                externalMember.set(
                  `${local.name}.__module__`,
                  { source: modSrc, fnName: "", ...(from ? { fromFile: from } : {}) },
                );
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
              if (exported && local) bindExternal(local, modSrc, exported, dynSpec);
            }
          }
          if (modSrc && id.type === "Identifier" && id.name) {
            const from = extFromFile(dynSpec);
            externalMember.set(
              `${id.name}.__module__`,
              { source: modSrc, fnName: "", ...(from ? { fromFile: from } : {}) },
            );
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
                bindExternal(local, modSrc, exported, spec);
              }
            }
          }
          // const m = require(...) → m.fn
          if (id.type === "Identifier" && id.name && modSrc) {
            const exportName = requireExportName(init);
            if (exportName) {
              bindExternal(id.name, modSrc, exportName, spec);
            } else {
              const from = extFromFile(spec);
              externalMember.set(
                `${id.name}.__module__`,
                { source: modSrc, fnName: "", ...(from ? { fromFile: from } : {}) },
              );
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
): string | { external: ExternalFnRef } | undefined {
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
        return {
          external: {
            source: mod.source,
            fnName: prop.name,
            ...(mod.fromFile ? { fromFile: mod.fromFile } : {}),
          },
        };
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
export function scanLiteralCalls(
  source: string,
  knownFns: string[],
  phi: Phi,
  opts?: {
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    fromFile?: string;
    file?: ReturnType<typeof parse>;
    /** 顶层绑定表（与结构赋值共享的 evalProgramAbs 结果） */
    varAbs?: Map<string, Abs>;
    /** 侧车 ambient 绑定开关（checkSource 的 package.json 配置下传） */
    autoBind?: boolean;
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

  /**
   * effectiveInterface（§11 唯一读取口）调用侧收口：
   * - 同次扫描内按 (fn, fromFile, autoBind) 缓存——localNamedExports 走
   *   errorRecovery 解析不进 parse LRU，逐调用点重解析会放大开销。
   * - §3.3 执法分档：只有 handwritten 契约执法；generated 段是事实快照
   *   （drift 由后续检查报），implicit 无契约。
   */
  const eiCache = new Map<string, EffectiveInterface | undefined>();
  const effectiveInterfaceOf = (
    fnName: string,
    fnSource: string,
    eiOpts: EffectiveInterfaceOpts,
  ): EffectiveInterface | undefined => {
    const key = `${fnName}\u0000${eiOpts.fromFile ?? ""}\u0000${eiOpts.autoBind === false ? "0" : "1"}\u0000${fnSource.length}`;
    if (eiCache.has(key)) return eiCache.get(key);
    const r = effectiveInterface(fnSource, fnName, eiOpts);
    eiCache.set(key, r);
    return r;
  };

  /** effectiveInterface → [paramIdx, RefineEntry]（pred/constraint 与旧 refineToIndexedFull 同构） */
  const interfaceToIndexed = (
    ei: EffectiveInterface,
    paramNames: string[],
  ): Array<[number, RefineEntry]> => {
    const entries: Array<[number, RefineEntry]> = [];
    for (const { param, constraint } of ei.params) {
      const idx = paramNames.indexOf(param);
      if (idx >= 0) {
        entries.push([idx, { param, pred: instantiateConstraint(constraint, param), constraint }]);
      }
    }
    return entries;
  };

  // nudo:interface-conflict 只在 check.ts fn 级报告（权威面）：conflict 必然
  // 蕴含源文件含 @nudo:refine/@nudo:interface，fn 级门恒开且必然已报——
  // 调用点级再报一次只会双报两种消息形态（此处历史上曾重复，已收口）。

  /** eq(var, lit) / eq(lit, var) 的标量字面量端；非该形态 → undefined */
  const predEqLiteral = (p: Pred): number | string | boolean | undefined => {
    if (p.op !== "eq") return undefined;
    const v =
      p.a.op === "var" && p.b.op === "lit"
        ? p.b.value
        : p.b.op === "var" && p.a.op === "lit"
          ? p.a.value
          : undefined;
    return typeof v === "number" || typeof v === "string" || typeof v === "boolean"
      ? v
      : undefined;
  };

  /**
   * 字面量可判定的原子谓词 → true/false；不可判定（非字面量端 / 非
   * number 值上的数值界）→ undefined。or 分支聚合用：任一 true 即过，
   * 全可判定且全 false 才报，含 undefined 不猜。
   */
  const judgeLiteralPred = (
    p: Pred,
    lv: number | string | boolean,
    strLen: number | undefined,
  ): boolean | undefined => {
    if (p.op === "eq") {
      const v = predEqLiteral(p);
      return v === undefined ? undefined : lv === v;
    }
    if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le") {
      return undefined;
    }
    if (p.b.op !== "lit" || typeof p.b.value !== "number") return undefined;
    const n = p.b.value;
    if (p.a.op === "app" && p.a.fn === "length") {
      if (strLen === undefined) return undefined;
      if (p.op === "gt") return strLen > n;
      if (p.op === "ge") return strLen >= n;
      if (p.op === "lt") return strLen < n;
      return strLen <= n;
    }
    if (typeof lv !== "number") return undefined;
    if (p.op === "gt") return lv > n;
    if (p.op === "ge") return lv >= n;
    if (p.op === "lt") return lv < n;
    return lv <= n;
  };

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
        // eq / or 域（lit()/union() 契约实例化出的 eq/or 原子）：此前两个
        // 消费分支都只认 typeof/gt/ge/lt/le，字面量/析取契约违例被静默
        // 跳过——写了等于没写。可判定才报（宁缺勿滥）。
        if (typeof lv === "number" || typeof lv === "string" || typeof lv === "boolean") {
          if (p.op === "eq") {
            const v = predEqLiteral(p);
            if (v !== undefined && lv !== v) {
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
            continue;
          }
          if (p.op === "or") {
            let pass = false;
            let unknown = false;
            for (const q of p.args) {
              const r = judgeLiteralPred(q, lv, strLen);
              if (r === true) {
                pass = true;
                break;
              }
              if (r === undefined) unknown = true;
            }
            if (!pass && !unknown) {
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
            continue;
          }
        }
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

    // eq / union 域（lit()/union() 字段契约）：bounds 分支判不了——域隶属
    // 判定（domain-membership 语义复用）；仅 eq/union 形态触发，防双报
    if (
      lv !== undefined &&
      (typeof lv === "number" || typeof lv === "string" || typeof lv === "boolean") &&
      ((constraint.members?.length ?? 0) > 0 ||
        constraint.preds.some((p) => p.op === "eq")) &&
      !literalMeetsConstraint(lv, constraint)
    ) {
      out.push({
        severity: "error",
        code: "nudo:constraint-violated",
        message: `${displayName}[${paramName}]: 实参 ⊭ 前置`,
        actual: formatAbs(fieldAbs),
        expected: `${fieldPath} ∈ ${formatConstraint(constraint)}`,
        suggestion: `改用满足 ${formatConstraint(constraint)} 的 ${fieldPath}`,
        fn: displayName,
        line: loc?.start.line,
        column: loc?.start.column,
      });
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
    const optsR: EffectiveInterfaceOpts = {
      loadModule: opts?.loadModule,
      fromFile: opts?.fromFile ?? "",
      ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
    };
    const ownEi = effectiveInterfaceOf(fnName, source, optsR);
    // §3.3 执法分档：仅 handwritten 执法；generated 段是事实快照（drift 另报）
    if (ownEi?.source === "handwritten") {
      const ownFull = interfaceToIndexed(ownEi, paramNames);
      checkShapeReqs(fnName, ownFull, paramNames, absArgs, (i) => i, loc);
      checkReqs(
        fnName,
        ownFull.map(([i, e]) => [i, e.pred] as [number, Pred]),
        paramNames,
        absArgs,
        (i) => i,
        loc,
      );
    }

    const fwd = forwards.get(fnName);
    if (fwd) {
      const tg = generalizeFromAst(fwd.target, source, file ? { file } : {});
      const tParams = tg?.params ?? [];
      const tEi = effectiveInterfaceOf(fwd.target, source, optsR);
      const tFull = tEi?.source === "handwritten" ? interfaceToIndexed(tEi, tParams) : [];
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
    ext: ExternalFnRef,
    args: Array<Record<string, unknown>>,
    displayName: string,
    loc?: { start: { line: number; column: number } },
  ): void => {
    checkArgStructures(ext.fnName, ext.source, args, loc, displayName, ext.fromFile);
    const { absArgs, hasInfo } = parseCallArgs(args);
    if (!hasInfo || absArgs.length === 0) return;
    let full: Array<[number, RefineEntry]> = [];
    let paramNames: string[] = [];
    try {
      const g = generalizeFromAst(ext.fnName, ext.source);
      paramNames = g?.params ?? [];
      // 跨文件侧车只在拿到定义文件路径时 ambient 绑定（防误绑到本文件侧车）
      const eiOpts: EffectiveInterfaceOpts = {
        loadModule: opts?.loadModule,
        fromFile: ext.fromFile ?? opts?.fromFile ?? "",
        ...(ext.fromFile ? {} : { autoBind: false }),
        ...(ext.fromFile && opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
      };
      const ei = effectiveInterfaceOf(ext.fnName, ext.source, eiOpts);
      // §3.3 执法分档：仅 handwritten 执法；generated 段不执法
      if (ei?.source === "handwritten") {
        full = interfaceToIndexed(ei, paramNames);
      }
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
    /** 跨文件时 ext 定义文件路径（interface 侧车解析基）；同文件忽略 */
    interfaceFromFile?: string,
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
    // refine 契约优先：有 handwritten 参数契约的形参不再用 body 方法访问推形状
    // （§3.3：generated 段是事实快照，不顶替结构推断）
    let refinedParams: Set<string> | undefined;
    try {
      const sameFile = fnSource === source;
      // 跨文件无定义路径时不 ambient 绑定侧车（防误绑到本文件侧车）
      const eiOpts: EffectiveInterfaceOpts = sameFile
        ? { loadModule: opts?.loadModule, fromFile: opts?.fromFile ?? "" }
        : {
            loadModule: opts?.loadModule,
            fromFile: interfaceFromFile ?? opts?.fromFile ?? "",
            ...(interfaceFromFile ? {} : { autoBind: false }),
          };
      const ei = effectiveInterfaceOf(fnName, fnSource, eiOpts);
      if (ei?.source === "handwritten" && ei.params.length > 0) {
        refinedParams = new Set(ei.params.map((p) => p.param));
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

// ---------------------------------------------------------------------------
// T10b：跨文件注入调用点域证据 ⊄ 手写契约（nudo:interface-domain-exceeds）
// ---------------------------------------------------------------------------

/**
 * 注入记录的最小结构面（service CallRecord 的成员子集——core 不反向依赖
 * service 的 CallRecord 声明，按结构兼容接收）。
 */
export type InjectedDomainRecord = {
  argTypes: TypeValue[];
  resultType: TypeValue;
  throws: TypeValue;
};

export type InjectedDomainEvidenceOpts = {
  /** 被调函数形参名（位置序）；契约按参数名对齐证据位 */
  paramNames: string[];
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  fromFile?: string;
  /** 侧车 ambient 绑定开关（host 配置下传；默认 true） */
  autoBind?: boolean;
  /** 报告定位：被调函数声明处。注入证据的 loc 在使用现场文件，不属于本文件 */
  loc?: { line: number; column: number };
};

/** 字面量证据展示：字符串带引号，number/boolean 原样 */
function evidenceToString(v: number | string | boolean): string {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

/**
 * 跨文件注入的调用点域证据 vs 手写契约（设计稿 §3.3/§6 对账矩阵第一行）。
 *
 * 来源分流铁律：写在被分析文件里的调用点违例（含 scanLiteralCalls 的
 * checkExternalCall 跨文件被调路径）维持 `nudo:constraint-violated` 原码
 * 原语义——本函数**只**消费经 externalCallRecords 注入的跨文件记录（analyzer
 * 消费区已做归属守卫），该路径此前不查契约，是纯增量。
 *
 * 证据门槛（§6）：
 * - 只有 plain literal 实参构成证据：union/unknown/primitive/refined 形态
 *   无法归因到确定值，不参与（widened/partial conf 经 absToTypeValue 投影
 *   为非 literal 形态，天然被此条排除；getTvConfidence 再兜一道底）；
 * - null 证据预过滤（T4 caveat：lit(null) 编码 prim undefined + eq(self,
 *   null)，对任何约束恒不满足，不过滤必 FP）；undefined/bigint/symbol
 *   不在字面量证据域内，一并跳过；
 * - resultType=never ∧ throws=never 是求值中断泄漏（analyzer 注入消费区
 *   同款过滤）。CallRecord 上没有截断字段（查证于 evaluator.ts CallRecord
 *   声明：fnName/argTypes/resultType/throws/callLoc/targetModule/
 *   targetExport/targetAliases/fnModule 十项，无截断标记）——递归截断走
 *   nudo:recursion-truncated 诊断通道且只 widen 结果，不产生新字面量证据；
 * - fn/shape/array 参数位 Phase 1 不执法（§3.3 HOF 豁免：
 *   literalMeetsConstraint 对这些形态恒 false，直接查必 FP）。
 *
 * 每函数每参数位最多一条 issue（多证据并列在 actual 里，去重）。
 */
export function checkInjectedDomainEvidence(
  fnName: string,
  source: string,
  records: InjectedDomainRecord[],
  opts: InjectedDomainEvidenceOpts,
): CheckIssue[] {
  const usable = records.filter(
    (r) => !(r.resultType?.kind === "never" && r.throws?.kind === "never"),
  );
  if (usable.length === 0) return [];

  let ei: EffectiveInterface | undefined;
  try {
    ei = effectiveInterface(source, fnName, {
      ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
      fromFile: opts.fromFile,
      ...(opts.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
    });
  } catch {
    return [];
  }
  // §3.3 执法分档：仅手写契约执法。generated 段是事实快照（过期由
  // nudo:interface-drift 覆盖）；implicit 无契约。
  if (!ei || ei.source !== "handwritten") return [];

  const out: CheckIssue[] = [];
  for (const { param, constraint } of ei.params) {
    if (constraint.fields || constraint.element || constraint.fn) continue;
    const idx = opts.paramNames.indexOf(param);
    // 形参名对不上（解构/rest/改名）：证据无法归位，跳过不猜
    if (idx < 0) continue;
    const failures: Array<number | string | boolean> = [];
    for (const rec of usable) {
      const arg = rec.argTypes[idx];
      if (!arg || arg.kind !== "literal") continue;
      const v = arg.value;
      if (
        typeof v !== "number" &&
        typeof v !== "string" &&
        typeof v !== "boolean"
      ) {
        continue;
      }
      const conf = getTvConfidence(arg);
      if (conf !== undefined && conf !== "exact" && conf !== "path") continue;
      if (!literalMeetsConstraint(v, constraint)) failures.push(v);
    }
    if (failures.length === 0) continue;
    const shown = [...new Set(failures)].map(evidenceToString).join("、");
    out.push({
      severity: "error",
      code: "nudo:interface-domain-exceeds",
      message: `${fnName}[${param}]: 跨文件调用域证据 ${shown} 超出手写契约（接口被用穿）`,
      actual: shown,
      expected: formatConstraint(constraint),
      suggestion: `放宽 ${fnName} 的手写契约（${param}: ${formatConstraint(constraint)}），或修正调用方传入的值`,
      fn: fnName,
      line: opts.loc?.line,
      column: opts.loc?.column,
    });
  }
  return out;
}
