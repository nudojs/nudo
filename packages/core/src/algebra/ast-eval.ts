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
  SwitchStatement,
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
  bigintLit,
  bool,
  unknown,
  litValue,
  isNumPrim,
  isStrPrim,
} from "./abs.ts";
import { add, sub, mul, div, mod, cmp, trueConstraint, falseConstraint, refineAbsForRelTrue, matchRelIdentLit } from "./arithmetic.ts";
import {
  typeofAbs,
  negAbs,
  notAbs,
  strictEqAbs,
  looseEqAbs,
  isNullishLitAbs,
  definitelyNotNullishShape,
  bitandAbs,
  bitorAbs,
  bitxorAbs,
  bitnotAbs,
  shlAbs,
  shrAbs,
  ushrAbs,
  powAbs,
  toNumberAbs,
} from "./surface.ts";
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
import {
  noteMemberDispatchMiss,
  noteUnknownMemberMissing,
  noteAnyMemberMayThrow,
  noteNullishMemberThrows,
  anyMemberResult,
} from "./exec/member-diag.ts";
import { errorTypeAbs, pushMayThrowFrame, popMayThrowFrame, orphanMayThrowEffects } from "./exec/may-throw.ts";
import { NudoThrow } from "./exec/runtime.ts";
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

/** 抽象分支 env 合流：任一侧写过的键与 base 做 join */
function joinEnvs(a: AstEnv, b: AstEnv, base: AstEnv): AstEnv {
  const vars = new Map(base.vars);
  const keys = new Set<string>([...a.vars.keys(), ...b.vars.keys()]);
  for (const k of keys) {
    const va = a.vars.get(k);
    const vb = b.vars.get(k);
    const baseV = base.vars.get(k);
    if (va !== undefined && vb !== undefined) {
      vars.set(k, va === vb ? va : joinAbs(va, vb));
    } else if (va !== undefined) {
      vars.set(k, baseV !== undefined ? joinAbs(baseV, va) : va);
    } else if (vb !== undefined) {
      vars.set(k, baseV !== undefined ? joinAbs(baseV, vb) : vb);
    }
  }
  return {
    vars,
    fns: a.fns ?? b.fns,
    classes: a.classes ?? b.classes,
    hofCollect: a.hofCollect ?? b.hofCollect,
  };
}

