/**
 * Babel AST 抽象求值：把「类型即计算」接到真实 JS 源码。
 * 支持表达式、函数声明/箭头、return、if、const/let、块作用域、类、循环。
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
  bool,
  unknown,
  litValue,
  isNumPrim,
  isStrPrim,
} from "./abs.ts";
import { add, sub, mul, div, mod, cmp, trueConstraint, falseConstraint, refineAbsForRelTrue, matchRelIdentLit } from "./arithmetic.ts";
import { typeofAbs, negAbs, notAbs, strictEqAbs } from "./surface.ts";
import { leakIfNeeded, defaultLeakBudget, type LeakBudget } from "./leak.ts";
import { spread, joinAbs, getSlot } from "./objects.ts";
import { shouldWidenArrayLiteral, widenedArrayConf } from "./containers.ts";
import { absFunction, attachFnImpl, getFnImpl } from "./abs-fn.ts";
import {
  applyCallbackAbs,
  isRelFn,
  instantiateReturn,
  mapElementFallback,
  projectFlatMapResult,
  setApplyCallbackHost,
  undefAbs,
} from "./hof.ts";
import type { AstEnv } from "./ast-env.ts";
import {
  tryPromoteDirectCall,
  tryPromoteForOfIteratee,
  tryPromoteHofCallback,
  tryPromoteReceiverAsArr,
} from "./hof.ts";
import { concatString, isTemplateLike } from "./template.ts";
import {
  evalGlobalFn,
  evalNamespaceCall,
  evalBuiltinNew,
  evalBuiltinInstanceMethod,
} from "./builtins.ts";
import { callAbsMethod, getAbsProperty } from "./methods.ts";
import { noteMemberDispatchMiss, noteUnknownMemberMissing } from "./exec/member-diag.ts";
import { registerBClass } from "./exec/class-registry.ts";
import { bindImports, type AbsModuleExports } from "./abs-modules.ts";
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

/** AstEnv 已迁 ./ast-env.ts；此处兼容 re-export，外部消费不破坏 */
export type { AstEnv };

export function emptyEnv(): AstEnv {
  return { vars: new Map(), fns: new Map() };
}

export function withVar(env: AstEnv, name: string, value: Abs): AstEnv {
  const vars = new Map(env.vars);
  vars.set(name, value);
  return { vars, fns: env.fns, classes: env.classes, hofCollect: env.hofCollect };
}

export type EvalOptions = {
  phi?: Phi;
  budget?: LeakBudget;
  /** 预解析 AST（check 等批量场景避免重复 parse） */
  file?: File;
  /** host 已求值的相对依赖导出表 */
  modules?: Record<string, AbsModuleExports>;
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
  /** 分支/循环体内发生：可变绑定在路径上取并集是合法 JS，不参与结构检查 */
  conditional?: boolean;
};

let absAssignCollector: ((r: AbsAssignRecord) => void) | null = null;

/** >0 表示当前正在求值分支/循环体（赋值是路径条件性的） */
let assignFlowDepth = 0;

export function setAbsAssignCollector(
  collector: ((r: AbsAssignRecord) => void) | null,
): void {
  absAssignCollector = collector;
}

/** 在条件流（分支体/循环体）内求值 body——期间记录的赋值标记 conditional */
function evalInConditionalFlow<T>(body: () => T): T {
  assignFlowDepth++;
  try {
    return body();
  } finally {
    assignFlowDepth--;
  }
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
      conditional: assignFlowDepth > 0,
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
  /**
   * if 无 else 且 consequent 已 return/throw：真分支已产出 value，
   * 假分支 fall-through 仍可能走后续语句。evalBlock 需与后续结果 join。
   */
  partialReturn?: boolean;
};

