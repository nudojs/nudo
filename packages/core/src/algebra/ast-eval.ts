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
  evalMathMethod,
  evalObjectMethod,
  evalJsonMethod,
  evalNumberStatic,
  evalGlobalFn,
  evalArrayStatic,
} from "./builtins.ts";
import {
  defineClass,
  getClass,
  classFromMethods,
  instantiateClass,
  instanceOf,
  projectBrand,
  lookupMethod,
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

  let local = emptyEnv();
  local.fns = env.fns;
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
): Abs {
  const local = emptyEnv();
  local.fns = env.fns;
  const cls = (env as AstEnv & { classes?: Map<string, unknown> }).classes;
  if (cls) (local as AstEnv & { classes?: Map<string, unknown> }).classes = cls;
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
}

// --- 节点求值 ---

export function evalNode(
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
        return { value: rhs, phi, env: withVar(env, (ae.left as Identifier).name, rhs) };
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
      // 小数组 → tuple 形态用 obj 模拟（Phase A 用 sum of elements as arr with join elem）
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
      const obj = evalNode(m.object, env, phi, budget).value;
      const rawArgs = node.arguments.filter(
        (a): a is Exclude<typeof a, { type: "SpreadElement" }> => a.type !== "SpreadElement",
      );

      // 全局命名空间 builtin（Math/Object/JSON/Number/Array）
      if (m.object.type === "Identifier") {
        const ns = (m.object as Identifier).name;
        const margs = rawArgs.map((a) => evalNode(a, env, phi, budget).value);
        let r: Abs | undefined;
        if (ns === "Math") r = evalMathMethod(method, margs);
        else if (ns === "Object") r = evalObjectMethod(method, margs);
        else if (ns === "JSON") r = evalJsonMethod(method, margs);
        else if (ns === "Number") r = evalNumberStatic(method, margs);
        else if (ns === "Array") r = evalArrayStatic(method, margs);
        if (r) return ok(r, phi, env);
      }

      if (obj.shape.k === "brand") {
        // brand 方法：在 this=receiver 下求值方法体（含继承链）
        const mdef = lookupMethod(env, obj, method);
        if (mdef && mdef.kind !== "constructor") {
          const margs = rawArgs.map((a) => evalNode(a, env, phi, budget).value);
          const ret = evalMethodBody(mdef, margs, obj, env, phi, budget);
          if (mdef.async) return ok(coerceAsyncReturn(ret), phi, env);
          return ok(ret, phi, env);
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
        const elem =
          obj.shape.k === "arr"
            ? (obj.shape as { element: Abs }).element
            : obj.shape.k === "tuple"
              ? (obj.shape as { elements: Abs[] }).elements.reduce((x, y) => joinAbs(x, y), unknown)
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
        const init = evalNode(rawArgs[1]!, env, phi, budget).value;
        const item =
          obj.shape.k === "arr"
            ? (obj.shape as { element: Abs }).element
            : obj.shape.k === "tuple"
              ? (obj.shape as { elements: Abs[] }).elements.reduce((x, y) => joinAbs(x, y), unknown)
              : unknown;
        // 不动点
        let acc = init;
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
        // filter 保持元素类型
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
    return ok(applyAbsFn(bound, args, env, phi, budget), phi, env);
  }

  const value = callFunction(env, name, args, phi, budget);
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
}

/** 把 (x) => body 用给定实参求值一次 */
function applyUnaryCallback(
  fnNode: Node,
  arg: Abs,
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): Abs {
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