export type EvalOptions = {
  phi?: Phi;
  budget?: LeakBudget;
  /** 预解析 AST（check 等批量场景避免重复 parse） */
  file?: File;
  /** host 已求值的相对依赖导出表 */
  modules?: Record<string, AbsModuleExports>;
  /** host 注入（@nudo:mock 等）在求值前绑定（evalSource 也认） */
  seedVars?: Record<string, Abs>;
  seedFns?: Record<string, { params: string[]; body: Node; async?: boolean }>;
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

/** 设置收集器并返回先前值（嵌套/并发宿主须 restore，勿直接置 null） */
export function setAbsCallCollector(
  collector: ((r: AbsCallRecord) => void) | null,
): ((r: AbsCallRecord) => void) | null {
  const prev = absCallCollector;
  absCallCollector = collector;
  return prev;
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
  /** 未捕获 throws 域（never = 无）；threw 时 value 通常是 never */
  throws?: Abs;
  /** 函数已通过 return 跳出，块内后续语句不可达 */
  returned?: boolean;
  /** break 跳出最近循环 */
  brk?: boolean;
  /** continue 进入下一轮 */
  cont?: boolean;
  /** throw 了 value（未捕获时向上传播） */
  threw?: boolean;
  /** throw 语句源位置（1-based line，0-based column；Babel loc 口径） */
  throwLoc?: { line: number; column: number };
  /**
   * if 无 else 且 consequent 已 return/throw：真分支已产出 value，
   * 假分支 fall-through 仍可能走后续语句。evalBlock 需与后续结果 join。
   */
  partialReturn?: boolean;
  /** 抽象分支可能 throw（另一侧继续）— try 需并 catch 路径 */
  partialThrow?: boolean;
  throwValue?: Abs;
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

  if (opts.modules) {
    for (const stmt of file.program.body) {
      if (stmt.type === "ImportDeclaration") {
        bindImports(stmt, env, opts.modules);
      }
    }
  }

  // 第一遍：注册函数与 class（与 generalize / listTopFunctions 对齐）
  for (const stmt of file.program.body) {
    registerTopLevelCallable(env, stmt);
  }

  const full = callFunctionFull(env, entry.fn, entry.args, phi, opts.budget);
  return {
    value: full.result,
    throws: full.throws,
    phi,
    env,
    ...(full.throws.shape.k !== "never"
      ? { threw: true, ...(full.throwLoc ? { throwLoc: full.throwLoc } : {}) }
      : {}),
  };
}

/** 把 arrow/function 表达式绑到 env.fns；具名 FunctionExpression 同时登记 id（analyzer 优先 id） */
function bindFnInit(env: AstEnv, name: string, init: Node): void {
  const asFn = init as {
    type?: string;
    params?: Node[];
    body?: Node;
    async?: boolean;
    id?: { name?: string };
  };
  const isCallable =
    init.type === "ArrowFunctionExpression" ||
    init.type === "FunctionExpression" ||
    init.type === "ObjectMethod" ||
    init.type === "ClassMethod";
  if (!isCallable || !asFn.body) return;
  const entry = {
    params: (asFn.params ?? []).map(paramName),
    body: asFn.body,
    async: asFn.async === true,
  };
  env.fns.set(name, entry);
  if (init.type === "FunctionExpression") {
    const idName = asFn.id?.name;
    if (idName && idName !== name && !env.fns.has(idName)) {
      env.fns.set(idName, entry);
    }
  }
}

/**
 * 注册顶层可调用绑定（与 generalize/listTopFunctions 对齐）：
 * 函数/class 声明、export default、export const/let/var 的函数初始化、
 * 以及 CJS `exports.f = fn` / `module.exports.f = fn` / `module.exports = fn`。
 */
function registerTopLevelCallable(env: AstEnv, stmt: Node): void {
  if (stmt.type === "ImportDeclaration") return;

  const walkDecl = (d: Node | undefined | null): void => {
    if (!d) return;
    if (d.type === "FunctionDeclaration") {
      const id = (d as FunctionDeclaration).id;
      if (id?.name) registerFunction(env, d as FunctionDeclaration);
      else env.fns.set("default", {
        params: (d as FunctionDeclaration).params.map(paramName),
        body: (d as FunctionDeclaration).body,
        async: (d as FunctionDeclaration).async === true,
      });
      return;
    }
    if (d.type === "ClassDeclaration") {
      registerClassDecl(env, d);
      return;
    }
    if (d.type === "VariableDeclaration") {
      for (const decl of (d as { declarations: Array<{ id?: Node; init?: Node }> }).declarations) {
        if (decl.id?.type === "Identifier" && decl.init) {
          bindFnInit(env, (decl.id as { name: string }).name, decl.init);
        }
      }
      return;
    }
    // export default Identifier / expression：若已是本地 fn 则无需重绑
    if (d.type === "ArrowFunctionExpression" || d.type === "FunctionExpression") {
      bindFnInit(env, "default", d);
    }
  };

  if (stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration" || stmt.type === "VariableDeclaration") {
    walkDecl(stmt);
    return;
  }
  if (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration") {
    walkDecl((stmt as { declaration?: Node }).declaration);
    return;
  }

  // CJS：exports.name = fn | module.exports.name = fn | module.exports = fn | exports = fn
  if (stmt.type === "ExpressionStatement") {
    const expr = (stmt as { expression?: Node }).expression;
    if (expr?.type !== "AssignmentExpression") return;
    const left = (expr as { left?: Node }).left;
    const right = (expr as { right?: Node }).right;
    if (!left || !right) return;

    const isExportsIdent = (n: Node | undefined): boolean =>
      !!n && n.type === "Identifier" && (n as { name?: string }).name === "exports";
    const isModuleExports = (n: Node | undefined): boolean => {
      if (!n || n.type !== "MemberExpression") return false;
      const obj = (n as { object?: Node }).object;
      const prop = (n as { property?: Node }).property;
      return (
        !!obj &&
        obj.type === "Identifier" &&
        (obj as { name?: string }).name === "module" &&
        !!prop &&
        ((prop as { name?: string }).name === "exports" ||
          (prop as { value?: unknown }).value === "exports")
      );
    };

    if (left.type === "Identifier" && (left as { name?: string }).name === "module" ) {
      return; // bare `module = …` not an export binding
    }

    // module.exports = fn
    if (isModuleExports(left)) {
      if (right.type === "FunctionExpression" || right.type === "ArrowFunctionExpression") {
        const idName =
          right.type === "FunctionExpression"
            ? (right as { id?: { name?: string } }).id?.name
            : undefined;
        bindFnInit(env, idName ?? "default", right);
      }
      if (right.type === "ObjectExpression") {
        for (const prop of (right as { properties?: Node[] }).properties ?? []) {
          const ptype = (prop as { type?: string }).type;
          if (
            ptype !== "ObjectProperty" &&
            ptype !== "Property" &&
            ptype !== "ObjectMethod" &&
            ptype !== "ClassMethod"
          ) {
            continue;
          }
          const key = (prop as { key?: Node }).key;
          const value = (prop as { value?: Node }).value;
          const keyName =
            key?.type === "Identifier"
              ? (key as { name?: string }).name
              : key && (key.type === "StringLiteral" || key.type === "NumericLiteral")
                ? String((key as { value?: unknown }).value)
                : undefined;
          if (!keyName) continue;
          if (ptype === "ObjectMethod" || ptype === "ClassMethod") {
            bindFnInit(env, keyName, prop as Node);
          } else if (value) {
            bindFnInit(env, keyName, value);
          }
        }
      }
      return;
    }

    // exports.f = fn / module.exports.f = fn
    if (left.type === "MemberExpression") {
      const obj = (left as { object?: Node }).object;
      const prop = (left as { property?: Node }).property;
      const computed = (left as { computed?: boolean }).computed === true;
      if (computed) return;
      if (!isExportsIdent(obj) && !isModuleExports(obj)) return;
      const name =
        prop?.type === "Identifier"
          ? (prop as { name?: string }).name
          : prop && (prop.type === "StringLiteral" || prop.type === "NumericLiteral")
            ? String((prop as { value?: unknown }).value)
            : undefined;
      if (!name) return;
      bindFnInit(env, name, right);
    }
  }
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
  // L2 / check 按 `Class.method` 名求值：实例与 static 方法都绑进 env.fns
  for (const m of cls.body.body) {
    if (m.type !== "ClassMethod" && m.type !== "ObjectMethod" && m.type !== "MethodDefinition") {
      continue;
    }
    if (m.kind && m.kind !== "method") continue;
    if (!m.body) continue;
    const keyName =
      m.key?.type === "Identifier"
        ? (m.key as Identifier).name
        : m.key?.type === "StringLiteral"
          ? (m.key as StringLiteral).value
          : undefined;
    if (!keyName) continue;
    env.fns.set(`${name}.${keyName}`, {
      params: (m.params ?? []).map(paramName),
      body: m.body as Node,
      async: m.async === true,
    });
  }
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

/**
 * 调用具名函数并返回 throws/loc（T20）。
 * threw 时 result=never、throws=抛出值、throwLoc=throw 语句位置。
 */
export function callFunctionFull(
  env: AstEnv,
  name: string,
  args: Abs[],
  phi: Phi = pTrue,
  budget: LeakBudget = defaultLeakBudget,
): { result: Abs; throws: Abs; throwLoc?: { line: number; column: number } } {
  const fn = env.fns.get(name);
  const neverAbs = abs({ k: "never" }, undefined, undefined, "exact");
  if (!fn) return { result: unknown, throws: neverAbs };

  const key = callBudgetKey("fn", name, args);
  if (!enterCall(key, name)) {
    return { result: truncatedAbs(), throws: neverAbs };
  }
  try {
    let local: AstEnv = { vars: new Map(env.vars), fns: env.fns, hofCollect: env.hofCollect };
    const cls = (env as AstEnv & { classes?: Map<string, unknown> }).classes;
    if (cls) (local as AstEnv & { classes?: Map<string, unknown> }).classes = cls;

    fn.params.forEach((p, i) => {
      local.vars.set(p, args[i] ?? unknown);
    });

    const result = evalNode(fn.body, local, phi, budget);
    if (result.threw) {
      return {
        result: neverAbs,
        throws: result.value,
        ...(result.throwLoc ? { throwLoc: result.throwLoc } : {}),
      };
    }
    if (fn.async) {
      return { result: coerceAsyncReturn(result.value), throws: neverAbs };
    }
    return { result: result.value, throws: neverAbs };
  } finally {
    exitCall();
  }
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
    case "BigIntLiteral":
      return ok(bigintLit((node as { value: bigint }).value), phi, env);
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
      const op = ae.operator;
      const applyBin = (binOp: string, lhs: Abs, rhsAbs: Abs): Abs => {
        switch (binOp) {
          case "+":
            return leakIfNeeded(add(lhs, rhsAbs, phi), budget, "add");
          case "-":
            return leakIfNeeded(sub(lhs, rhsAbs, phi), budget, "sub");
          case "*":
            return leakIfNeeded(mul(lhs, rhsAbs, phi), budget, "mul");
          case "/":
            return leakIfNeeded(div(lhs, rhsAbs, phi), budget, "div");
          case "%":
            return leakIfNeeded(mod(lhs, rhsAbs, phi), budget, "mod");
          default:
            return unknown;
        }
      };
      let rhs: Abs;
      if (op === "=") {
        rhs = evalNode(ae.right, env, phi, budget).value;
      } else if (op === "||=" || op === "&&=" || op === "??=") {
        // 与 LogicalExpression 同口径：非 lit LHS 真值未知 → join，不可把
        // litValue===undefined 当 falsy（抽象 number/obj 会命中该分支）
        const lhs = evalNode(ae.left, env, phi, budget).value;
        const lv = litValue(lhs);
        const nullishLit = isNullishLitAbs(lhs);
        const definitelyNotNullish = definitelyNotNullishShape(lhs.shape) && !nullishLit;
        const falsy =
          lv === false ||
          nullishLit ||
          lv === null ||
          (lv === undefined &&
            lhs.term?.op === "lit" &&
            (lhs.term as { value?: unknown }).value === undefined);
        const truthy = lv !== undefined && !falsy && !nullishLit;
        let assignRhs: Abs | null = null;
        if (op === "||=") {
          if (truthy) return ok(lhs, phi, env);
          if (falsy || nullishLit) {
            assignRhs = evalNode(ae.right, env, phi, budget).value;
          }
        } else if (op === "&&=") {
          if (falsy) return ok(lhs, phi, env);
          if (truthy) {
            assignRhs = evalNode(ae.right, env, phi, budget).value;
          }
        } else {
          // ??=
          if (definitelyNotNullish || (lv !== undefined && lv !== null && !nullishLit)) {
            return ok(lhs, phi, env);
          }
          if (nullishLit || lv === null || (lv === undefined && lhs.term?.op === "lit")) {
            assignRhs = evalNode(ae.right, env, phi, budget).value;
          }
        }
        if (assignRhs === null) {
          // 抽象短路：可能写 RHS 也可能保持 LHS
          const r = evalNode(ae.right, env, phi, budget).value;
          rhs = joinAbs(lhs, r);
        } else {
          rhs = assignRhs;
        }
      } else if (op.endsWith("=")) {
        const binOp = op.slice(0, -1);
        const lhs = evalNode(ae.left, env, phi, budget).value;
        const rhsVal = evalNode(ae.right, env, phi, budget).value;
        rhs = applyBin(binOp, lhs, rhsVal);
      } else {
        return ok(unknown, phi, env);
      }
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
      // obj.field = v → 更新 env 中根绑定（与 B-path $set 重绑同口径）
      if (ae.left.type === "MemberExpression") {
        const m = ae.left as unknown as {
          object: Node;
          property: Node;
          computed?: boolean;
        };
        // any/nullish 接收者上的成员写 → may-throw（design §3.3）
        {
          const recv = evalNode(m.object, env, phi, budget).value;
          const key =
            !m.computed && m.property.type === "Identifier"
              ? (m.property as Identifier).name
              : m.property.type === "StringLiteral"
                ? (m.property as StringLiteral).value
                : m.computed
                  ? "[computed]"
                  : undefined;
          if (key !== undefined) {
            const loc = node.loc
              ? ([node.loc.start.line, node.loc.start.column] as [number, number])
              : undefined;
            noteNullishMemberThrows(recv, key, "property", loc);
            noteAnyMemberMayThrow(recv, key, "property", loc);
          }
        }
        if (m.object.type === "Identifier") {
          const root = (m.object as Identifier).name;
          const prev = env.vars.get(root);
          const key = !m.computed
            ? m.property.type === "Identifier"
              ? (m.property as Identifier).name
              : m.property.type === "StringLiteral"
                ? (m.property as StringLiteral).value
                : undefined
            : undefined;
          if (prev && key && prev.shape.k === "obj") {
            const slots = { ...(prev.shape as { slots: Record<string, { value: Abs }> }).slots };
            slots[key] = { value: rhs };
            const updated = abs(
              { k: "obj", slots } as never,
              undefined,
              undefined,
              prev.conf === "exact" ? "path" : prev.conf,
            );
            return { value: rhs, phi, env: withVar(env, root, updated) };
          }
        }
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
      const loc = node.loc
        ? { line: node.loc.start.line, column: node.loc.start.column }
        : undefined;
      return { value: v, phi, env, threw: true, ...(loc ? { throwLoc: loc } : {}) };
    }
    case "ConditionalExpression": {
      const cond = node as unknown as { test: Node; consequent: Node; alternate: Node };
      const t = evalNode(cond.test, env, phi, budget).value;
      const tv = litValue(t);
      if (tv === true) return evalNode(cond.consequent, env, phi, budget);
      if (tv === false) return evalNode(cond.alternate, env, phi, budget);
      const a = evalNode(cond.consequent, env, phi, budget);
      const b = evalNode(cond.alternate, env, phi, budget);
      return { value: joinAbs(a.value, b.value), phi, env: joinEnvs(a.env, b.env, env) };
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
    case "SwitchStatement":
      return evalSwitch(node as SwitchStatement, env, phi, budget);
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
      if (u.operator === "+") return ok(toNumberAbs(a), phi, env);
      if (u.operator === "~") return ok(bitnotAbs(a), phi, env);
      return ok(unknown, phi, env);
    }
    case "LogicalExpression": {
      const le = node as { operator: string; left: Node; right: Node };
      const l = evalNode(le.left, env, phi, budget);
      const lv = litValue(l.value);
      const nullishLit = isNullishLitAbs(l.value);
      const definitelyNotNullish =
        definitelyNotNullishShape(l.value.shape) && !nullishLit;
      const falsy = lv === false || nullishLit || (lv === undefined && l.value.term?.op === "lit" && (l.value.term as { value?: unknown }).value === undefined) || lv === null;
      const truthy = lv !== undefined && !falsy && !nullishLit;
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
      if (le.operator === "??") {
        if (nullishLit || lv === null) return evalNode(le.right, env, phi, budget);
        if (definitelyNotNullish || (lv !== undefined && lv !== null)) {
          return ok(l.value, phi, env);
        }
        // 抽象：可能走左也可能走右
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
      // any / nullish / unknown 成员读（design-cli-semantics §3.3）
      // computed 与静态属性统一记 may-throw
      const propNameForThrows = m.computed
        ? (() => {
            const k = evalNode(m.property, env, phi, budget).value;
            const kl = litValue(k);
            return typeof kl === "string" ? kl : "[computed]";
          })()
        : m.property.type === "Identifier"
          ? (m.property as Identifier).name
          : m.property.type === "StringLiteral" || m.property.type === "NumericLiteral"
            ? String((m.property as { value?: unknown }).value)
            : undefined;
      if (propNameForThrows !== undefined) {
        const loc = node.loc
          ? ([node.loc.start.line, node.loc.start.column] as [number, number])
          : undefined;
        // nullish → may-throw TypeError；结果是 never（操作未产生值），不是 unknown
        if (noteNullishMemberThrows(obj, propNameForThrows, "property", loc)) {
          return ok(abs({ k: "never" }, undefined, undefined, "exact"), phi, env);
        }
        // any（无约束）→ 记 may-throw，结果保持 any（不是 unknown）
        if (noteAnyMemberMayThrow(obj, propNameForThrows, "property", loc)) {
          return ok(anyMemberResult(), phi, env);
        }
        // unknown（推导失败）→ unknown-recv 引擎债
        noteUnknownMemberMissing(obj, propNameForThrows, "property", loc);
      }
      return ok(unknown, phi, env);
    }
    case "ObjectExpression": {
      const o = node as {
        properties: Array<
          | { type: "ObjectProperty"; key?: Node; value?: Node }
          | { type: "ObjectMethod"; key?: Node; params?: Node[]; body?: Node }
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
        // C3.2：对象方法简写 → fn Abs（body 求值；闭包经 env 捕获）
        if ((p as { type: string }).type === "ObjectMethod") {
          const om = p as { key?: Node; params?: Node[]; body?: Node };
          const keyNode = om.key;
          let key: string | undefined;
          if (keyNode && keyNode.type === "Identifier") key = (keyNode as Identifier).name;
          if (keyNode && keyNode.type === "StringLiteral") key = (keyNode as StringLiteral).value;
          if (!key || !om.body) continue;
          const paramNames = (om.params ?? []).map((pp, i) =>
            pp.type === "Identifier" ? (pp as Identifier).name : `_a${i}`,
          );
          const methodBody = om.body;
          const fnAbs = absFunction(paramNames, {
            body: methodBody as never,
            apply: (args: Abs[]) => {
              let e2 = env;
              for (let i = 0; i < paramNames.length; i++) {
                e2 = withVar(e2, paramNames[i]!, args[i] ?? unknown);
              }
              const r = evalNode(methodBody, e2, phi, budget);
              return r.value;
            },
          });
          pending[key] = { value: fnAbs };
          continue;
        }
        if ((p as { type?: string }).type !== "ObjectProperty") continue;
        const op = p as { key?: Node; value?: Node };
        const keyNode = op.key;
        let key: string | undefined;
        if (keyNode && keyNode.type === "Identifier") key = (keyNode as Identifier).name;
        if (keyNode && keyNode.type === "StringLiteral") key = (keyNode as StringLiteral).value;
        if (!key || !op.value) continue;
        pending[key] = { value: evalNode(op.value, env, phi, budget).value };
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
    case "==": {
      const eq = looseEqAbs(l, r);
      if (eq !== undefined) return ok(boolLit(eq), phi, env);
      return ok(unknown, phi, env);
    }
    case "!=": {
      const eq = looseEqAbs(l, r);
      if (eq !== undefined) return ok(boolLit(!eq), phi, env);
      return ok(unknown, phi, env);
    }
    case "/":
      return ok(leakIfNeeded(div(l, r, phi), budget, "div"), phi, env);
    case "%":
      return ok(leakIfNeeded(mod(l, r, phi), budget, "mod"), phi, env);
    case "&":
      return ok(bitandAbs(l, r), phi, env);
    case "|":
      return ok(bitorAbs(l, r), phi, env);
    case "^":
      return ok(bitxorAbs(l, r), phi, env);
    case "<<":
      return ok(shlAbs(l, r), phi, env);
    case ">>":
      return ok(shrAbs(l, r), phi, env);
    case ">>>":
      return ok(ushrAbs(l, r), phi, env);
    case "**":
      return ok(powAbs(l, r), phi, env);
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
            const inner = applyUnaryCallback(fnNode, obj.shape.inner, undefAbs(), env, phi, budget);
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
            case "endsWith":
            case "includes": {
              // 可选位置参数与 methods.ts 同口径：number 字面量/缺省 → 原生折叠；
              // 非字面量位置 → 落抽象 boolean 分支
              if (typeof a0 === "string") {
                const a1Abs = rawArgs[1]
                  ? evalNode(rawArgs[1], env, phi, budget).value
                  : undefined;
                const a1 = a1Abs ? litValue(a1Abs) : undefined;
                if (a1Abs === undefined || a1Abs.term?.op === "lit") {
                  return ok(
                    boolLit(sv[method](a0, a1 as number | undefined) as boolean),
                    phi,
                    env,
                  );
                }
              }
              break;
            }
            case "charAt":
              if (typeof a0 === "number") return ok(strLit(sv.charAt(a0)), phi, env);
              break;
            case "slice": {
              // 与 methods.ts 同口径：位置参数 number 字面量/缺省才折叠，
              // Symbol/抽象实参原生 THROW → 保守 strPrim
              const numOrMissing = (x: Abs | undefined): boolean =>
                x === undefined ||
                (x.term?.op === "lit" && (x.term.value === undefined || typeof x.term.value === "number"));
              if (!numOrMissing(arg0) || !numOrMissing(rawArgs[1] ? evalNode(rawArgs[1], env, phi, budget).value : undefined)) {
                return ok(abs({ k: "prim", type: "string" }, undefined, undefined, "path"), phi, env);
              }
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
              // 与 methods.ts 同口径：全字面量且非 Symbol 才折叠
              const restAbs = rawArgs.map((a) => evalNode(a, env, phi, budget).value);
              if (restAbs.some((r) => r.term?.op !== "lit" || typeof r.term.value === "symbol")) {
                return ok(abs({ k: "prim", type: "string" }, undefined, undefined, "path"), phi, env);
              }
              const rest = restAbs.map((r) => String(litValue(r)));
              return ok(strLit(sv + rest.join("")), phi, env);
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

      // 数组回调方法公共口径（与 exec/class invokeArrMethod 同轨）：
      // hole 跳过 + 索引实参 + some/every/find/findIndex 短路。
      const arrHoles = obj.shape.k === "tuple" ? ((obj.shape as { holes?: number[] }).holes ?? []) : [];
      const isArrHole = (i: number): boolean => arrHoles.includes(i);
      const unknownIdx = (): Abs =>
        abs({ k: "prim", type: "number" }, undefined, undefined, "path");
      const cbTruth = (r: Abs): boolean | undefined => {
        if (r.term?.op !== "lit") return undefined;
        const v = litValue(r);
        if (v === undefined || v === null || v === false || v === "" || (v as unknown) === 0n) return false;
        if (typeof v === "number" && (v === 0 || Number.isNaN(v))) return false;
        return true;
      };

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
        // tuple：逐元素 map，保精确；hole 跳过且输出保留 hole 位置
        if (obj.shape.k === "tuple") {
          const mapped = obj.shape.elements.map((el, i) =>
            isArrHole(i) ? el : applyUnaryCallback(fnNode, el, numLit(i), env, phi, budget),
          );
          return ok(
            abs(
              {
                k: "tuple",
                elements: mapped,
                holes: arrHoles.length > 0 ? [...arrHoles] : undefined,
              },
              undefined,
              undefined,
              confJoin(obj.conf, "path"),
            ),
            phi,
            env,
          );
        }
        const elem =
          obj.shape.k === "arr"
            ? (obj.shape as { element: Abs }).element
            : unknown;
        const out0 = applyUnaryCallback(fnNode, elem, unknownIdx(), env, phi, budget);
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
          for (let i = 0; i < obj.shape.elements.length; i++) {
            if (isArrHole(i)) continue;
            acc = applyBinaryCallback(fnNode, acc, obj.shape.elements[i]!, numLit(i), env, phi, budget);
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
          const next = applyBinaryCallback(fnNode, acc, item, unknownIdx(), env, phi, budget);
          if (absIdentical(acc, next)) {
            return ok(next, phi, env);
          }
          acc = joinAbs(acc, next);
        }
        return ok(acc, phi, env);
      }

      if (method === "reduceRight" && rawArgs.length >= 2) {
        const fnNode = rawArgs[0]!;
        let acc = evalNode(rawArgs[1]!, env, phi, budget).value;
        if (obj.shape.k === "tuple") {
          for (let i = obj.shape.elements.length - 1; i >= 0; i--) {
            if (isArrHole(i)) continue;
            acc = applyBinaryCallback(fnNode, acc, obj.shape.elements[i]!, numLit(i), env, phi, budget);
          }
          return ok(acc, phi, env);
        }
        const item =
          obj.shape.k === "arr"
            ? (obj.shape as { element: Abs }).element
            : unknown;
        const next = applyBinaryCallback(fnNode, acc, item, unknownIdx(), env, phi, budget);
        return ok(next, phi, env);
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
          let anyUncertain = false;
          obj.shape.elements.forEach((el, i) => {
            if (isArrHole(i)) return; // hole 跳过谓词且不进结果
            const t = cbTruth(applyUnaryCallback(fnNode, el, numLit(i), env, phi, budget));
            if (t === false) return;
            if (t === undefined) anyUncertain = true;
            kept.push(el);
          });
          if (kept.length === 0) {
            return ok(abs({ k: "arr", element: unknown }, undefined, undefined, "path"), phi, env);
          }
          // 剩余元素谓词恒 true → 精确子序列，保留 tuple 字面量精度。
          // 任一谓词不确定（random/符号）→ 降为 arr：长度是上界不是精确值。
          if (!anyUncertain) {
            return ok(
              abs({ k: "tuple", elements: kept }, undefined, undefined, confJoin(obj.conf, "path")),
              phi,
              env,
            );
          }
          const el = kept.reduce((a, b) => joinAbs(a, b));
          return ok(
            abs({ k: "arr", element: el }, undefined, undefined, confJoin(obj.conf, "path")),
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
          const mapped = obj.shape.elements.map((el, i) =>
            isArrHole(i)
              ? abs({ k: "tuple", elements: [] }, undefined, undefined, "exact")
              : applyUnaryCallback(fnNode, el, numLit(i), env, phi, budget),
          );
          return ok(projectFlatMapResult(obj.conf, mapped), phi, env);
        }
        const elem =
          obj.shape.k === "arr"
            ? (obj.shape as { element: Abs }).element
            : unknown;
        const out = applyUnaryCallback(fnNode, elem, unknownIdx(), env, phi, budget);
        return ok(projectFlatMapResult(obj.conf, [out]), phi, env);
      }

      if (method === "forEach" && rawArgs.length >= 1) {
        const fnNode = rawArgs[0]!;
        if (obj.shape.k === "tuple") {
          obj.shape.elements.forEach((el, i) => {
            if (!isArrHole(i)) applyUnaryCallback(fnNode, el, numLit(i), env, phi, budget);
          });
        } else if (obj.shape.k === "arr") {
          applyUnaryCallback(
            fnNode,
            (obj.shape as { element: Abs }).element,
            unknownIdx(),
            env,
            phi,
            budget,
          );
        }
        return ok(undefAbs(), phi, env);
      }

      if ((method === "some" || method === "every") && rawArgs.length >= 1) {
        // 规范 some/every 检查 HasProperty：hole 位置跳过回调（与 find/findIndex 相反）
        const fnNode = rawArgs[0]!;
        let undecided = false;
        if (obj.shape.k === "tuple") {
          for (let i = 0; i < obj.shape.elements.length; i++) {
            if (isArrHole(i)) continue;
            const t = cbTruth(applyUnaryCallback(fnNode, obj.shape.elements[i]!, numLit(i), env, phi, budget));
            if (t === undefined) {
              undecided = true;
              continue;
            }
            if (method === "some" && t) return ok(boolLit(true), phi, env);
            if (method === "every" && !t) return ok(boolLit(false), phi, env);
          }
        } else if (obj.shape.k === "arr") {
          const t = cbTruth(
            applyUnaryCallback(fnNode, (obj.shape as { element: Abs }).element, unknownIdx(), env, phi, budget),
          );
          // 抽象 arr 长度未知（可能空）：单代表元素无法下结论
          if (t === undefined) return ok(bool(), phi, env);
          if (method === "some" && t) return ok(boolLit(true), phi, env);
          if (method === "every" && !t) return ok(boolLit(false), phi, env);
          return ok(bool(), phi, env);
        }
        if (undecided) return ok(bool(), phi, env);
        return ok(boolLit(method === "some" ? false : true), phi, env);
      }

      if (method === "find" && rawArgs.length >= 1) {
        // 逐位短路：具体 truthy 命中即返回该元素（原生首个命中）；
        // 全 falsy → undefined；有不确定 → 元素 ∪ undefined
        const fnNode = rawArgs[0]!;
        if (obj.shape.k === "tuple") {
          let undecided = false;
          for (let i = 0; i < obj.shape.elements.length; i++) {
            const el = obj.shape.elements[i]!;
            const t = cbTruth(applyUnaryCallback(fnNode, el, numLit(i), env, phi, budget));
            if (t === true) return ok(el, phi, env);
            if (t === undefined) undecided = true;
          }
          if (undecided) {
            const joined = obj.shape.elements.reduce((a, b) => joinAbs(a, b));
            return ok(joinAbs(joined, undefAbs()), phi, env);
          }
          return ok(undefAbs(), phi, env);
        }
        const elem =
          obj.shape.k === "arr"
            ? (obj.shape as { element: Abs }).element
            : unknown;
        const t = cbTruth(applyUnaryCallback(fnNode, elem, unknownIdx(), env, phi, budget));
        if (t === true) return ok(elem, phi, env);
        if (t === false) return ok(undefAbs(), phi, env);
        return ok(joinAbs(elem, undefAbs()), phi, env);
      }

      if (method === "findIndex" && rawArgs.length >= 1) {
        // 逐位短路：命中 → 具体索引；全 falsy → -1（原生语义）；不确定 → number ∪ -1
        const fnNode = rawArgs[0]!;
        if (obj.shape.k === "tuple") {
          let undecided = false;
          for (let i = 0; i < obj.shape.elements.length; i++) {
            const t = cbTruth(applyUnaryCallback(fnNode, obj.shape.elements[i]!, numLit(i), env, phi, budget));
            if (t === true) return ok(numLit(i), phi, env);
            if (t === undefined) undecided = true;
          }
          if (undecided) return ok(joinAbs(unknownIdx(), numLit(-1)), phi, env);
          return ok(numLit(-1), phi, env);
        }
        const elem =
          obj.shape.k === "arr"
            ? (obj.shape as { element: Abs }).element
            : unknown;
        const t = cbTruth(applyUnaryCallback(fnNode, elem, unknownIdx(), env, phi, budget));
        if (t === true) return ok(unknownIdx(), phi, env);
        if (t === false) return ok(numLit(-1), phi, env);
        return ok(joinAbs(unknownIdx(), numLit(-1)), phi, env);
      }
      // 分派失败：prim/any/nullish/unknown 记账（design-cli-semantics §3.3）
      {
        const loc = node.loc
          ? ([node.loc.start.line, node.loc.start.column] as [number, number])
          : undefined;
        if (noteNullishMemberThrows(obj, method, "method", loc)) {
          return ok(unknown, phi, env);
        }
        if (noteAnyMemberMayThrow(obj, method, "method", loc)) {
          return ok(anyMemberResult(), phi, env);
        }
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
  thisVal?: Abs,
): Abs {
  // 函数 union：对每个 member 按统一顺序求值后 join
  if (fnVal?.shape?.k === "sum") {
    const results = fnVal.shape.members.map((m) =>
      applyAbsFn(m, args, env, phi, budget, thisVal),
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
    // B 路径 $fnVal / 泄漏 JS 函数的 apply 可能抛 NudoReturn — 调用边界收成返回值
    if (impl!.apply) {
      try {
        return impl!.apply(args, thisVal);
      } catch (e) {
        if (e && typeof e === "object" && (e as { name?: string }).name === "NudoReturn") {
          return (e as { absValue: Abs }).absValue;
        }
        throw e;
      }
    }
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
  idxAbs: Abs = undefAbs(),
  env?: AstEnv,
  phi?: Phi,
  budget?: LeakBudget,
): Abs {
  return applyCallbackAbs(fnNode, [arg, idxAbs], env, phi, budget);
}

function applyBinaryCallback(
  fnNode: Node,
  a: Abs,
  b: Abs,
  idxAbs: Abs = undefAbs(),
  env?: AstEnv,
  phi?: Phi,
  budget?: LeakBudget,
): Abs {
  return applyCallbackAbs(fnNode, [a, b, idxAbs], env, phi, budget);
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
      return {
        value: last,
        phi: curPhi,
        env: local,
        returned: r.returned,
        brk: r.brk,
        cont: r.cont,
        threw: r.threw,
        ...(r.throwLoc ? { throwLoc: r.throwLoc } : {}),
      };
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
  const entry = local;
  let acc: Abs = unknown;
  let exitEnv: AstEnv | undefined;
  let sawAbstractTest = false;
  for (let i = 0; i < MAX_LOOP_ITERS; i++) {
    if (node.test) {
      const t = evalNode(node.test, local, phi, budget);
      const lv = litValue(t.value);
      if (lv === false || lv === null || lv === undefined) {
        exitEnv = exitEnv ? joinEnvs(exitEnv, local, entry) : local;
        break;
      }
      if (lv !== true) {
        sawAbstractTest = true;
        exitEnv = exitEnv ? joinEnvs(exitEnv, local, entry) : local;
      }
    }
    const bodyR = evalInConditionalFlow(() => evalNode(node.body, local, phi, budget));
    if (bodyR.returned) return bodyR;
    if (bodyR.threw) return bodyR;
    if (bodyR.brk) {
      local = bodyR.env;
      exitEnv = exitEnv ? joinEnvs(exitEnv, local, entry) : local;
      break;
    }
    local = bodyR.env;
    acc = joinAbs(acc, bodyR.value);
    if (node.update) {
      const u = evalNode(node.update, local, phi, budget);
      local = u.env;
    }
  }
  if (sawAbstractTest) {
    exitEnv = exitEnv ? joinEnvs(exitEnv, local, entry) : local;
  }
  return ok(acc, phi, exitEnv ?? local);
}

function evalWhile(
  node: WhileStatement,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  let local = env;
  const entry = local;
  let acc: Abs = unknown;
  let exitEnv: AstEnv | undefined;
  let sawAbstractTest = false;
  for (let i = 0; i < MAX_LOOP_ITERS; i++) {
    const t = evalNode(node.test, local, phi, budget);
    const lv = litValue(t.value);
    if (lv === false || lv === null || lv === undefined) {
      exitEnv = exitEnv ? joinEnvs(exitEnv, local, entry) : local;
      break;
    }
    if (lv !== true) {
      sawAbstractTest = true;
      exitEnv = exitEnv ? joinEnvs(exitEnv, local, entry) : local;
    }
    const bodyR = evalInConditionalFlow(() => evalNode(node.body, local, phi, budget));
    if (bodyR.returned || bodyR.threw) return bodyR;
    if (bodyR.brk) {
      local = bodyR.env;
      exitEnv = exitEnv ? joinEnvs(exitEnv, local, entry) : local;
      break;
    }
    local = bodyR.env;
    acc = joinAbs(acc, bodyR.value);
  }
  if (sawAbstractTest) {
    exitEnv = exitEnv ? joinEnvs(exitEnv, local, entry) : local;
  }
  return ok(acc, phi, exitEnv ?? local);
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
  // any/nullish 迭代协议 → may-throw TypeError（design §3.3）
  {
    const loc = node.right.loc
      ? ([node.right.loc.start.line, node.right.loc.start.column] as [number, number])
      : undefined;
    if (noteNullishMemberThrows(iterVal, "Symbol.iterator", "method", loc)) {
      // 无值可迭代
    } else if (noteAnyMemberMayThrow(iterVal, "Symbol.iterator", "method", loc)) {
      // 仍继续按 any 元素分发
    }
  }
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
  const shape = iterVal.shape;
  const isTuple = shape.k === "tuple";
  const isArr = shape.k === "arr";
  let elements: Abs[] = [];
  if (isArr) {
    elements = [shape.element];
  } else if (isTuple) {
    elements = [...shape.elements];
  } else if (shape.k === "sum") {
    elements = shape.members.flatMap((m) =>
      m.shape.k === "arr"
        ? [m.shape.element]
        : m.shape.k === "tuple"
          ? [...m.shape.elements]
          : [],
    );
  } else {
    elements = [unknown];
  }

  const left = node.left;
  const bindName =
    left.type === "Identifier"
      ? (left as Identifier).name
      : left.type === "VariableDeclaration"
        ? ((left as VariableDeclaration).declarations[0]?.id as Identifier | undefined)?.name
        : undefined;
  if (!bindName) return ok(unknown, phi, env);

  // 具体空 tuple：体 0 次（不得发明 unknown 元素再跑一次）
  if (isTuple && elements.length === 0) {
    return ok(unknown, phi, env);
  }

  // 非具体 tuple（arr / unknown / any / sum）：0..MAX 出口 env join（含 0 次）
  const unbounded = !isTuple;
  if (unbounded) {
    let cur = env;
    let joinedEnv = env;
    let joinedVal: Abs = unknown;
    const el = elements.length > 0 ? elements[0]! : unknown;
    const n = elements.length > 0 || isArr || shape.k === "sum" ? MAX_LOOP_ITERS : 0;
    for (let i = 0; i < n; i++) {
      cur = withVar(cur, bindName, el);
      const bodyR = evalInConditionalFlow(() => evalNode(node.body, cur, phi, budget));
      if (bodyR.returned || bodyR.threw) return bodyR;
      if (bodyR.brk) {
        cur = bodyR.env;
        joinedEnv = joinEnvs(joinedEnv, cur, env);
        break;
      }
      cur = bodyR.env;
      joinedEnv = joinEnvs(joinedEnv, cur, env);
      joinedVal = joinAbs(joinedVal, bodyR.value);
    }
    joinedEnv = joinEnvs(joinedEnv, cur, env);
    return ok(joinedVal, phi, joinedEnv);
  }

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
  // soft may-throw：先取帧，再按 catch 是否 rethrow 决定消化/上浮（design §3.3）
  pushMayThrowFrame();
  const tryR = evalNode(node.block, env, phi, budget);
  const softEffects = popMayThrowFrame(false);
  let softDigested = false;
  let value = tryR.value;
  let local = tryR.env;
  let curPhi = tryR.phi;

  const catchParam =
    node.handler?.param && node.handler.param.type === "Identifier"
      ? (node.handler.param as Identifier).name
      : undefined;

  const runCatch = (baseEnv: AstEnv, basePhi: Phi, bindAbs: Abs): EvalResult =>
    evalNode(
      node.handler!.body,
      catchParam ? withVar(baseEnv, catchParam, bindAbs) : baseEnv,
      basePhi,
      budget,
    );

  // soft 路径：运行时可能进 catch（any/nullish 危险操作），须观察 catch 是否 rethrow
  if (node.handler && softEffects.length > 0 && !tryR.threw && !tryR.partialThrow && !tryR.returned) {
    const catchR = runCatch(env, phi, tryR.value);
    if (catchR.threw) {
      // catch rethrow：soft 不消化，上浮；并携带 catch 的 hard throw
      orphanMayThrowEffects(softEffects);
      if (node.finalizer) evalNode(node.finalizer, catchR.env, catchR.phi, budget);
      return { value: catchR.value, phi: catchR.phi, env: catchR.env, threw: true };
    }
    softDigested = true;
    value = joinAbs(tryR.value, catchR.value);
    local = joinEnvs(tryR.env, catchR.env, env);
    curPhi = catchR.phi;
  } else if (tryR.threw && node.handler) {
    const catchR = runCatch(local, curPhi, tryR.value);
    value = catchR.value;
    local = catchR.env;
    curPhi = catchR.phi;
    if (catchR.returned) {
      if (node.finalizer) evalNode(node.finalizer, local, curPhi, budget);
      softDigested = true;
      return { ...catchR, env: local };
    }
    if (catchR.threw) {
      // catch rethrow：保留 try soft + catch hard
      orphanMayThrowEffects(softEffects);
      if (node.finalizer) evalNode(node.finalizer, local, curPhi, budget);
      return { value: catchR.value, phi: curPhi, env: local, threw: true };
    }
    softDigested = true;
  } else if (tryR.partialThrow && node.handler) {
    const catchR = runCatch(env, phi, tryR.throwValue ?? tryR.value);
    value = joinAbs(tryR.value, catchR.value);
    local = joinEnvs(tryR.env, catchR.env, env);
    curPhi = catchR.phi;
    if (catchR.returned && tryR.returned) {
      softDigested = true;
      return { value, phi: curPhi, env: local, returned: true };
    }
    if (catchR.threw && tryR.threw) {
      orphanMayThrowEffects(softEffects);
      return { value, phi: curPhi, env: local, threw: true };
    }
    if (catchR.threw) {
      orphanMayThrowEffects(softEffects);
      return { value: catchR.value, phi: curPhi, env: local, threw: true };
    }
    softDigested = true;
  } else if (tryR.returned) {
    // try 内 return 仍可能在运行时因 soft may-throw 进入 catch
    if (node.handler && softEffects.length > 0) {
      const catchR = runCatch(env, phi, tryR.value);
      if (catchR.threw) {
        orphanMayThrowEffects(softEffects);
        if (node.finalizer) evalNode(node.finalizer, tryR.env, tryR.phi, budget);
        return { ...tryR, threw: true, partialThrow: true, throwValue: catchR.value };
      }
      softDigested = true;
    } else {
      softDigested = !!node.handler;
    }
    if (node.finalizer) evalNode(node.finalizer, local, curPhi, budget);
    if (!softDigested) orphanMayThrowEffects(softEffects);
    return tryR;
  } else if (tryR.threw && !node.handler) {
    if (node.finalizer) evalNode(node.finalizer, local, curPhi, budget);
    orphanMayThrowEffects(softEffects);
    return tryR;
  }

  if (node.finalizer) {
    const fR = evalNode(node.finalizer, local, curPhi, budget);
    if (fR.returned || fR.threw) {
      if (!softDigested) orphanMayThrowEffects(softEffects);
      return fR;
    }
    local = fR.env;
  }
  if (!softDigested) orphanMayThrowEffects(softEffects);
  return {
    value,
    phi: curPhi,
    env: local,
    returned: tryR.returned,
    ...(tryR.partialReturn || tryR.partialThrow ? { partialReturn: tryR.partialReturn } : {}),
  };
}

function evalVarDecl(
  node: VariableDeclaration,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  let local = env;
  for (const d of node.declarations) {
    if (!d.init) continue;
    const r = evalNode(d.init, local, phi, budget);
    if (d.id.type === "Identifier") {
      // Hover/inlay on the binding name must see the init Abs, not the
      // statement's `unknown` (which would otherwise win via loc overlap).
      recordAbsNode(d.id, r.value);
      local = withVar(local, d.id.name, r.value);
      continue;
    }
    // 解构：any/nullish 接收者上的属性读 → may-throw（design §3.3）
    if (d.id.type === "ObjectPattern") {
      const loc = d.init.loc
        ? ([d.init.loc.start.line, d.init.loc.start.column] as [number, number])
        : undefined;
      const props = (d.id as { properties?: Array<{ key?: Node; value?: Node }> }).properties ?? [];
      for (const p of props) {
        const key = p.key;
        const propName =
          key?.type === "Identifier"
            ? (key as Identifier).name
            : key && (key.type === "StringLiteral" || key.type === "NumericLiteral")
              ? String((key as { value?: unknown }).value)
              : "[destructure]";
        if (noteNullishMemberThrows(r.value, propName, "property", loc)) continue;
        if (noteAnyMemberMayThrow(r.value, propName, "property", loc)) {
          // 绑定保持 any（JS 读到的值仍无约束）
          if (p.value?.type === "Identifier") {
            local = withVar(local, (p.value as Identifier).name, anyMemberResult());
          }
          continue;
        }
        const slot =
          r.value.shape.k === "obj"
            ? getSlot((r.value.shape as { slots: Record<string, { value: Abs }> }).slots, propName)
            : undefined;
        const bound = slot?.value ?? (r.value.shape.k === "any" ? anyMemberResult() : unknown);
        if (p.value?.type === "Identifier") {
          local = withVar(local, (p.value as Identifier).name, bound);
        }
      }
    }
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
    const bothRet = !!a.returned && !!b.returned;
    const eitherRet = !!a.returned || !!b.returned;
    // continue-path 绑定：仅 join 到达 if 之后的臂；early-return 臂的写
    // 不得污染 continue env（sound for may-continue，更精确）。
    const contEnv =
      a.returned && !b.returned
        ? b.env
        : b.returned && !a.returned
          ? a.env
          : a.threw && !b.threw
            ? b.env
            : b.threw && !a.threw
              ? a.env
              : joinEnvs(a.env, b.env, env);
    return {
      value: joinAbs(a.value, b.value),
      phi,
      env: contEnv,
      ...(bothRet ? { returned: true } : eitherRet ? { partialReturn: true } : {}),
      ...((a.threw && b.threw) ? { threw: true, throwValue: joinAbs(a.value, b.value) } : {}),
      ...((a.threw || b.threw) && !(a.threw && b.threw)
        ? { partialThrow: true, throwValue: a.threw ? a.value : b.value }
        : {}),
    };
  }
  // if 无 else：真分支退出时假分支 fall-through（base env）；两侧都继续则 join
  if (a.returned && a.threw) {
    return { value: a.value, phi, env, partialReturn: true };
  }
  if (a.returned || a.threw) {
    return {
      value: a.value,
      phi,
      env,
      ...(a.returned ? { partialReturn: true } : {}),
      ...(a.threw ? { partialThrow: true, throwValue: a.value } : {}),
    };
  }
  return { value: unknown, phi, env: joinEnvs(a.env, env, env) };
}

function evalSwitch(
  node: SwitchStatement,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): EvalResult {
  type NormArm = { tests: Array<Node | null>; body: Statement[]; isDefault: boolean };
  const stmtCompletes = (s: Statement | undefined | null): boolean => {
    if (!s) return false;
    switch (s.type) {
      case "BreakStatement":
      case "ReturnStatement":
      case "ThrowStatement":
      case "ContinueStatement":
        return true;
      case "BlockStatement":
        return stmtCompletes((s as BlockStatement).body[(s as BlockStatement).body.length - 1] as Statement);
      case "IfStatement": {
        const ifs = s as IfStatement;
        return (
          ifs.alternate != null &&
          stmtCompletes(ifs.consequent as Statement) &&
          stmtCompletes(ifs.alternate as Statement)
        );
      }
      default:
        return false;
    }
  };

  const pre: NormArm[] = [];
  let pending: Array<Node | null> = [];
  for (const c of node.cases) {
    if (c.test == null) {
      if (pending.length > 0 && c.consequent.length > 0) {
        pre.push({ tests: pending, body: [...c.consequent], isDefault: false });
        pending = [];
      }
      pre.push({ tests: [], body: [...c.consequent], isDefault: true });
      continue;
    }
    if (c.consequent.length === 0) {
      pending.push(c.test);
      continue;
    }
    pre.push({ tests: [...pending, c.test], body: [...c.consequent], isDefault: false });
    pending = [];
  }
  if (pending.length > 0) pre.push({ tests: pending, body: [], isDefault: false });

  const arms: NormArm[] = pre.map((a) => ({ ...a, tests: [...a.tests], body: [...a.body] }));
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i]!;
    const body = [...arm.body];
    let j = i + 1;
    while (j < arms.length && !stmtCompletes(body[body.length - 1] as Statement)) {
      body.push(...arms[j]!.body);
      if (stmtCompletes(body[body.length - 1] as Statement)) break;
      j++;
    }
    arm.body = body;
  }

  const runBody = (body: Statement[], e: AstEnv): EvalResult => {
    let local = e;
    let value: Abs = unknown;
    for (const s of body) {
      const r = evalInConditionalFlow(() => evalNode(s, local, phi, budget));
      local = r.env;
      value = r.value;
      if (r.returned || r.threw || r.brk) return { ...r, env: local, value };
    }
    return { value, phi, env: local };
  };

  const disc = evalNode(node.discriminant, env, phi, budget).value;
  const dlv = litValue(disc);
  const hasDefault = arms.some((a) => a.isDefault);

  const testLit = (t: Node | null): unknown => {
    if (t == null) return null;
    return litValue(evalNode(t, env, phi, budget).value);
  };

  if (dlv !== undefined) {
    let matched: NormArm | null | undefined = null;
    let sawAbstractTest = false;
    for (const arm of arms) {
      if (arm.isDefault) continue;
      let hit = false;
      for (const t of arm.tests) {
        const tv = testLit(t);
        if (tv === null) continue;
        if (tv === undefined) {
          sawAbstractTest = true;
          continue;
        }
        if (tv === dlv) {
          hit = true;
          break;
        }
      }
      if (hit) {
        matched = arm;
        break;
      }
    }
    if (!sawAbstractTest) {
      if (matched) return runBody(matched.body, env);
      const dflt = arms.find((a) => a.isDefault);
      if (dflt) return runBody(dflt.body, env);
      return ok(unknown, phi, env);
    }
  }

  // 抽象 disc / 抽象 case 测试：并所有臂 +（无 default 时）no-match
  const results: EvalResult[] = [];
  if (!hasDefault) results.push(ok(unknown, phi, env));
  for (const arm of arms) {
    if (arm.body.length === 0 && !arm.isDefault) continue;
    results.push(runBody(arm.body, env));
  }
  if (results.length === 0) return ok(unknown, phi, env);
  let value = results[0]!.value;
  let envOut = results[0]!.env;
  let allRet = !!results[0]!.returned;
  let anyRet = !!results[0]!.returned;
  let anyThrew = !!results[0]!.threw;
  for (let i = 1; i < results.length; i++) {
    const r = results[i]!;
    value = joinAbs(value, r.value);
    envOut = joinEnvs(envOut, r.env, env);
    allRet = allRet && !!r.returned;
    anyRet = anyRet || !!r.returned;
    anyThrew = anyThrew || !!r.threw;
  }
  return {
    value,
    phi,
    env: envOut,
    ...(allRet ? { returned: true } : anyRet ? { partialReturn: true } : {}),
    ...(anyThrew ? { partialThrow: true } : {}),
  };
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
 * analyzeFn 的 throws/loc 感知版（T19/T20）：threw 时 result=never、throws=抛出值。
 * 供 case 兜底在 B-path 失败时仍可无损拿 throws+loc，不经 TypeValue evaluateFunctionFull。
 */
export function analyzeFnFull(
  source: string,
  fnName: string,
  args: Abs[],
  opts: EvalOptions = {},
): { result: Abs; throws: Abs; throwLoc?: { line: number; column: number } } {
  const r = evalSource(source, { fn: fnName, args }, opts);
  const neverAbs = abs({ k: "never" }, undefined, undefined, "exact");
  // evalSource 在 threw 时 value=never；真实 throws 域在 r.throws
  const throwsAbs = r.throws ?? (r.threw ? r.value : neverAbs);
  return {
    result: r.threw ? neverAbs : r.value,
    throws: throwsAbs,
    ...(r.throwLoc ? { throwLoc: r.throwLoc } : {}),
  };
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

  // 第一遍：函数与 class（与 evalSource / listTopFunctions 同一注册面）
  for (const stmt of file.program.body) {
    registerTopLevelCallable(env, stmt);
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
