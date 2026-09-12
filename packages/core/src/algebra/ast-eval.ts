/**
 * Babel AST 抽象求值：把「类型即计算」接到真实 JS 源码。
 * Phase A/B 边界：支持表达式、函数声明/箭头、return、if、const/let、块作用域。
 */

import { parseSource as parse } from "./parse-source.ts";
import type {
  Node,
  Expression,
  Statement,
  File,
  Identifier,
  BinaryExpression,
  NumericLiteral,
  StringLiteral,
  BooleanLiteral,
  ArrowFunctionExpression,
  FunctionDeclaration,
  CallExpression,
  VariableDeclaration,
  BlockStatement,
  ReturnStatement,
  IfStatement,
  ExpressionStatement,
  ForStatement,
  WhileStatement,
  DoWhileStatement,
  ForOfStatement,
  TryStatement,
} from "@babel/types";

import type { Term } from "./term.ts";
import { lit, v as termVar, app as termApp, simplifyTerm, termToString } from "./term.ts";
import type { Pred, Phi } from "./pred.ts";
import { and, gt, ge, lt, le, pTrue, predToString } from "./pred.ts";
import type { Abs } from "./abs.ts";
import {
  abs,
  confJoin,
  numLit,
  numVar,
  strLit,
  boolLit,
  unknown,
  litValue,
  isNumPrim,
  isStrPrim,
} from "./abs.ts";
import { add, sub, mul, div, mod, cmp, trueConstraint, falseConstraint } from "./arithmetic.ts";
import { typeofAbs, negAbs, notAbs, strictEqAbs } from "./surface.ts";
import { leakIfNeeded, defaultLeakBudget, type LeakBudget } from "./leak.ts";
import { spread, joinAbs } from "./objects.ts";
import { absFunction, attachFnImpl, getFnImpl } from "./abs-fn.ts";
import { concatString, isTemplateLike } from "./template.ts";
import {
  evalGlobalFn,
  evalNamespaceCall,
  evalBuiltinNew,
  evalBuiltinInstanceMethod,
} from "./builtins.ts";
import { callAbsMethod, getAbsProperty } from "./methods.ts";
import {
  defineClass,
  getClass,
  getClassChain,
  classFromMethods,
  instantiateClass,
  instanceOf,
  projectBrand,
  lookupMethod,
  lookupMethodWithOwner,
  lookupSuperMethod,
  superNameOf,
  awaitAbs,
  coerceAsyncReturn,
  wrapPromise,
  type MethodDef,
} from "./language.ts";

// --- 环境 ---

export type AstEnv = {
  vars: Map<string, Abs>;
  /** 用户函数：name → { params, body } */
  fns: Map<string, { params: string[]; body: Node; async?: boolean; kind?: string }>;
  /** class 表（旁路，withVar 必须保留） */
  classes?: Map<string, unknown>;
  /** 当前正在求值的方法所属类名（super.x() 从它的父类派发） */
  currentOwner?: string;
};

export function emptyEnv(): AstEnv {
  return { vars: new Map(), fns: new Map() };
}

export function withVar(env: AstEnv, name: string, value: Abs): AstEnv {
  const vars = new Map(env.vars);
  vars.set(name, value);
  return { vars, fns: env.fns, classes: env.classes };
}

export function withFns(
  env: AstEnv,
  name: string,
  fn: { params: string[]; body: Node; async?: boolean },
): AstEnv {
  const fns = new Map(env.fns);
  fns.set(name, fn);
  return { vars: env.vars, fns, classes: env.classes };
}

export type EvalOptions = {
  phi?: Phi;
  budget?: LeakBudget;
};

// --- 调用预算（与 TypeValue evaluator 对齐）---
// 抽象求值对递归做展开而非不动点：参数类型每层变形（fac(n-1)）时
// cycle key 不重复，必须靠深度/总调用数封顶。超限结果 conf=opaque。

export const MAX_CALL_DEPTH = 64;
export const MAX_TOTAL_CALLS = 200_000;

let _absCallDepth = 0;
let _absTotalCalls = 0;
let _activeCallKeys: string[] = [];
const _fnCallIds = new WeakMap<object, string>();
let _fnCallIdSeq = 0;

function stableCallId(obj: object): string {
  let id = _fnCallIds.get(obj);
  if (id === undefined) {
    id = `#${++_fnCallIdSeq}`;
    _fnCallIds.set(obj, id);
  }
  return id;
}

/** 宿主入口（evalProgramAbs / analyzeFn / check）前重置 */
export function resetAbsCallBudget(): void {
  _absCallDepth = 0;
  _absTotalCalls = 0;
  _activeCallKeys = [];
}

/** 截断结果：分析无信息，conf=opaque（不是 any） */
function truncatedAbs(): Abs {
  return abs({ k: "unknown" }, undefined, undefined, "opaque");
}

/** 调用指纹：命名函数用 name+arg shapes；一等函数用对象身份 */
function callBudgetKey(kind: string, id: string, args: Abs[]): string {
  const parts = args.map((a) => {
    const t = a.term ? termToString(a.term) : "";
    return `${a.shape.k}:${t}`;
  });
  return `${kind}|${id}|${parts.join(",")}`;
}

let absTruncCollector: ((fnLabel: string) => void) | null = null;

/** 记录被截断的递归（service 可映射为 nudo:recursion-truncated） */
export function setAbsTruncationCollector(
  collector: ((fnLabel: string) => void) | null,
): void {
  absTruncCollector = collector;
}

function noteTruncation(label: string): void {
  if (!absTruncCollector) return;
  try {
    absTruncCollector(label);
  } catch {
    // collector 不得打断求值
  }
}

/** 进入调用：超限/cycle 则不执行 body，返回 opaque */
function enterCall(key: string, label: string): boolean {
  if (
    _activeCallKeys.includes(key) ||
    _absCallDepth >= MAX_CALL_DEPTH ||
    _absTotalCalls >= MAX_TOTAL_CALLS
  ) {
    noteTruncation(label);
    return false;
  }
  _activeCallKeys.push(key);
  _absCallDepth++;
  _absTotalCalls++;
  return true;
}

function exitCall(): void {
  _absCallDepth--;
  _activeCallKeys.pop();
}

/** Abs 域调用记录（自包含程序可不经 TypeValue evaluator） */
export type AbsCallRecord = {
  fnName: string;
  args: Abs[];
  result: Abs;
  callLoc?: { line: number; column: number };
  threw?: boolean;
};

let absCallCollector: ((r: AbsCallRecord) => void) | null = null;

export function setAbsCallCollector(
  collector: ((r: AbsCallRecord) => void) | null,
): void {
  absCallCollector = collector;
}

function recordAbsCall(
  fnName: string,
  args: Abs[],
  result: Abs,
  callLoc?: { line: number; column: number },
  threw?: boolean,
): void {
  if (!absCallCollector) return;
  try {
    absCallCollector({ fnName, args, result, callLoc, threw });
  } catch {
    // collector 不得打断求值
  }
}

/** 节点 → Abs（LSP hover/inlay 的无损表，不经 TypeValue） */
let absNodeCollector: ((node: Node, value: Abs) => void) | null = null;