// --- 源码入口 ---
// parseSource 唯一实现在 ./parse-source.ts；此处经 `parse` 别名使用，不再重复导出。

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
  const file = opts.file ?? parse(source);
  const env = emptyEnv();
  let phi = opts.phi ?? pTrue;

  if (opts.modules) {
    for (const stmt of file.program.body) {
      if (stmt.type === "ImportDeclaration") {
        bindImports(stmt, env, opts.modules);
      }
    }
  }

  // 第一遍：注册函数与 class（class 必须在调用前登记 methods）
  for (const stmt of file.program.body) {
    if (stmt.type === "ImportDeclaration") continue;
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
  // 桥接进 B classRegistry：import 后的 `new C(...)` 走 $new 能找到 ctor
  {
    const callM = (m: MethodDef) => (thisVal: Abs, ...args: Abs[]) =>
      evalMethodBody(m, args, thisVal, env, pTrue, defaultLeakBudget, name);
    const ctorDef = def.methods.get("constructor");
    const methodImpls: Record<string, (thisVal: Abs, ...args: Abs[]) => Abs> = {};
    for (const [mn, md] of def.methods) {
      if (mn === "constructor") continue;
      methodImpls[mn] = callM(md);
    }
    registerBClass({
      name,
      superName,
      ctor: ctorDef ? callM(ctorDef) : undefined,
      methods: methodImpls,
    });
  }
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
    let local: AstEnv = { vars: new Map(env.vars), fns: env.fns, hofCollect: env.hofCollect };
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
        const slot = getSlot((obj.shape as { slots: Record<string, { value: Abs }> }).slots, key);
        if (slot) return ok(slot.value, phi, env);
      }
      // 计算属性 obj[key]
      if (m.computed) {
        const key = evalNode(m.property, env, phi, budget).value;
        const kl = litValue(key);
        if (typeof kl === "string" && obj.shape.k === "obj") {
          const slot = getSlot((obj.shape as { slots: Record<string, { value: Abs }> }).slots, kl);
          if (slot) return ok(slot.value, phi, env);
        }
        // 数组/元组下标
        if (typeof kl === "number") {
          if (obj.shape.k === "tuple") {
            return ok(obj.shape.elements[kl] ?? unknown, phi, env);
          }
          if (obj.shape.k === "arr") {
            return ok((obj.shape as { element: Abs }).element, phi, env);
          }
        }
      }
      // unknown 上的裸属性 → unknown-recv（$get 同口径；obj open 不记）
      if (!m.computed && m.property.type === "Identifier") {
        const loc = node.loc
          ? ([node.loc.start.line, node.loc.start.column] as [number, number])
          : undefined;
        noteUnknownMemberMissing(obj, (m.property as Identifier).name, "property", loc);
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
      // 容器策略单点（containers.ts）：≤cap tuple / >cap arr，与 B 路径 $arr 同源
      if (!shouldWidenArrayLiteral(els.length)) {
        return ok(abs({ k: "tuple", elements: els }, undefined, undefined, "exact"), phi, env);
      }
      const elem = els.reduce((x, y) => joinAbs(x, y));
      return ok(abs({ k: "arr", element: elem }, undefined, undefined, widenedArrayConf()), phi, env);
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

      const obj0 = evalNode(m.object, env, phi, budget).value;
      let obj = obj0;
      // 挂载点①：形参 any 上的 HOF 方法 miss → 提升为 arr，再走正常分支
      if (
        m.object.type === "Identifier" &&
        env.hofCollect &&
        (obj0.shape.k === "any" || obj0.shape.k === "unknown")
      ) {
        const loc0 = node.loc
          ? { line: node.loc.start.line, column: node.loc.start.column }
          : undefined;
        const promoted = tryPromoteReceiverAsArr(
          env,
          (m.object as Identifier).name,
          method,
          loc0,
        );
        if (promoted) obj = promoted;
      }
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

      // 字符串方法（字面量可折叠）——仅 string prim / string 字面量，勿把 number lit 误判
      if (isStrPrim(obj) || (obj.term?.op === "lit" && typeof litValue(obj) === "string")) {
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
        // 挂载点③：回调形参提升（receiver 已是 arr 时仍生效）
        if (fnNode.type === "Identifier" && env.hofCollect) {
          const elem0 =
            obj.shape.k === "arr"
              ? (obj.shape as { element: Abs }).element
              : obj.shape.k === "tuple"
                ? (obj.shape.elements[0] ?? unknown)
                : unknown;
          const loc0 = node.loc
            ? { line: node.loc.start.line, column: node.loc.start.column }
            : undefined;
          tryPromoteHofCallback(env, (fnNode as Identifier).name, "map", [elem0], loc0);
        }
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
        const out0 = applyUnaryCallback(fnNode, elem, env, phi, budget);
        const cbAbs = fnNode.type === "Identifier"
          ? env.vars.get((fnNode as Identifier).name)
          : undefined;
        const out = mapElementFallback(cbAbs, elem, out0);
        const elConf = out === out0 ? confJoin(obj.conf, out.conf) : "partial";
        return ok(
          abs({ k: "arr", element: out }, undefined, undefined, elConf),
          phi,
          env,
        );
      }

      if (method === "reduce" && rawArgs.length >= 2) {
        const fnNode = rawArgs[0]!;
        let acc = evalNode(rawArgs[1]!, env, phi, budget).value;
        // 挂载点③
        if (fnNode.type === "Identifier" && env.hofCollect) {
          const item0 =
            obj.shape.k === "arr"
              ? (obj.shape as { element: Abs }).element
              : obj.shape.k === "tuple"
                ? (obj.shape.elements[0] ?? unknown)
                : unknown;
          const loc0 = node.loc
            ? { line: node.loc.start.line, column: node.loc.start.column }
            : undefined;
          tryPromoteHofCallback(env, (fnNode as Identifier).name, "reduce", [acc, item0], loc0);
        }
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
        // 仅 relation → 一次 join（不动点只在有 body 时跑）
        if (
          fnNode.type === "Identifier" &&
          isRelationOnlyCb(env.vars.get((fnNode as Identifier).name))
        ) {
          const cbAbs = env.vars.get((fnNode as Identifier).name)!;
          const d = instantiateReturn(cbAbs, [acc, item]);
          return ok(joinAbs(acc, d), phi, env);
        }
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
        // 挂载点③
        if (fnNode.type === "Identifier" && env.hofCollect) {
          const elem0 =
            obj.shape.k === "arr"
              ? (obj.shape as { element: Abs }).element
              : obj.shape.k === "tuple"
                ? (obj.shape.elements[0] ?? unknown)
                : unknown;
          const loc0 = node.loc
            ? { line: node.loc.start.line, column: node.loc.start.column }
            : undefined;
          tryPromoteHofCallback(env, (fnNode as Identifier).name, "filter", [elem0], loc0);
        }
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
        // arr：filter 保持元素类型（不传播回调 pred）
        return ok(obj, phi, env);
      }

      if (method === "flatMap" && rawArgs.length >= 1) {
        const fnNode = rawArgs[0]!;
        // 挂载点③
        if (fnNode.type === "Identifier" && env.hofCollect) {
          const elem0 =
            obj.shape.k === "arr"
              ? (obj.shape as { element: Abs }).element
              : obj.shape.k === "tuple"
                ? (obj.shape.elements[0] ?? unknown)
                : unknown;
          const loc0 = node.loc
            ? { line: node.loc.start.line, column: node.loc.start.column }
            : undefined;
          tryPromoteHofCallback(env, (fnNode as Identifier).name, "flatMap", [elem0], loc0);
        }
        if (obj.shape.k === "tuple") {
          const mapped = obj.shape.elements.map((el) =>
            applyUnaryCallback(fnNode, el, env, phi, budget),
          );
          return ok(projectFlatMapResult(obj.conf, mapped), phi, env);
        }
        const elem =
          obj.shape.k === "arr"
            ? (obj.shape as { element: Abs }).element
            : unknown;
        const out = applyUnaryCallback(fnNode, elem, env, phi, budget);
        return ok(projectFlatMapResult(obj.conf, [out]), phi, env);
      }

      if (method === "forEach" && rawArgs.length >= 1) {
        const fnNode = rawArgs[0]!;
        if (obj.shape.k === "tuple") {
          for (const el of obj.shape.elements) {
            applyUnaryCallback(fnNode, el, env, phi, budget);
          }
        } else if (obj.shape.k === "arr") {
          applyUnaryCallback(fnNode, (obj.shape as { element: Abs }).element, env, phi, budget);
        }
        return ok(undefAbs(), phi, env);
      }

      if ((method === "some" || method === "every") && rawArgs.length >= 1) {
        const fnNode = rawArgs[0]!;
        if (obj.shape.k === "tuple") {
          for (const el of obj.shape.elements) {
            applyUnaryCallback(fnNode, el, env, phi, budget);
          }
        } else if (obj.shape.k === "arr") {
          applyUnaryCallback(fnNode, (obj.shape as { element: Abs }).element, env, phi, budget);
        }
        return ok(bool(), phi, env);
      }

      if (method === "find" && rawArgs.length >= 1) {
        // 不证明命中元素：tuple 只对首元素应用回调（副作用面偏窄）；结果 element ∪ undefined
        const fnNode = rawArgs[0]!;
        const elem =
          obj.shape.k === "arr"
            ? (obj.shape as { element: Abs }).element
            : obj.shape.k === "tuple"
              ? (obj.shape.elements[0] ?? unknown)
              : unknown;
        applyUnaryCallback(fnNode, elem, env, phi, budget);
        return ok(joinAbs(elem, undefAbs()), phi, env);
      }
      // 分派失败：prim/unknown 上记 method-missing（跨文件 import 函数体走此路径）
      {
        const loc = node.loc
          ? ([node.loc.start.line, node.loc.start.column] as [number, number])
          : undefined;
        noteMemberDispatchMiss(obj, method, "method", loc);
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

  // 变量上的 Abs 一等函数（含 relation-only / shape-only）
  let bound = env.vars.get(name);
  // 挂载点②：形参直接调用 p(x) —— 先提升再分派
  if (
    env.hofCollect?.paramNames.has(name) &&
    bound &&
    (bound.shape.k === "any" || bound.shape.k === "unknown")
  ) {
    const loc0 = node.loc
      ? { line: node.loc.start.line, column: node.loc.start.column }
      : undefined;
    tryPromoteDirectCall(env, name, args, loc0);
    bound = env.vars.get(name);
  }
  if (bound && (getFnImpl(bound) || isRelFn(bound))) {
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

/**
 * 应用 Abs 一等函数。统一顺序：apply → body → relation → isRelFn。
 * 调用门须扩为 `getFnImpl || isRelFn`，否则 E 路径永远进不来。
 */
export function applyAbsFn(
  fnVal: Abs,
  args: Abs[],
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): Abs {
  // 函数 union：对每个 member 按统一顺序求值后 join
  if (fnVal?.shape?.k === "sum") {
    const results = fnVal.shape.members.map((m) =>
      applyAbsFn(m, args, env, phi, budget),
    );
    if (results.every((r) => r.shape.k === "unknown")) return unknown;
    return results.reduce((a, b) => joinAbs(a, b));
  }
  const impl = getFnImpl(fnVal);
  // D/E：relation-only / shape-only，无 body，不进 body budget
  if (!impl?.body && !impl?.apply) {
    if (impl?.relation) return instantiateReturn(fnVal, args);
    if (isRelFn(fnVal)) return instantiateReturn(fnVal, args);
    return unknown;
  }
  // body 存在 → 稳定对象身份；无 body → fingerprint（禁止 returnType 兜底）
  const implId = impl!.body
    ? stableCallId(impl!.body as unknown as object)
    : (impl!.fingerprint ?? `anon#${impl!.params.length}`);
  const key = callBudgetKey("absfn", implId, args);
  const label = (fnVal.shape as { name?: string }).name ?? "anonymous";
  if (!enterCall(key, label)) return truncatedAbs();
  try {
    // mock withArgs 等：有 apply 钩子时按实参派发，不经 body
    if (impl!.apply) return impl!.apply(args);
    const base = impl!.env ?? env;
    let local: AstEnv = { vars: new Map(base.vars), fns: base.fns, hofCollect: env.hofCollect };
    if ((base as { classes?: unknown }).classes) {
      (local as { classes?: unknown }).classes = (base as { classes?: unknown }).classes;
    }
    impl!.params.forEach((p, i) => {
      local.vars.set(p, args[i] ?? unknown);
    });
    const result = evalNode(impl!.body!, local, phi, budget);
    // body 抛错 → never（恢复 $call 旧行为，不把中间值当返回值）
    if (result.threw) {
      return abs({ k: "never" }, undefined, undefined, "exact");
    }
    if (impl!.async) return coerceAsyncReturn(result.value);
    return result.value;
  } finally {
    exitCall();
  }
}

// 注册到 hof.applyCallbackAbs，避免 hof → ast-eval 循环 import
setApplyCallbackHost((cb, args, env, phi, budget) => {
  const e = env as AstEnv;
  const p = phi as Phi;
  const b = budget as LeakBudget;
  const node = cb as Node;
  if (node && typeof node === "object" && "type" in node && node.type === "Identifier") {
    const name = (node as Identifier).name;
    const bound = e.vars.get(name);
    if (bound && (getFnImpl(bound) || isRelFn(bound) || bound.shape.k === "sum")) {
      return applyAbsFn(bound, args as Abs[], e, p, b);
    }
    if (e.fns.has(name)) return callFunction(e, name, args as Abs[], p, b);
    return unknown;
  }
  if (cb && typeof cb === "object" && "shape" in cb) {
    return applyAbsFn(cb as Abs, args as Abs[], e, p, b);
  }
  // Node inline
  const inline = cb as Node;
  const { params, body } = extractCallback(inline);
  if (!params || !body) return unknown;
  let local: AstEnv = { vars: new Map(e.vars), fns: e.fns, hofCollect: e.hofCollect };
  params.forEach((pn, i) => {
    local.vars.set(pn, (args as Abs[])[i] ?? unknown);
  });
  return evalNode(body, local, p, b).value;
});

/**
 * 把 (x) => body 或命名函数用给定实参求值一次。
 * 统一委托 applyCallbackAbs（Identifier/Abs/Node/sum 单点定义）。
 */
function applyUnaryCallback(
  fnNode: Node,
  arg: Abs,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): Abs {
  return applyCallbackAbs(fnNode, [arg], env, phi, budget);
}

function applyBinaryCallback(
  fnNode: Node,
  a: Abs,
  b: Abs,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): Abs {
  return applyCallbackAbs(fnNode, [a, b], env, phi, budget);
}

/** relation-only 回调（无 body/apply，有 relation 槽或 isRelFn） */
function isRelationOnlyCb(cb: Abs | undefined): boolean {
  if (!cb) return false;
  const impl = getFnImpl(cb);
  if (impl?.body || impl?.apply) return false;
  return !!(impl?.relation || isRelFn(cb));
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
  /** if 无 else 时真分支已 return 的值，待与 fall-through join */
  let pendingPartial: Abs | undefined;

  for (const stmt of node.body) {
    const r = evalNode(stmt, local, curPhi, budget);
    local = r.env;
    curPhi = r.phi;
    if (r.partialReturn) {
      pendingPartial =
        pendingPartial !== undefined ? joinAbs(pendingPartial, r.value) : r.value;
      // fall-through：继续求后续语句
      last = r.value;
      continue;
    }
    last = r.value;
    if (pendingPartial !== undefined) {
      last = joinAbs(pendingPartial, r.value);
      pendingPartial = undefined;
    }
    if (r.returned || r.brk || r.cont || r.threw) {
      return { value: last, phi: curPhi, env: local, returned: r.returned, brk: r.brk, cont: r.cont, threw: r.threw };
    }
  }
  if (pendingPartial !== undefined) {
    // 真分支 return 后无后续语句：return 值 ∪ undefined（隐式 undefined）
    return { value: joinAbs(pendingPartial, unknown), phi: curPhi, env: local, returned: true };
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
    const bodyR = evalInConditionalFlow(() => evalNode(node.body, local, phi, budget));
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
    const bodyR = evalInConditionalFlow(() => evalNode(node.body, local, phi, budget));
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
    const bodyR = evalInConditionalFlow(() => evalNode(node.body, local, phi, budget));
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
  let iterVal = evalNode(node.right, env, phi, budget).value;
  // 挂载点（for-of）：形参 any 上的迭代 → 提升 arr，再按元素分发
  if (
    node.right.type === "Identifier" &&
    env.hofCollect &&
    (iterVal.shape.k === "any" || iterVal.shape.k === "unknown")
  ) {
    const loc0 = node.loc
      ? { line: node.loc.start.line, column: node.loc.start.column }
      : undefined;
    const promoted = tryPromoteForOfIteratee(
      env,
      (node.right as Identifier).name,
      loc0,
    );
    if (promoted) iterVal = promoted;
  }
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
    const bodyR = evalInConditionalFlow(() => evalNode(node.body, local, phi, budget));
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
    // Hover/inlay on the binding name must see the init Abs, not the
    // statement's `unknown` (which would otherwise win via loc overlap).
    recordAbsNode(d.id, r.value);
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

  /** 真/假分支：对比较里的 Identifier 做 shape 收窄（any → number>… | string） */
  const refineEnv = (branch: "true" | "false"): AstEnv => {
    const m = matchRelIdentLit(node.test);
    if (!m || branch !== "true") return env;
    const cur = env.vars.get(m.name);
    if (!cur) return env;
    return withVar(env, m.name, refineAbsForRelTrue(cur, m.op, m.k));
  };

  if (tv === true) {
    return evalNode(node.consequent, refineEnv("true"), phi, budget);
  }
  if (tv === false) {
    if (node.alternate) return evalNode(node.alternate, env, phi, budget);
    return ok(unknown, phi, env);
  }

  const tCons = trueConstraint(t);
  const fCons = falseConstraint(t);
  const envT = refineEnv("true");
  const a = evalInConditionalFlow(() =>
    evalNode(node.consequent, envT, tCons ? and(phi, tCons) : phi, budget),
  );
  const alt = node.alternate;
  if (alt) {
    const b = evalInConditionalFlow(() =>
      evalNode(alt, env, fCons ? and(phi, fCons) : phi, budget),
    );
    return { value: joinAbs(a.value, b.value), phi, env, returned: a.returned || b.returned };
  }
  // if 无 else：与 fall-through join。
  // consequent 若 return/throw，真分支已退出、假分支 fall-through——
  // 标记 partialReturn，由 evalBlock 与后续语句结果 join（不得覆盖）。
  if (a.returned || a.threw) {
    return { value: a.value, phi, env, partialReturn: true };
  }
  return { value: unknown, phi, env };
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
  file?: File,
  modules?: Record<string, AbsModuleExports>,
): Abs {
  return evalSource(source, { fn: fnName, args }, { phi, budget, file, modules }).value;
}

/**
 * 程序级 Abs 求值：注册全部顶层函数/class，再顺序执行语句。
 * 返回最终 env（vars 含导出绑定）。TypeValue 仅在调用方 bridge 时出现。
 *
 * seedVars / seedFns：host 注入（@nudo:mock 等）在求值前绑定。
 * modules：host 已求值的依赖导出表（specifier → AbsModuleExports）。
 */
export function evalProgramAbs(
  source: string,
  opts: EvalOptions & {
    seedVars?: Record<string, Abs>;
    seedFns?: Record<string, { params: string[]; body: Node; async?: boolean }>;
    modules?: Record<string, AbsModuleExports>;
  } = {},
): { env: AstEnv; last: Abs; phi: Phi } {
  resetAbsCallBudget();
  const file = opts.file ?? parse(source);
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
  // import 先绑定（ESM 提升）
  for (const stmt of file.program.body) {
    if (stmt.type === "ImportDeclaration" && opts.modules) {
      bindImports(stmt, env, opts.modules);
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
    if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      const d = stmt.declaration;
      if (d.type === "FunctionDeclaration") {
        if (d.id) registerFunction(env, d);
        else {
          env.fns.set("default", {
            params: d.params.map(paramName),
            body: d.body,
            async: d.async === true,
          });
        }
      }
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
    if (stmt.type === "ImportDeclaration") continue;
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