export function setAbsNodeCollector(
  collector: ((node: Node, value: Abs) => void) | null,
): void {
  absNodeCollector = collector;
}

function recordAbsNode(node: Node, value: Abs): void {
  if (!absNodeCollector || !value) return;
  try {
    absNodeCollector(node, value);
  } catch {
    // ignore
  }
}

/** 赋值记录：结构可赋值检查用 */
export type AbsAssignRecord = {
  name: string;
  prev?: Abs;
  next: Abs;
  line?: number;
  column?: number;
};

let absAssignCollector: ((r: AbsAssignRecord) => void) | null = null;

export function setAbsAssignCollector(
  collector: ((r: AbsAssignRecord) => void) | null,
): void {
  absAssignCollector = collector;
}

function recordAbsAssign(
  name: string,
  prev: Abs | undefined,
  next: Abs,
  loc?: { start: { line: number; column: number } },
): void {
  if (!absAssignCollector) return;
  try {
    absAssignCollector({
      name,
      prev,
      next,
      line: loc?.start.line,
      column: loc?.start.column,
    });
  } catch {
    // ignore
  }
}

export type EvalResult = {
  value: Abs;
  phi: Phi;
  env: AstEnv;
  /** 函数已通过 return 跳出，块内后续语句不可达 */
  returned?: boolean;
  /** break 跳出最近循环 */
  brk?: boolean;
  /** continue 进入下一轮 */
  cont?: boolean;
  /** throw 了 value（未捕获时向上传播） */
  threw?: boolean;
};

// --- 源码入口 ---

export function parseSource(source: string): File {
  return parse(source);
}

/**
 * 分析一段 JS 源码。
 * 若含多个顶层函数声明，先注册全部，再对 `main` 或最后一个有调用的函数求值。
 * 更简单：提供 `analyzeFunction(source, fnName, args)`。
 */
export function evalSource(
  source: string,
  entry: { fn: string; args: Abs[] },
  opts: EvalOptions = {},
): EvalResult {
  resetAbsCallBudget();
  const file = parseSource(source);
  const env = emptyEnv();
  let phi = opts.phi ?? pTrue;

  // 第一遍：注册函数与 class（class 必须在调用前登记 methods）
  for (const stmt of file.program.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id) {
      registerFunction(env, stmt);
    }
    if (stmt.type === "ClassDeclaration") {
      registerClassDecl(env, stmt);
    }
    if (stmt.type === "VariableDeclaration") {
      // const add = (a,b) => a+b
      for (const d of stmt.declarations) {
        if (
          d.id.type === "Identifier" &&
          (d.init?.type === "ArrowFunctionExpression" ||
            d.init?.type === "FunctionExpression")
        ) {
          const init = d.init as ArrowFunctionExpression;
          env.fns.set(d.id.name, {
            params: init.params.map(paramName),
            body: init.body,
            async: init.async === true,
          });
        }
      }
    }
  }

  const value = callFunction(env, entry.fn, entry.args, phi, opts.budget);
  return { value, phi, env };
}

/** 注册 ClassDeclaration 到 env.classes 与 env.vars */
function registerClassDecl(env: AstEnv, node: Node): void {
  const cls = node as {
    id?: { name: string };
    superClass?: Node;
    body: {
      body: Array<{
        type: string;
        key?: Node;
        params?: Node[];
        body?: Node;
        kind?: string;
        async?: boolean;
      }>;
    };
  };
  const name = cls.id?.name ?? "AnonymousClass";
  const methods: MethodDef[] = cls.body.body
    .filter((m) => m.type === "ClassMethod" || m.type === "ObjectMethod")
    .map((m) => ({
      name:
        m.key?.type === "Identifier"
          ? (m.key as Identifier).name
          : m.key?.type === "StringLiteral"
            ? (m.key as StringLiteral).value
            : "method",
      params: (m.params ?? []).map(paramName),
      body: m.body as Node,
      kind: m.kind,
      async: m.async === true,
    }));
  let superName: string | undefined;
  let superShape: Abs | undefined;
  if (cls.superClass?.type === "Identifier") {
    superName = (cls.superClass as Identifier).name;
    const sd = getClass(env, superName);
    if (sd) superShape = sd.instanceShape;
  }
  const def = classFromMethods(name, methods, superName, superShape);
  defineClass(env, def);
  const classVal = abs(
    { k: "brand", name, shape: def.instanceShape },
    undefined,
    undefined,
    "exact",
  );
  env.vars.set(name, classVal);
}

function paramName(p: Node): string {
  if (p.type === "Identifier") return p.name;
  return "_";
}

function registerFunction(env: AstEnv, decl: FunctionDeclaration): void {
  if (!decl.id) return;
  env.fns.set(decl.id.name, {
    params: decl.params.map(paramName),
    body: decl.body,
    async: decl.async === true,
  });
}

export function callFunction(
  env: AstEnv,
  name: string,
  args: Abs[],
  phi: Phi = pTrue,
  budget: LeakBudget = defaultLeakBudget,
): Abs {
  const fn = env.fns.get(name);
  if (!fn) return unknown;

  const key = callBudgetKey("fn", name, args);
  if (!enterCall(key, name)) return truncatedAbs();
  try {
    // 继承程序级 vars（含 @nudo:mock seed）；与 applyAbsFn 一致拷贝，避免写穿外层
    let local: AstEnv = { vars: new Map(env.vars), fns: env.fns };
    // classes 随 env 传递
    const cls = (env as AstEnv & { classes?: Map<string, unknown> }).classes;
    if (cls) (local as AstEnv & { classes?: Map<string, unknown> }).classes = cls;

    fn.params.forEach((p, i) => {
      local.vars.set(p, args[i] ?? unknown);
    });

    const result = evalNode(fn.body, local, phi, budget);
    if (result.threw) {
      return abs({ k: "never" }, undefined, undefined, "exact");
    }
    if (fn.async) return coerceAsyncReturn(result.value);
    return result.value;
  } finally {
    exitCall();
  }
}

/**
 * 在 this=receiver 下求值方法体。
 * constructor 无显式 return 时返回更新后的 this（字段写入已并入 env）。
 */
export function evalMethodBody(
  method: { params: string[]; body: Node; async?: boolean; kind?: string },
  args: Abs[],
  thisVal: Abs,
  env: AstEnv,
  phi: Phi = pTrue,
  budget: LeakBudget = defaultLeakBudget,
  /** 方法定义所在类名（用于 super 派发） */
  ownerClass?: string,
): Abs {
  const methodId = `${ownerClass ?? ""}.${method.kind ?? "method"}:${stableCallId(method.body as unknown as object)}`;
  const key = callBudgetKey("method", methodId, [thisVal, ...args]);
  if (!enterCall(key, ownerClass ?? "method")) return truncatedAbs();
  try {
    const local = emptyEnv();
    local.fns = env.fns;
    const cls = (env as AstEnv & { classes?: Map<string, unknown> }).classes;
    if (cls) (local as AstEnv & { classes?: Map<string, unknown> }).classes = cls;
    // super.x() 从当前方法所属类的父类派发
    if (ownerClass) local.currentOwner = ownerClass;
    local.vars.set("this", thisVal);
    method.params.forEach((p, i) => {
      local.vars.set(p, args[i] ?? unknown);
    });

    const result = evalNode(method.body, local, phi, budget);
    let value = result.value;

    // 从求值后的 env 取 this（AssignmentExpression 用 withVar 换 env）
    const thisAfter = result.env.vars.get("this") ?? local.vars.get("this");
    if (method.kind === "constructor") {
      if (thisAfter) value = thisAfter;
    } else if (thisAfter && thisAfter !== thisVal && value.shape.k === "unknown") {
      value = thisAfter;
    }
    if (method.async) return coerceAsyncReturn(value);
    return value;
  } finally {
    exitCall();
  }
}

// --- 节点求值 ---

/** 对外入口：求值并记入节点表（Map<Node, Abs> 由 collector 消费） */
export function evalNode(
  node: Node,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  const r = evalNodeInner(node, env, phi, budget);
  recordAbsNode(node, r.value);
  return r;
}

function evalNodeInner(
  node: Node,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  switch (node.type) {
    case "NumericLiteral":
      return ok(numLit((node as NumericLiteral).value), phi, env);
    case "StringLiteral":
      return ok(strLit((node as StringLiteral).value), phi, env);
    case "BooleanLiteral":
      return ok(boolLit((node as BooleanLiteral).value), phi, env);
    case "NullLiteral":
      return ok(abs({ k: "unknown" }, lit(null), pTrue, "exact"), phi, env);
    case "Identifier": {
      const id = node as Identifier;
      if (id.name === "undefined") {
        return ok(abs({ k: "unknown" }, lit(undefined), pTrue, "exact"), phi, env);
      }
      return ok(env.vars.get(id.name) ?? unknown, phi, env);
    }
    case "BinaryExpression":
      return evalBinary(node as BinaryExpression, env, phi, budget);
    case "CallExpression":
      return evalCall(node as CallExpression, env, phi, budget);
    case "ArrowFunctionExpression":
    case "FunctionExpression": {
      const fn = node as ArrowFunctionExpression;
      const params = fn.params.map(paramName);
      const impl = {
        params,
        body: fn.body,
        async: fn.async === true,
        env,
      };
      return ok(absFunction(params, impl), phi, env);
    }
    case "ClassDeclaration": {
      registerClassDecl(env, node);
      const name = (node as { id?: { name: string } }).id?.name;
      if (name) {
        return { value: env.vars.get(name) ?? unknown, phi, env };
      }
      return ok(unknown, phi, env);
    }
    case "NewExpression": {
      const ne = node as { callee: Node; arguments: Node[] };
      if (ne.callee.type !== "Identifier") return ok(unknown, phi, env);
      const className = (ne.callee as Identifier).name;
      const args = ne.arguments.map((a) => evalNode(a, env, phi, budget).value);
      // 内置构造
      const builtin = evalBuiltinNew(className, args);
      if (builtin) return ok(builtin, phi, env);
      const inst = instantiateClass(env, className, args, (ctor, cargs, thisVal, e) =>
        evalMethodBody(ctor, cargs, thisVal, e, phi, budget),
      );
      return ok(inst, phi, env);
    }
    case "AssignmentExpression": {
      const ae = node as {
        operator: string;
        left: Node;
        right: Node;
      };
      if (ae.operator !== "=") return ok(unknown, phi, env);
      const rhs = evalNode(ae.right, env, phi, budget).value;
      // this.field = v → 更新 env 中的 this
      if (
        ae.left.type === "MemberExpression" &&
        (ae.left as { object: Node }).object.type === "ThisExpression"
      ) {
        const prop = (ae.left as { property: Node; computed?: boolean }).property;
        const key =
          !ae.left.computed && prop.type === "Identifier"
            ? (prop as Identifier).name
            : prop.type === "StringLiteral"
              ? (prop as StringLiteral).value
              : undefined;
        if (key) {
          const thisVal = env.vars.get("this");
          if (thisVal && thisVal.shape.k === "brand") {
            const slots: Record<string, { value: Abs }> = {};
            const inner = thisVal.shape.shape;
            if (inner.shape.k === "obj") {
              Object.assign(slots, inner.shape.slots);
            }
            slots[key] = { value: rhs };
            const updated = abs(
              {
                k: "brand",
                name: thisVal.shape.name,
                shape: abs({ k: "obj", slots }, undefined, undefined, "exact"),
              },
              undefined,
              undefined,
              thisVal.conf,
            );
            return { value: rhs, phi, env: withVar(env, "this", updated) };
          }
        }
      }
      // 普通标识符赋值
      if (ae.left.type === "Identifier") {
        const name = (ae.left as Identifier).name;
        const prev = env.vars.get(name);
        const loc = (node as { loc?: { start: { line: number; column: number } } }).loc;
        recordAbsAssign(name, prev, rhs, loc);
        return { value: rhs, phi, env: withVar(env, name, rhs) };
      }
      return ok(rhs, phi, env);
    }
    case "AwaitExpression": {
      const ae = node as { argument: Node };
      const inner = evalNode(ae.argument, env, phi, budget).value;
      return ok(awaitAbs(inner), phi, env);
    }
    case "ThisExpression":
      return ok(env.vars.get("this") ?? unknown, phi, env);
    case "BlockStatement":
      return evalBlock(node as BlockStatement, env, phi, budget);
    case "BreakStatement":
      return { value: unknown, phi, env, brk: true };
    case "ContinueStatement":
      return { value: unknown, phi, env, cont: true };
    case "ThrowStatement": {
      const arg = (node as { argument?: Node }).argument;
      const v = arg ? evalNode(arg, env, phi, budget).value : unknown;
      return { value: v, phi, env, threw: true };
    }
    case "ForStatement":
      return evalFor(node as ForStatement, env, phi, budget);
    case "WhileStatement":
      return evalWhile(node as WhileStatement, env, phi, budget);
    case "DoWhileStatement":
      return evalDoWhile(node as DoWhileStatement, env, phi, budget);
    case "ForOfStatement":
      return evalForOf(node as ForOfStatement, env, phi, budget);
    case "TryStatement":
      return evalTry(node as TryStatement, env, phi, budget);
    case "UpdateExpression": {
      const ue = node as { operator: string; argument: Node; prefix?: boolean };
      if (ue.argument.type !== "Identifier") return ok(unknown, phi, env);
      const name = (ue.argument as Identifier).name;
      const cur = env.vars.get(name) ?? unknown;
      const lv = litValue(cur);
      const delta = ue.operator === "++" ? 1 : -1;
      const next =
        typeof lv === "number" ? numLit(lv + delta) : abs({ k: "prim", type: "number" }, undefined, undefined, "path");
      const env2 = withVar(env, name, next);
      return { value: ue.prefix ? next : cur, phi, env: env2 };
    }
    case "ReturnStatement": {
      const arg = (node as ReturnStatement).argument;
      if (!arg) return { value: unknown, phi, env, returned: true };
      const r = evalNode(arg, env, phi, budget);
      return { ...r, returned: true };
    }
    case "IfStatement":
      return evalIf(node as IfStatement, env, phi, budget);
    case "ExpressionStatement":
      return evalNode((node as ExpressionStatement).expression, env, phi, budget);
    case "VariableDeclaration":
      return evalVarDecl(node as VariableDeclaration, env, phi, budget);
    case "UnaryExpression": {
      const u = node as { operator: string; argument: Node };
      const a = evalNode(u.argument, env, phi, budget).value;
      if (u.operator === "-") return ok(negAbs(a, phi), phi, env);
      if (u.operator === "!") return ok(notAbs(a), phi, env);
      if (u.operator === "typeof") return ok(typeofAbs(a), phi, env);
      if (u.operator === "+") {
        const lv = litValue(a);
        if (typeof lv === "number") return ok(numLit(lv), phi, env);
        return ok(unknown, phi, env);
      }
      return ok(unknown, phi, env);
    }
    case "LogicalExpression": {
      const le = node as { operator: string; left: Node; right: Node };
      const l = evalNode(le.left, env, phi, budget);
      const lv = litValue(l.value);
      const falsy = lv === false || lv === null || lv === undefined;
      const truthy = lv !== undefined && !falsy;
      if (le.operator === "&&") {
        if (falsy) return ok(l.value, phi, env);
        if (truthy) return evalNode(le.right, env, phi, budget);
        const r = evalNode(le.right, env, phi, budget);
        return ok(joinAbs(l.value, r.value), phi, env);
      }
      if (le.operator === "||") {
        if (truthy) return ok(l.value, phi, env);
        if (falsy) return evalNode(le.right, env, phi, budget);
        const r = evalNode(le.right, env, phi, budget);
        return ok(joinAbs(l.value, r.value), phi, env);
      }
      return ok(unknown, phi, env);
    }
    case "TemplateLiteral": {
      const tl = node as {
        quasis: Array<{ value: { cooked?: string | null; raw: string } }>;
        expressions: Node[];
      };
      const parts: Abs[] = [];
      for (let i = 0; i < tl.quasis.length; i++) {
        const cooked = tl.quasis[i]!.value.cooked ?? tl.quasis[i]!.value.raw;
        if (cooked) parts.push(strLit(cooked));
        if (i < tl.expressions.length) {
          parts.push(evalNode(tl.expressions[i]!, env, phi, budget).value);
        }
      }
      if (parts.length === 0) return ok(strLit(""), phi, env);
      let acc = parts[0]!;
      for (let i = 1; i < parts.length; i++) {
        acc = concatString(acc, parts[i]!);
      }
      return ok(acc, phi, env);
    }
    case "MemberExpression": {
      const m = node as { object: Node; property: Node; computed?: boolean };
      const obj = evalNode(m.object, env, phi, budget).value;
      // brand 字段/方法投影
      if (obj.shape.k === "brand" && !m.computed && m.property.type === "Identifier") {
        const key = (m.property as Identifier).name;
        const projected = projectBrand(obj, key);
        if (projected.shape.k !== "unknown") {
          return ok(projected, phi, env);
        }
      }
      // obj.length
      if (
        !m.computed &&
        m.property.type === "Identifier" &&
        (m.property as Identifier).name === "length"
      ) {
        const viaProp = getAbsProperty(obj, "length");
        if (viaProp) return ok(viaProp, phi, env);
        if (obj.shape.k === "tuple") {
          return ok(numLit(obj.shape.elements.length), phi, env);
        }
        if (obj.shape.k === "arr") {
          return ok(abs({ k: "prim", type: "number" }, undefined, undefined, "path"), phi, env);
        }
        if (isStrPrim(obj)) {
          const lv = litValue(obj);
          if (typeof lv === "string") return ok(numLit(lv.length), phi, env);
          return ok(abs({ k: "prim", type: "number" }, undefined, undefined, "partial"), phi, env);
        }
      }
      // 静态属性访问
      if (!m.computed && m.property.type === "Identifier" && obj.shape.k === "obj") {
        const key = (m.property as Identifier).name;
        const slot = (obj.shape as { slots: Record<string, { value: Abs }> }).slots[key];
        if (slot) return ok(slot.value, phi, env);
      }
      // 计算属性 obj[key]
      if (m.computed) {
        const key = evalNode(m.property, env, phi, budget).value;
        const kl = litValue(key);
        if (typeof kl === "string" && obj.shape.k === "obj") {
          const slot = (obj.shape as { slots: Record<string, { value: Abs }> }).slots[kl];
          if (slot) return ok(slot.value, phi, env);
        }
      }
      return ok(unknown, phi, env);
    }
    case "ObjectExpression": {
      const o = node as {
        properties: Array<
          | { type: "ObjectProperty"; key?: Node; value?: Node }
          | { type: "SpreadElement"; argument: Node }
        >;
      };
      // 先收集字面量属性，再按书写顺序应用 spread
      let acc: Abs = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
      let pending: Record<string, { value: Abs }> = {};

      const flushPending = (base: Abs): Abs => {
        if (Object.keys(pending).length === 0) return base;
        const slots =
          base.shape.k === "obj"
            ? { ...(base.shape as { slots: Record<string, { value: Abs }> }).slots }
            : {};
        for (const [k, s] of Object.entries(pending)) slots[k] = s;
        pending = {};
        return abs({ k: "obj", slots }, undefined, undefined, "exact");
      };

      for (const p of o.properties) {
        if (p.type === "SpreadElement") {
          acc = flushPending(acc);
          const sp = evalNode(p.argument, env, phi, budget).value;
          acc = spread(acc, sp);
          continue;
        }
        const keyNode = p.key;
        let key: string | undefined;
        if (keyNode && keyNode.type === "Identifier") key = (keyNode as Identifier).name;
        if (keyNode && keyNode.type === "StringLiteral") key = (keyNode as StringLiteral).value;
        if (!key || !p.value) continue;
        pending[key] = { value: evalNode(p.value, env, phi, budget).value };
      }
      acc = flushPending(acc);
      return ok(acc, phi, env);
    }
    case "ArrayExpression": {
      const a = node as { elements: Array<Node | null> };
      const els = a.elements
        .filter((e): e is Node => e != null && e.type !== "SpreadElement")
        .map((e) => evalNode(e, env, phi, budget).value);
      if (els.length === 0) {
        return ok(abs({ k: "arr", element: unknown }, undefined, undefined, "exact"), phi, env);
      }
      // 小数组字面量 → tuple（保逐元素精确，map/reduce 可展开）
      if (els.length <= 8) {
        return ok(abs({ k: "tuple", elements: els }, undefined, undefined, "exact"), phi, env);
      }
      const elem = els.reduce((x, y) => joinAbs(x, y));
      return ok(abs({ k: "arr", element: elem }, undefined, undefined, "path"), phi, env);
    }
    default:
      return ok(unknown, phi, env);
  }
}

function ok(value: Abs, phi: Phi, env: AstEnv): EvalResult {
  return { value, phi, env };
}

function evalBinary(
  node: BinaryExpression,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  const l = evalNode(node.left, env, phi, budget).value;
  const r = evalNode(node.right, env, phi, budget).value;
  const op = node.operator;

  switch (op) {
    case "+":
      return ok(leakIfNeeded(add(l, r, phi), budget, "add"), phi, env);
    case "-":
      return ok(leakIfNeeded(sub(l, r, phi), budget, "sub"), phi, env);
    case "*":
      return ok(leakIfNeeded(mul(l, r, phi), budget, "mul"), phi, env);
    case "<":
      return ok(cmp("lt", l, r, phi), phi, env);
    case "<=":
      return ok(cmp("le", l, r, phi), phi, env);
    case ">":
      return ok(cmp("gt", l, r, phi), phi, env);
    case ">=":
      return ok(cmp("ge", l, r, phi), phi, env);
    case "===": {
      const eq = strictEqAbs(l, r);
      if (eq !== undefined) return ok(boolLit(eq), phi, env);
      return ok(cmp("eq", l, r, phi), phi, env);
    }
    case "!==": {
      const eq = strictEqAbs(l, r);
      if (eq !== undefined) return ok(boolLit(!eq), phi, env);
      return ok(cmp("ne", l, r, phi), phi, env);
    }
    case "/":
      return ok(leakIfNeeded(div(l, r, phi), budget, "div"), phi, env);
    case "%":
      return ok(leakIfNeeded(mod(l, r, phi), budget, "mod"), phi, env);
    case "instanceof": {
      if (node.right.type !== "Identifier") return ok(unknown, phi, env);
      const className = (node.right as Identifier).name;
      return ok(instanceOf(l, className, env), phi, env);
    }
    default:
      return ok(unknown, phi, env);
  }
}

function evalCall(
  node: CallExpression,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  const callee = node.callee;

  // 方法调用：arr.map(fn) / Math.floor / Object.keys …
  if (callee.type === "MemberExpression") {
    const m = callee as { object: Node; property: Node; computed?: boolean };
    if (!m.computed && m.property.type === "Identifier") {
      const method = (m.property as Identifier).name;

      // super.method() → 从当前方法所属类的父类派发
      if (m.object.type === "Super") {
        const thisVal = env.vars.get("this");
        const sArgs = node.arguments.filter(
          (a): a is Exclude<typeof a, { type: "SpreadElement" }> => a.type !== "SpreadElement",
        );
        if (thisVal && thisVal.shape.k === "brand") {
          const fromClass = env.currentOwner ?? thisVal.shape.name;
          const found = lookupSuperMethod(env, thisVal, fromClass, method);
          if (found && found.def.kind !== "constructor") {
            const margs = sArgs.map((a) => evalNode(a, env, phi, budget).value);
            const ret = evalMethodBody(
              found.def,
              margs,
              thisVal,
              env,
              phi,
              budget,
              found.owner,
            );
            if (found.def.async) return ok(coerceAsyncReturn(ret), phi, env);
            return ok(ret, phi, env);
          }
        }
        return ok(unknown, phi, env);
      }

      const obj = evalNode(m.object, env, phi, budget).value;
      const rawArgs = node.arguments.filter(
        (a): a is Exclude<typeof a, { type: "SpreadElement" }> => a.type !== "SpreadElement",
      );

      // 全局命名空间 builtin（Math/Object/JSON/Number/Array/Date/Promise）
      if (m.object.type === "Identifier") {
        const ns = (m.object as Identifier).name;
        const margs = rawArgs.map((a) => evalNode(a, env, phi, budget).value);
        const r = evalNamespaceCall(ns, method, margs);
        if (r) return ok(r, phi, env);
      }

      // Abs 方法表（template startsWith 等）
      {
        const margs = rawArgs.map((a) => evalNode(a, env, phi, budget).value);
        const viaTable = callAbsMethod(obj, method, margs);
        if (viaTable) return ok(viaTable, phi, env);
      }

      if (obj.shape.k === "brand") {
        // 内置 brand 实例方法（Date/RegExp/Map/Set）
        {
          const margs = rawArgs.map((a) => evalNode(a, env, phi, budget).value);
          const bi = evalBuiltinInstanceMethod(obj.shape.name, method, obj, margs);
          if (bi) return ok(bi, phi, env);
        }
        // brand 方法：在 this=receiver 下求值方法体（含继承链）
        const foundM = lookupMethodWithOwner(env, obj, method);
        if (foundM && foundM.def.kind !== "constructor") {
          const margs = rawArgs.map((a) => evalNode(a, env, phi, budget).value);
          const ret = evalMethodBody(
            foundM.def,
            margs,
            obj,
            env,
            phi,
            budget,
            foundM.owner,
          );
          if (foundM.def.async) return ok(coerceAsyncReturn(ret), phi, env);
          return ok(ret, phi, env);
        }
      }

      // Promise：then/catch/finally → promise
      if (obj.shape.k === "eff" && obj.shape.eff === "promise") {
        if (method === "then" || method === "catch" || method === "finally") {
          const fnNode = rawArgs[0];
          if (fnNode && method === "then") {
            const inner = applyUnaryCallback(fnNode, obj.shape.inner, env, phi, budget);
            return ok(
              abs({ k: "eff", eff: "promise", inner }, undefined, undefined, confJoin(obj.conf, inner.conf)),
              phi,
              env,
            );
          }
          return ok(obj, phi, env);
        }
      }

      // 字符串方法（字面量可折叠）
      if (isStrPrim(obj) || obj.term?.op === "lit") {
        const sv = litValue(obj);
        const arg0 = rawArgs[0] ? evalNode(rawArgs[0], env, phi, budget).value : undefined;
        const a0 = arg0 ? litValue(arg0) : undefined;
        if (typeof sv === "string") {
          switch (method) {
            case "startsWith":
              if (typeof a0 === "string") return ok(boolLit(sv.startsWith(a0)), phi, env);
              break;
            case "endsWith":
              if (typeof a0 === "string") return ok(boolLit(sv.endsWith(a0)), phi, env);
              break;
            case "includes":
              if (typeof a0 === "string") return ok(boolLit(sv.includes(a0)), phi, env);
              break;
            case "charAt":
              if (typeof a0 === "number") return ok(strLit(sv.charAt(a0)), phi, env);
              break;
            case "slice": {
              const a1 = rawArgs[1] ? litValue(evalNode(rawArgs[1], env, phi, budget).value) : undefined;
              return ok(strLit(sv.slice(a0 as number | undefined, a1 as number | undefined)), phi, env);
            }
            case "toUpperCase":
              return ok(strLit(sv.toUpperCase()), phi, env);
            case "toLowerCase":
              return ok(strLit(sv.toLowerCase()), phi, env);
            case "trim":
              return ok(strLit(sv.trim()), phi, env);
            case "toString":
            case "valueOf":
              return ok(strLit(sv), phi, env);
            case "concat": {
              const rest = rawArgs.map((a) => litValue(evalNode(a, env, phi, budget).value));
              return ok(strLit(sv + rest.map((x) => String(x)).join("")), phi, env);
            }
          }
        }
        // 抽象 string 上的谓词方法 → boolean
        if (
          method === "startsWith" || method === "endsWith" || method === "includes"
        ) {
          return ok(abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial"), phi, env);
        }
        if (method === "toUpperCase" || method === "toLowerCase" || method === "trim" || method === "slice") {
          return ok(abs({ k: "prim", type: "string" }, undefined, undefined, "path"), phi, env);
        }
        if (method === "charAt") {
          return ok(abs({ k: "prim", type: "string" }, undefined, undefined, "path"), phi, env);
        }
      }

      // 数组 join / at / includes
      if (obj.shape.k === "arr" || obj.shape.k === "tuple") {
        if (method === "join") {
          return ok(abs({ k: "prim", type: "string" }, undefined, undefined, "path"), phi, env);
        }
        if (method === "includes") {
          return ok(abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial"), phi, env);
        }
        if (method === "at" || method === "pop" || method === "shift") {
          if (obj.shape.k === "tuple" && obj.shape.elements.length > 0) {
            const idx =
              method === "at"
                ? Number(litValue(evalNode(rawArgs[0] ?? { type: "NumericLiteral", value: 0 } as Node, env, phi, budget).value) ?? 0)
                : 0;
            const els = obj.shape.elements;
            const pick = method === "pop" || method === "shift" ? els[0] : els[Math.max(0, Math.min(els.length - 1, idx))];
            return ok(pick ?? unknown, phi, env);
          }
          if (obj.shape.k === "arr") {
            return ok((obj.shape as { element: Abs }).element, phi, env);
          }
        }
      }

      if (method === "map" && rawArgs.length >= 1) {
        const fnNode = rawArgs[0]!;
        // tuple：逐元素 map，保精确
        if (obj.shape.k === "tuple") {
          const mapped = obj.shape.elements.map((el) =>
            applyUnaryCallback(fnNode, el, env, phi, budget),
          );
          return ok(
            abs({ k: "tuple", elements: mapped }, undefined, undefined, confJoin(obj.conf, "path")),
            phi,
            env,
          );
        }
        const elem =
          obj.shape.k === "arr"
            ? (obj.shape as { element: Abs }).element
            : unknown;
        const out = applyUnaryCallback(fnNode, elem, env, phi, budget);
        return ok(
          abs({ k: "arr", element: out }, undefined, undefined, confJoin(obj.conf, out.conf)),
          phi,
          env,
        );
      }

      if (method === "reduce" && rawArgs.length >= 2) {
        const fnNode = rawArgs[0]!;
        let acc = evalNode(rawArgs[1]!, env, phi, budget).value;
        if (obj.shape.k === "tuple") {
          for (const el of obj.shape.elements) {
            acc = applyBinaryCallback(fnNode, acc, el, env, phi, budget);
          }
          return ok(acc, phi, env);
        }
        const item =
          obj.shape.k === "arr"
            ? (obj.shape as { element: Abs }).element
            : unknown;
        // 不动点
        for (let i = 0; i < 6; i++) {
          const next = applyBinaryCallback(fnNode, acc, item, env, phi, budget);
          if (absIdentical(acc, next)) {
            return ok(next, phi, env);
          }
          acc = joinAbs(acc, next);
        }
        return ok(acc, phi, env);
      }

      if (method === "filter" && rawArgs.length >= 1) {
        const fnNode = rawArgs[0]!;
        if (obj.shape.k === "tuple") {
          const kept: Abs[] = [];
          for (const el of obj.shape.elements) {
            const p = applyUnaryCallback(fnNode, el, env, phi, budget);
            const lv = litValue(p);
            if (lv === false) continue;
            kept.push(el);
          }
          if (kept.length === 0) {
            return ok(abs({ k: "arr", element: unknown }, undefined, undefined, "path"), phi, env);
          }
          if (kept.length === 1) return ok(kept[0]!, phi, env);
          // 多元素：tuple（保精确）或 join 成 arr
          return ok(
            abs({ k: "tuple", elements: kept }, undefined, undefined, confJoin(obj.conf, "path")),
            phi,
            env,
          );
        }
        // arr：filter 保持元素类型
        return ok(obj, phi, env);
      }
    }
    return ok(unknown, phi, env);
  }

  if (callee.type !== "Identifier") {
    const args = node.arguments.map((a) =>
      a.type === "SpreadElement" ? unknown : evalNode(a as Node, env, phi, budget).value,
    );
    const calleeVal = evalNode(callee, env, phi, budget).value;
    return ok(applyAbsFn(calleeVal, args, env, phi, budget), phi, env);
  }

  const name = (callee as Identifier).name;
  const args = node.arguments.map((a) =>
    a.type === "SpreadElement" ? unknown : evalNode(a as Node, env, phi, budget).value,
  );

  // 全局函数 builtin
  const g = evalGlobalFn(name, args);
  if (g) return ok(g, phi, env);

  // 变量上的 Abs 一等函数
  const bound = env.vars.get(name);
  if (bound && getFnImpl(bound)) {
    const v = applyAbsFn(bound, args, env, phi, budget);
    const loc0 = node.loc;
    recordAbsCall(name, args, v, loc0 ? { line: loc0.start.line, column: loc0.start.column } : undefined);
    return ok(v, phi, env);
  }

  const value = callFunction(env, name, args, phi, budget);
  if (env.fns.has(name)) {
    const loc = node.loc;
    recordAbsCall(
      name,
      args,
      value,
      loc ? { line: loc.start.line, column: loc.start.column } : undefined,
    );
  }
  return ok(value, phi, env);
}

/** 应用 Abs 一等函数（有 impl 时） */
function applyAbsFn(
  fnVal: Abs,
  args: Abs[],
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): Abs {
  const impl = getFnImpl(fnVal);
  if (!impl) return unknown;
  // WeakMap 旁路：impl.body 对象作稳定身份
  const implId = stableCallId(impl.body as unknown as object);
  const key = callBudgetKey("absfn", implId, args);
  const label = (fnVal.shape as { name?: string }).name ?? "anonymous";
  if (!enterCall(key, label)) return truncatedAbs();
  try {
    // mock withArgs 等：有 apply 钩子时按实参派发，不经 body
    if (impl.apply) return impl.apply(args);
    const base = impl.env ?? env;
    let local: AstEnv = { vars: new Map(base.vars), fns: base.fns };
    if ((base as { classes?: unknown }).classes) {
      (local as { classes?: unknown }).classes = (base as { classes?: unknown }).classes;
    }
    impl.params.forEach((p, i) => {
      local.vars.set(p, args[i] ?? unknown);
    });
    const result = evalNode(impl.body, local, phi, budget);
    if (impl.async) return coerceAsyncReturn(result.value);
    return result.value;
  } finally {
    exitCall();
  }
}

/** 把 (x) => body 或命名函数用给定实参求值一次 */
function applyUnaryCallback(
  fnNode: Node,
  arg: Abs,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): Abs {
  if (fnNode.type === "Identifier") {
    const name = (fnNode as Identifier).name;
    const bound = env.vars.get(name);
    if (bound && getFnImpl(bound)) {
      return applyAbsFn(bound, [arg], env, phi, budget);
    }
    if (env.fns.has(name)) {
      return callFunction(env, name, [arg], phi, budget);
    }
    return unknown;
  }
  const { params, body } = extractCallback(fnNode);
  if (!params || !body) return unknown;
  let local: AstEnv = { vars: new Map(env.vars), fns: env.fns };
  local.vars.set(params[0]!, arg);
  return evalNode(body, local, phi, budget).value;
}

function applyBinaryCallback(
  fnNode: Node,
  a: Abs,
  b: Abs,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): Abs {
  if (fnNode.type === "Identifier") {
    const name = (fnNode as Identifier).name;
    const bound = env.vars.get(name);
    if (bound && getFnImpl(bound)) {
      return applyAbsFn(bound, [a, b], env, phi, budget);
    }
    if (env.fns.has(name)) {
      return callFunction(env, name, [a, b], phi, budget);
    }
    return unknown;
  }
  const { params, body } = extractCallback(fnNode);
  if (!params || params.length < 2 || !body) return unknown;
  let local: AstEnv = { vars: new Map(env.vars), fns: env.fns };
  local.vars.set(params[0]!, a);
  local.vars.set(params[1]!, b);
  return evalNode(body, local, phi, budget).value;
}

function extractCallback(node: Node): { params?: string[]; body?: Node } {
  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
    const fn = node as ArrowFunctionExpression;
    const params = fn.params.map(paramName);
    // 简体箭头 (x) => x+1 的 body 是表达式；块体是 BlockStatement
    return { params, body: fn.body };
  }
  if (node.type === "Identifier") {
    // 传入的是已定义函数名 —— 由 callFunction 处理，这里返回空
    return {};
  }
  return {};
}

function absIdentical(a: Abs, b: Abs): boolean {
  if (a.shape.k !== b.shape.k) return false;
  if (a.term !== b.term) {
    if (!a.term || !b.term || termToString(a.term) !== termToString(b.term)) return false;
  }
  if ((a.pred?.op ?? "true") !== (b.pred?.op ?? "true")) return false;
  return true;
}

function evalBlock(
  node: BlockStatement,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  let local = env;
  let curPhi = phi;
  let last: Abs = unknown;

  for (const stmt of node.body) {
    const r = evalNode(stmt, local, curPhi, budget);
    local = r.env;
    curPhi = r.phi;
    last = r.value;
    if (r.returned || r.brk || r.cont || r.threw) {
      return { value: r.value, phi: curPhi, env: local, returned: r.returned, brk: r.brk, cont: r.cont, threw: r.threw };
    }
  }
  return { value: last, phi: curPhi, env: local };
}

/** 循环固定点：有限次展开 + join（收敛即停） */
const MAX_LOOP_ITERS = 8;

function evalFor(
  node: ForStatement,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  let local = env;
  if (node.init) {
    const r = evalNode(node.init as Node, local, phi, budget);
    local = r.env;
  }
  let acc: Abs = unknown;
  for (let i = 0; i < MAX_LOOP_ITERS; i++) {
    if (node.test) {
      const t = evalNode(node.test, local, phi, budget);
      const lv = litValue(t.value);
      if (lv === false || lv === null || lv === undefined) break;
    }
    const bodyR = evalNode(node.body, local, phi, budget);
    if (bodyR.returned) return bodyR;
    if (bodyR.threw) return bodyR;
    if (bodyR.brk) {
      local = bodyR.env;
      break;
    }
    local = bodyR.env;
    acc = joinAbs(acc, bodyR.value);
    if (node.update) {
      const u = evalNode(node.update, local, phi, budget);
      local = u.env;
    }
  }
  return ok(acc, phi, local);
}

function evalWhile(
  node: WhileStatement,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  let local = env;
  let acc: Abs = unknown;
  for (let i = 0; i < MAX_LOOP_ITERS; i++) {
    const t = evalNode(node.test, local, phi, budget);
    const lv = litValue(t.value);
    if (lv === false || lv === null || lv === undefined) break;
    const bodyR = evalNode(node.body, local, phi, budget);
    if (bodyR.returned || bodyR.threw) return bodyR;
    if (bodyR.brk) {
      local = bodyR.env;
      break;
    }
    local = bodyR.env;
    acc = joinAbs(acc, bodyR.value);
  }
  return ok(acc, phi, local);
}

function evalDoWhile(
  node: DoWhileStatement,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  let local = env;
  let acc: Abs = unknown;
  for (let i = 0; i < MAX_LOOP_ITERS; i++) {
    const bodyR = evalNode(node.body, local, phi, budget);
    if (bodyR.returned || bodyR.threw) return bodyR;
    if (bodyR.brk) {
      local = bodyR.env;
      break;
    }
    local = bodyR.env;
    acc = joinAbs(acc, bodyR.value);
    const t = evalNode(node.test, local, phi, budget);
    const lv = litValue(t.value);
    if (lv === false || lv === null || lv === undefined) break;
  }
  return ok(acc, phi, local);
}

function evalForOf(
  node: ForOfStatement,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  const iterVal = evalNode(node.right, env, phi, budget).value;
  const elements: Abs[] =
    iterVal.shape.k === "arr"
      ? [iterVal.shape.element]
      : iterVal.shape.k === "tuple"
        ? iterVal.shape.elements
        : iterVal.shape.k === "sum"
          ? iterVal.shape.members.flatMap((m) =>
              m.shape.k === "arr"
                ? [m.shape.element]
                : m.shape.k === "tuple"
                  ? m.shape.elements
                  : [],
            )
          : [unknown];
  if (elements.length === 0) elements.push(unknown);

  const left = node.left;
  const bindName =
    left.type === "Identifier"
      ? (left as Identifier).name
      : left.type === "VariableDeclaration"
        ? ((left as VariableDeclaration).declarations[0]?.id as Identifier | undefined)?.name
        : undefined;
  if (!bindName) return ok(unknown, phi, env);

  let local = env;
  let acc: Abs = unknown;
  const n = Math.min(elements.length, MAX_LOOP_ITERS);
  for (let i = 0; i < n; i++) {
    local = withVar(local, bindName, elements[i]!);
    const bodyR = evalNode(node.body, local, phi, budget);
    if (bodyR.returned || bodyR.threw) return bodyR;
    if (bodyR.brk) {
      local = bodyR.env;
      break;
    }
    local = bodyR.env;
    acc = joinAbs(acc, bodyR.value);
  }
  return ok(acc, phi, local);
}

function evalTry(
  node: TryStatement,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  const tryR = evalNode(node.block, env, phi, budget);
  let value = tryR.value;
  let local = tryR.env;
  let curPhi = tryR.phi;

  if (tryR.threw && node.handler) {
    const param =
      node.handler.param && node.handler.param.type === "Identifier"
        ? (node.handler.param as Identifier).name
        : undefined;
    let catchEnv = local;
    if (param) catchEnv = withVar(local, param, tryR.value);
    const catchR = evalNode(node.handler.body, catchEnv, curPhi, budget);
    value = catchR.value;
    local = catchR.env;
    curPhi = catchR.phi;
    if (catchR.returned) {
      if (node.finalizer) evalNode(node.finalizer, local, curPhi, budget);
      return { ...catchR, env: local };
    }
    if (catchR.threw) {
      if (node.finalizer) evalNode(node.finalizer, local, curPhi, budget);
      return { value: catchR.value, phi: curPhi, env: local, threw: true };
    }
  } else if (tryR.returned) {
    if (node.finalizer) evalNode(node.finalizer, local, curPhi, budget);
    return tryR;
  } else if (tryR.threw && !node.handler) {
    if (node.finalizer) evalNode(node.finalizer, local, curPhi, budget);
    return tryR;
  }

  if (node.finalizer) {
    const fR = evalNode(node.finalizer, local, curPhi, budget);
    if (fR.returned || fR.threw) return fR;
    local = fR.env;
  }
  return { value, phi: curPhi, env: local, returned: tryR.returned };
}

function evalVarDecl(
  node: VariableDeclaration,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  let local = env;
  for (const d of node.declarations) {
    if (d.id.type !== "Identifier" || !d.init) continue;
    const r = evalNode(d.init, local, phi, budget);
    local = withVar(local, d.id.name, r.value);
  }
  return { value: unknown, phi, env: local };
}

function evalIf(
  node: IfStatement,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  const t = evalNode(node.test, env, phi, budget).value;
  const tv = litValue(t);

  if (tv === true) {
    return evalNode(node.consequent, env, phi, budget);
  }
  if (tv === false) {
    if (node.alternate) return evalNode(node.alternate, env, phi, budget);
    return ok(unknown, phi, env);
  }

  const tCons = trueConstraint(t);
  const fCons = falseConstraint(t);
  const a = evalNode(node.consequent, env, tCons ? and(phi, tCons) : phi, budget);
  if (node.alternate) {
    const b = evalNode(node.alternate, env, fCons ? and(phi, fCons) : phi, budget);
    return { value: joinAbs(a.value, b.value), phi, env, returned: a.returned || b.returned };
  }
  // if 无 else：与 fall-through join
  return { value: joinAbs(a.value, unknown), phi, env };
}

// --- 便捷 API ---

/**
 * 从源码分析指定函数在给定实参下的抽象结果。
 *
 * @example
 * analyzeFn(`
 *   const add = (a, b) => a + b;
 *   function scale(x) { return add(x, 1); }
 * `, "scale", [numVar("x", gtNum(v("x"), 0))], gtNum(v("x"), 0))
 */
export function analyzeFn(
  source: string,
  fnName: string,
  args: Abs[],
  phi: Phi = pTrue,
  budget?: LeakBudget,
): Abs {
  return evalSource(source, { fn: fnName, args }, { phi, budget }).value;
}

/**
 * 程序级 Abs 求值：注册全部顶层函数/class，再顺序执行语句。
 * 返回最终 env（vars 含导出绑定）。TypeValue 仅在调用方 bridge 时出现。
 *
 * seedVars / seedFns：host 注入（@nudo:mock 等）在求值前绑定。
 */
export function evalProgramAbs(
  source: string,
  opts: EvalOptions & {
    seedVars?: Record<string, Abs>;
    seedFns?: Record<string, { params: string[]; body: Node; async?: boolean }>;
  } = {},
): { env: AstEnv; last: Abs; phi: Phi } {
  resetAbsCallBudget();
  const file = parseSource(source);
  const env = emptyEnv();
  if (opts.seedVars) {
    for (const [k, v] of Object.entries(opts.seedVars)) {
      env.vars.set(k, v);
    }
  }
  if (opts.seedFns) {
    for (const [k, fn] of Object.entries(opts.seedFns)) {
      env.fns.set(k, fn);
    }
  }
  let phi = opts.phi ?? pTrue;
  let last: Abs = unknown;
  const budget = opts.budget ?? defaultLeakBudget;

  // 第一遍：函数与 class
  for (const stmt of file.program.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id) {
      registerFunction(env, stmt);
    }
    if (stmt.type === "ClassDeclaration") {
      registerClassDecl(env, stmt);
    }
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      const d = stmt.declaration;
      if (d.type === "FunctionDeclaration" && d.id) registerFunction(env, d);
      if (d.type === "ClassDeclaration") registerClassDecl(env, d);
    }
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
        if (
          d.id.type === "Identifier" &&
          (d.init?.type === "ArrowFunctionExpression" ||
            d.init?.type === "FunctionExpression")
        ) {
          const init = d.init as ArrowFunctionExpression;
          env.fns.set(d.id.name, {
            params: init.params.map(paramName),
            body: init.body,
            async: init.async === true,
          });
        }
      }
    }
  }

  // 第二遍：执行顶层语句（跳过已注册的声明）
  let local: AstEnv = env;
  for (const stmt of file.program.body) {
    if (stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration") continue;
    if (
      stmt.type === "ExportNamedDeclaration" ||
      stmt.type === "ExportDefaultDeclaration"
    ) {
      const decl = (stmt as { declaration?: Node }).declaration;
      if (decl && (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration")) {
        continue;
      }
      if (decl) {
        const r = evalNode(decl, local, phi, budget);
        local = r.env;
        last = r.value;
        phi = r.phi;
      }
      continue;
    }
    const r = evalNode(stmt, local, phi, budget);
    local = r.env;
    last = r.value;
    phi = r.phi;
    if (r.returned || r.threw) break;
  }

  return { env: local, last, phi };
}

/**
 * 收集整文件的节点 → Abs 表（LSP 无损信息源）。
 * 自包含源码上一次 evalProgramAbs 即可；失败返回空表。
 */
export function collectAbsNodeTypes(
  source: string,
  opts: EvalOptions & {
    seedVars?: Record<string, Abs>;
    seedFns?: Record<string, { params: string[]; body: Node; async?: boolean }>;
  } = {},
): Map<Node, Abs> {
  const map = new Map<Node, Abs>();
  setAbsNodeCollector((node, value) => {
    map.set(node, value);
  });
  try {
    evalProgramAbs(source, opts);
  } catch {
    // ignore
  } finally {
    setAbsNodeCollector(null);
  }
  return map;
}

/** 按 loc 找最紧的节点 Abs（hover 用） */
export function findAbsAtPosition(
  nodeTypes: Map<Node, Abs>,
  line: number,
  column: number,
): Abs | undefined {
  let best: Abs | undefined;
  let bestSize = Infinity;
  for (const [node, absVal] of nodeTypes) {
    const loc = node.loc;
    if (!loc) continue;
    if (loc.start.line !== line && loc.end.line !== line) continue;
    // 1-based line, 0-based column（与 Babel loc 一致；调用方注意）
    const inRange =
      (loc.start.line === line && column >= loc.start.column && column <= loc.end.column) ||
      (loc.end.line === line && column >= loc.start.column && column <= loc.end.column) ||
      (loc.start.line < line && loc.end.line > line);
    if (!inRange) continue;
    const size =
      (loc.end.line - loc.start.line) * 10000 + (loc.end.column - loc.start.column);
    if (size < bestSize) {
      bestSize = size;
      best = absVal;
    }
  }
  return best;
}
