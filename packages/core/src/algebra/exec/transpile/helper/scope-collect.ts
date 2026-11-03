/**
 * 作用域收集域（transpile helper 叶）：绑定模式收名（collectPatternNames
 * 单源）、赋值目标收集、var 提升 / export var、本层声明遮蔽、const 作用域
 * 与 fn-const 侧表、别名组（leading / filter / merge / expand）、臂内自由写
 * （collectFreeAssignedNames）、数组 mutator receiver 扫描。
 *
 * 模块级状态全部收敛于本文件（防分裂后双份）：
 * - constFnScopeTable（const 作用域集 → fn-const 集，WeakMap）；
 * - freeAssignedCache / mutatorRecvCache（导出面：跨发射器共享的节点身份
 *   缓存，消费方一律经 helpers.ts facade 取同一绑定，不得复制）。
 */
import type { Node, Statement, VariableDeclaration } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { isStatefulMethodName } from "../ops.ts";
import { HOST_INTRINSIC_SET } from "../intrinsics.ts";

/** 收集赋值/Update 左值标识符（while/for pack/unpack 用）。
 *  循环 init 声明的名字在整个循环结构内 shadow 外层绑定，不得收集
 *  （否则外层 pack 会引用内层循环变量——闭包作用域外，ReferenceError）。 */
export function collectAssignedIds(node: unknown, acc: Set<string>, shadowed?: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const sh = shadowed ?? new Set<string>();
  const n = node as {
    type?: string;
    left?: { type?: string; name?: string; object?: unknown };
    init?: unknown;
    argument?: { type?: string; name?: string };
    [k: string]: unknown;
  };
  if (n.type === "ForStatement" || n.type === "ForOfStatement" || n.type === "ForInStatement") {
    const declNode =
      n.type === "ForStatement" ? n.init : (n as { left?: unknown }).left;
    const loopNames = new Set<string>();
    if (
      declNode &&
      typeof declNode === "object" &&
      (declNode as { type?: string }).type === "VariableDeclaration"
    ) {
      for (const d of (declNode as { declarations?: Array<{ id?: unknown }> }).declarations ?? []) {
        collectPatternNames(d.id, loopNames);
      }
    }
    const next = new Set(sh);
    for (const name of loopNames) next.add(name);
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      const child = n[key];
      if (Array.isArray(child)) child.forEach((c) => collectAssignedIds(c, acc, next));
      else if (child && typeof child === "object") collectAssignedIds(child, acc, next);
    }
    return;
  }
  if (n.type === "AssignmentExpression" && n.left?.type === "Identifier" && n.left.name) {
    if (!sh.has(n.left.name)) acc.add(n.left.name);
  }
  if (
    n.type === "AssignmentExpression" &&
    n.left?.type === "MemberExpression"
  ) {
    let cur: { type?: string; object?: { type?: string; name?: string }; name?: string } | undefined =
      n.left as { type?: string; object?: { type?: string; name?: string }; name?: string };
    while (cur?.type === "MemberExpression") cur = cur.object;
    if (cur?.type === "Identifier" && cur.name && !sh.has(cur.name)) acc.add(cur.name);
  }
  if (n.type === "UpdateExpression" && n.argument?.type === "Identifier" && n.argument.name) {
    if (!sh.has(n.argument.name)) acc.add(n.argument.name);
  }
  // Bug 21：块内 `var x = init` 经提升改发赋值——函数作用域共享绑定，
  // 循环 pack/unpack 必须覆盖（裸 `var x;` 无写，不收集）
  if (n.type === "VariableDeclaration" && n.kind === "var") {
    const decls = (n.declarations ?? []) as Array<{ id?: unknown; init?: unknown }>;
    for (const d of decls) {
      if (!d.init) continue;
      const names = new Set<string>();
      collectPatternNames(d.id, names);
      for (const name of names) if (!sh.has(name)) acc.add(name);
    }
  }
  for (const key of Object.keys(n)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
    const child = n[key];
    if (Array.isArray(child)) child.forEach((c) => collectAssignedIds(c, acc, sh));
    else if (child && typeof child === "object") collectAssignedIds(child, acc, sh);
  }
}

export const FUNCTION_SCOPE_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);



export type IdentNode = {
  type?: string;
  name?: string;
  argument?: { type?: string; name?: string };
  left?: { type?: string; name?: string };
  properties?: unknown[];
  elements?: unknown[];
};

export function collectPatternNames(id: unknown, acc: Set<string>): void {
  if (!id || typeof id !== "object") return;
  const n = id as IdentNode;
  if (n.type === "Identifier" && n.name) acc.add(n.name);
  else if (n.type === "RestElement") collectPatternNames(n.argument, acc);
  else if (n.type === "AssignmentPattern") collectPatternNames(n.left, acc);
  else if (n.type === "ObjectPattern") {
    for (const p of n.properties ?? []) {
      const prop = p as { type?: string; value?: unknown; argument?: unknown };
      if (prop?.type === "RestElement") collectPatternNames(prop.argument, acc);
      else collectPatternNames(prop?.value, acc);
    }
  } else if (n.type === "ArrayPattern") {
    for (const el of n.elements ?? []) collectPatternNames(el, acc);
  }
}

/**
 * 声明绑定名扫描（宿主内建遮蔽判定用）：收集 AST/Program 内**全部绑定
 * 位置**的名字——变量声明模式（含解构 / 默认值 / rest）、函数 / 类声明与
 * 表达式自身名、各类函数形态的形参、catch 参数、import specifier local、
 * TS 参数属性。
 *
 * 保守口径：**任意作用域**出现同名绑定都计入（不做词法作用域归属）。调用
 * 方只需要「本单元内该名字是否被用户绑定过」的单位级事实；读点发射标识符
 * 本身时由 JS 词法绑定决定读值，全单元保守遮蔽只损失字面量折叠精度，不改
 * 语义。loc / comments 等非 AST 面键直接跳过（无绑定信息，纯开销）。
 */
const BINDING_SCAN_SKIP_KEYS: ReadonlySet<string> = new Set([
  "loc", "start", "end", "range", "extra",
  "leadingComments", "trailingComments", "innerComments", "comments", "tokens", "errors",
]);

export function collectDeclaredBindingNames(node: unknown, acc: Set<string> = new Set()): Set<string> {
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const c of n) visit(c);
      return;
    }
    const o = n as { type?: string; [k: string]: unknown };
    switch (o.type) {
      case "VariableDeclarator":
        collectPatternNames(o.id, acc);
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "ObjectMethod":
      case "ClassMethod":
      case "ClassPrivateMethod":
        // 函数 / 对象方法 / 类方法：自身名（函数表达式可具名）+ 形参模式
        collectPatternNames(o.id, acc);
        for (const p of (o.params as unknown[] | undefined) ?? []) collectPatternNames(p, acc);
        break;
      case "ClassDeclaration":
      case "ClassExpression":
        collectPatternNames(o.id, acc);
        break;
      case "CatchClause":
        collectPatternNames(o.param, acc);
        break;
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
        collectPatternNames(o.local, acc);
        break;
      case "TSParameterProperty":
        collectPatternNames(o.parameter, acc);
        break;
      default:
        break;
    }
    for (const key of Object.keys(o)) {
      if (BINDING_SCAN_SKIP_KEYS.has(key)) continue;
      const v = o[key];
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(node);
  return acc;
}

/**
 * 本转译单元**遮蔽宿主内建**的名字集（undefined / NaN / Infinity 的子集）。
 *
 * 判据 = 声明绑定扫描命中 ∪ 调用方补给（`extra`：mock/env 注入名、body-fn
 * 的形参 / 闭包绑定名）。无命中 → undefined（调用方不写 opts 字段，产物逐
 * 字节不变）。
 */
export function shadowedIntrinsicsOf(
  node: unknown,
  extra?: ReadonlySet<string>,
): ReadonlySet<string> | undefined {
  let out: Set<string> | undefined;
  for (const name of collectDeclaredBindingNames(node)) {
    if (HOST_INTRINSIC_SET.has(name)) (out ??= new Set()).add(name);
  }
  if (extra) {
    for (const name of extra) {
      if (HOST_INTRINSIC_SET.has(name)) (out ??= new Set()).add(name);
    }
  }
  return out;
}

/**
 * var 提升预扫描（Bug 21）：收集函数体（或模块顶层）内全部 `var` 声明名
 * （含嵌套块/循环/try/switch 臂；含 for-init/left 的 var），**不穿越**
 * 函数/方法/类体边界（那些绑定属于内层作用域）。export var（模块顶层
 * 保持声明面）与参数名由调用方从结果中扣除。
 */
const VAR_HOIST_STOP_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
  "ClassDeclaration",
  "ClassExpression",
  "StaticBlock",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
]);

export function collectVarHoistNames(stmts: readonly unknown[]): Set<string> {
  const acc = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const n = node as {
      type?: string;
      kind?: string;
      declarations?: Array<{ id?: unknown }>;
      [k: string]: unknown;
    };
    if (VAR_HOIST_STOP_TYPES.has(n.type as string)) return;
    if (n.type === "VariableDeclaration") {
      if (n.kind === "var") {
        for (const d of n.declarations ?? []) collectPatternNames(d.id, acc);
      }
      return; // init 内的函数/类体是独立作用域，不下降
    }
    for (const key of Object.keys(node as object)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range" || key === "comments") continue;
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === "object") walk(child);
    }
  };
  for (const s of stmts) walk(s);
  return acc;
}

/** 语句列表顶层 export var 声明名（模块级保持声明面，从提升集扣除） */
export function collectExportVarNames(stmts: readonly unknown[]): Set<string> {
  const acc = new Set<string>();
  for (const s of stmts) {
    const n = s as {
      type?: string;
      declaration?: { type?: string; kind?: string; declarations?: Array<{ id?: unknown }> };
    };
    if (
      n?.type === "ExportNamedDeclaration" &&
      n.declaration?.type === "VariableDeclaration" &&
      n.declaration.kind === "var"
    ) {
      for (const d of n.declaration.declarations ?? []) collectPatternNames(d.id, acc);
    }
  }
  return acc;
}

/**
 * **单条语句**在本层语句表里声明的词法名（let/const/class/function；`var`
 * 是函数作用域 ⇒ 不收）。**不下降**到嵌套块 / 嵌套函数体：那些声明只
 * shadow 各自作用域，不 shadow 同一语句表里的兄弟语句。
 *
 * 用途（fork 协议的「臂内声明不是自由写」判定）：同批节点是**同一语句表**
 * 里的兄弟语句——`case 1: let a = …; a = 2` 的 `let a` 必须 shadow 兄弟
 * `a = 2`（否则 `$copy(a)` 撞 const/TDZ），而 `case 1: { let a = … } a = 2`
 * 的块内 `let a` 不得外泄到兄弟语句（否则外层 `a` 的合法自由写被吞 ⇒
 * 臂不再隔离）。嵌套块的遮蔽由 walk 的 BlockStatement 分支自己处理。
 */
function collectListStatementDeclNames(stmt: unknown, acc: Set<string>): void {
  const n = stmt as
    | {
        type?: string;
        kind?: string;
        id?: unknown;
        declarations?: Array<{ id?: unknown }>;
        declaration?: {
          type?: string;
          kind?: string;
          id?: unknown;
          declarations?: Array<{ id?: unknown }>;
        };
      }
    | null
    | undefined;
  if (!n) return;
  // `export const/let/class …`：导出包装不改变绑定的层级（声明本体在本层）
  const node = n.type === "ExportNamedDeclaration" && n.declaration ? n.declaration : n;
  if (node.type === "VariableDeclaration") {
    if (node.kind === "var") return;
    for (const d of node.declarations ?? []) collectPatternNames(d.id, acc);
    return;
  }
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    collectPatternNames(node.id, acc);
  }
}

/**
 * 循环 pack/unpack 剔除名单：只收循环体**顶层**语句的词法声明名
 * （let/const/class/function；var 是函数作用域不收）。
 * 体顶层声明对整个循环体 shadow 外层绑定，而 pack/unpack 闭包发射在体
 * 作用域之外——引用的是外层绑定，外层无绑定则 ReferenceError（#91：
 * 正则状态重绑 `re = $reStateCall(re, …)` 使声明名进 assigned）——必须剔除。
 * 嵌套块/嵌套函数体内的声明只 shadow 内层作用域，对 unpack 的外层绑定
 * 赋值是合法 JS shadowing，不得剔除（否则跨迭代状态丢失 → 非健全精确）。
 * body 非块（单语句体）→ 空集：原生语法禁止单语句体的词法声明。
 */
export function collectLoopBodyTopLevelDeclNames(body: unknown, acc: Set<string>): void {
  const n = body as { type?: string; body?: unknown } | null | undefined;
  if (!n || n.type !== "BlockStatement" || !Array.isArray(n.body)) return;
  for (const s of n.body as unknown[]) collectListStatementDeclNames(s, acc);
}

/**
 * 计算语句列表层的可见 const 绑定名：
 * childConsts = (parentConsts − 本层 let/var 遮蔽) ∪ 本层 const。
 * 不进入嵌套块/函数体（那些作用域各自计算）。
 *
 * 附带登记「本层**初始化器是函数表达式**的 const 绑定名」（见
 * `constFnNamesOf`）——族 59 · W9（台账族 43 遗留 5）：const 绑定**不可重绑**，
 * 成员写不得重绑根。
 */
export function computeConstScope(
  stmts: readonly unknown[],
  parentConsts: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
  const consts = new Set<string>();
  const fnConsts = new Set<string>();
  const mutables = new Set<string>();
  const walkList = (list: readonly unknown[]): void => {
    for (const s of list) {
      if (!s || typeof s !== "object") continue;
      const n = s as {
        type?: string;
        kind?: string;
        declarations?: Array<{ id?: unknown; init?: { type?: string } }>;
        id?: unknown;
        body?: unknown;
      };
      if (n.type === "VariableDeclaration") {
        const isConst = n.kind === "const";
        const target = isConst ? consts : mutables;
        for (const d of n.declarations ?? []) {
          collectPatternNames(d.id, target);
          if (!isConst) continue;
          // 初始化器是函数表达式 / 箭头函数 ⇒ 该 const 绑定的值是引擎的
          // **fn Abs**（`$fnVal`）——`$set(fnAbs, …)` 就地写（返回同一 Abs）
          // ⇒ 成员写去掉根重绑**不丢写**（收窄口径，见 constFnNamesOf）。
          const initType = d.init?.type;
          if (initType !== "FunctionExpression" && initType !== "ArrowFunctionExpression") continue;
          const fnNames = new Set<string>();
          collectPatternNames(d.id, fnNames);
          for (const nm of fnNames) fnConsts.add(nm);
        }
        continue;
      }
      if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") {
        // function/class 绑定可再赋（let 语义），遮蔽同名 parent const
        collectPatternNames(n.id, mutables);
        continue;
      }
      // 不进入 BlockStatement / Function / ClassBody / 循环体——嵌套作用域自算
    }
  };
  walkList(stmts);
  const out = new Set<string>();
  const outFn = new Set<string>();
  const parentFn = parentConsts ? constFnScopeTable.get(parentConsts) : undefined;
  if (parentConsts) {
    for (const name of parentConsts) {
      if (mutables.has(name)) continue;
      out.add(name);
      if (parentFn?.has(name)) outFn.add(name);
    }
  }
  for (const name of consts) out.add(name);
  for (const name of fnConsts) outFn.add(name);
  constFnScopeTable.set(out, outFn);
  return out;
}

/**
 * const 作用域集的**裁剪复制**（参数 / catch / 循环等遮蔽处）——同时裁剪
 * fn-const 侧表（族 59 · W9）保持两侧关联（否则侧表丢失 ⇒ 收窄口径失效）。
 */
export function copyConstScope(
  scope: ReadonlySet<string> | undefined,
  drop: ReadonlySet<string>,
): Set<string> | undefined {
  if (!scope) return undefined;
  const out = new Set<string>();
  const outFn = new Set<string>();
  const fn = constFnScopeTable.get(scope);
  for (const name of scope) {
    if (drop.has(name)) continue;
    out.add(name);
    if (fn?.has(name)) outFn.add(name);
  }
  constFnScopeTable.set(out, outFn);
  return out;
}

/**
 * 模块级 const 作用域的 **fn-const 登记**（族 59 · W9）。
 *
 * 模块体自身的 `const` 声明不进 `opts.constNames`（该表只收 import 绑定与
 * 嵌套作用域的 const 面）⇒ 模块级的「const 绑定的函数」写（`const F =
 * function(){}; F.prototype = {}`）看不到 fn-const 面。此处按模块体登记
 * fn-const 集（绑定到模块级 const 集对象上，供 member-path 侧查表）。
 */
export function registerConstFnScope(
  moduleConstNames: Set<string>,
  stmts: readonly unknown[],
  parentConsts: ReadonlySet<string> | undefined,
): void {
  const own = new Set<string>();
  const mutables = new Set<string>();
  for (const s of stmts) {
    if (!s || typeof s !== "object") continue;
    const n = s as {
      type?: string;
      kind?: string;
      declarations?: Array<{ id?: unknown; init?: { type?: string } }>;
      id?: unknown;
    };
    if (n.type === "VariableDeclaration") {
      const isConst = n.kind === "const";
      for (const d of n.declarations ?? []) {
        if (!isConst) {
          collectPatternNames(d.id, mutables);
          continue;
        }
        const initType = d.init?.type;
        if (initType !== "FunctionExpression" && initType !== "ArrowFunctionExpression") continue;
        const fnNames = new Set<string>();
        collectPatternNames(d.id, fnNames);
        for (const nm of fnNames) own.add(nm);
      }
      continue;
    }
    if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") {
      collectPatternNames(n.id, mutables);
    }
  }
  const outFn = new Set<string>();
  const parentFn = parentConsts ? constFnScopeTable.get(parentConsts) : undefined;
  if (parentFn) {
    for (const name of parentFn) {
      if (mutables.has(name)) continue;
      outFn.add(name);
    }
  }
  for (const name of own) outFn.add(name);
  constFnScopeTable.set(moduleConstNames, outFn);
}

/**
 * 词法作用域 const 集 → 该作用域内**初始化器是函数表达式**的 const 绑定名。
 *
 * 族 59 · W9（台账族 43 遗留 5）：`const F = function(){}; F.prototype = {};`
 * 的写**不得重绑根绑定**——原生 const 不可重绑（`F.prototype = {}` 是对函数
 * 对象的 [[Set]]，不是对绑定的赋值 ⇒ 原生不报错）。
 *
 * 引擎此前的 const 模型只覆盖「用户层直接赋值」（`F = x` ⇒ TypeError），
 * **成员写**走的是「根绑定重绑」通道 ⇒ const 绑定被内部重绑（污染根绑定）。
 *
 * 收窄口径：**只对初始化器是函数表达式的 const 绑定**建模——这类绑定的值是
 * fn Abs（`$fnVal`），`$set(fnAbs, …)` **就地写**（返回同一 Abs）⇒ 去掉根
 * 重绑不丢写；其余 const 绑定（值可能是需重绑的形态，如内建 brand）维持
 * 既有根重绑通道不动。
 */
const constFnScopeTable = new WeakMap<ReadonlySet<string>, ReadonlySet<string>>();

export function constFnNamesOf(scope: ReadonlySet<string> | undefined): ReadonlySet<string> | undefined {
  return scope ? constFnScopeTable.get(scope) : undefined;
}

/** 赋值/自增目标若是 const 绑定 → 发射 TypeError 抛出 */
export function isConstAssignTarget(
  name: string,
  opts: { constNames?: ReadonlySet<string> },
): boolean {
  return !!opts.constNames?.has(name);
}

/**
 * 臂内「自由写」绑定：赋值/mutator 标识符在赋值点未被臂内声明遮蔽。
 * 嵌套函数参数 / for-of 绑定 / catch 参数不得把外层自由写从 fork
 * 协议里剔除（P0-1）。
 */
/** AST 节点身份 → free-write / mutator-receiver 扫描结果（热路径去重） */
export const freeAssignedCache = new WeakMap<object, string[]>();
export const mutatorRecvCache = new WeakMap<object, Set<string>>();

export function collectFreeAssignedNames(...nodes: Array<unknown>): string[] {
  const cachedParts: string[][] = [];
  const pending: object[] = [];
  for (const node of nodes) {
    if (node && typeof node === "object") {
      const hit = freeAssignedCache.get(node);
      if (hit) {
        cachedParts.push(hit);
        continue;
      }
      pending.push(node);
    }
  }
  if (pending.length === 0) {
    const merged = new Set<string>();
    for (const p of cachedParts) for (const n of p) merged.add(n);
    return [...merged];
  }
  const free = new Set<string>();
  const markFree = (name: string | undefined, shadowed: Set<string>): void => {
    if (name && !HOST_INTRINSIC_SET.has(name) && !shadowed.has(name)) free.add(name);
  };
  // 同批节点是**同一语句表**里的兄弟语句（switch 臂语句 / if 分支体 /
  // 函数体余下语句）——本层声明（let/const/class/function）遮蔽本批自由写：
  // 臂内 `let shares = []; shares.push(1)` 不得进外层 fork 协议（$copy(TDZ)）。
  // 只收**本层**声明（不下降嵌套块）：块内 `let a` 只 shadow 该块，
  // `case 1: { let a = … } a.v = 7` 的外层 `a` 仍是合法自由写。
  const batchDecl = new Set<string>();
  for (const node of nodes) collectListStatementDeclNames(node, batchDecl);
  const walk = (node: unknown, shadowed: Set<string>): void => {
    if (!node || typeof node !== "object") return;
    const n = node as {
      type?: string;
      operator?: string;
      left?: unknown;
      right?: unknown;
      argument?: unknown;
      id?: unknown;
      param?: unknown;
      params?: unknown[];
      body?: unknown;
      declarations?: Array<{ id?: unknown }>;
      callee?: {
        type?: string;
        object?: unknown;
        property?: { type?: string; name?: string };
        computed?: boolean;
      };
      [k: string]: unknown;
    };

    let nextShadowed = shadowed;
    const pushShadow = (names: Iterable<string>): void => {
      const add: string[] = [];
      for (const name of names) {
        if (name && !nextShadowed.has(name)) add.push(name);
      }
      if (add.length === 0) return;
      nextShadowed = new Set(nextShadowed);
      for (const name of add) nextShadowed.add(name);
    };

    if (FUNCTION_SCOPE_TYPES.has(n.type as string)) {
      const bound = new Set<string>();
      collectPatternNames(n.id, bound);
      for (const p of n.params ?? []) collectPatternNames(p, bound);
      // 内层函数体的**函数级**绑定（`var` 提升 + 本层函数声明）属于内层
      // 作用域 ⇒ 写到它们不是对**外层**绑定的自由写。缺这一层时
      // `function g() { var a = 1; a = 2 }` 会把外层（多半不存在的）`a`
      // 拉进 fork/pack 协议 ⇒ 发射 `$copy(a)` 运行时 ReferenceError ⇒
      // 假 never / L2 假 throws（臂内 var 是**内层**绑定，外层无同名绑定）。
      // 箭头函数表达式体没有提升层（表达式体不是语句列表）。
      const bodyStmts =
        (n.body as { type?: string; body?: unknown[] } | undefined)?.type === "BlockStatement"
          ? ((n.body as { body?: unknown[] }).body ?? [])
          : [];
      for (const name of collectVarHoistNames(bodyStmts)) bound.add(name);
      for (const s of bodyStmts) {
        const st = s as { type?: string; id?: unknown } | null | undefined;
        if (st?.type === "FunctionDeclaration") collectPatternNames(st.id, bound);
      }
      pushShadow(bound);
    } else if (n.type === "BlockStatement") {
      // 块作用域：块**本层**的词法声明（TDZ 覆盖整个块 ⇒ 先整体 shadow，
      // 再看增量语句序）。不下降嵌套块——`{ { let a = … } a.v = 7 }` 的内层
      // `let a` 只 shadow 内层，外层 `a` 仍是自由写。
      const bound = new Set<string>();
      for (const stmt of (n.body as unknown[] | undefined) ?? []) {
        collectListStatementDeclNames(stmt, bound);
      }
      pushShadow(bound);
    } else if (n.type === "VariableDeclaration") {
      if (n.kind !== "var") {
        const bound = new Set<string>();
        for (const d of n.declarations ?? []) collectPatternNames(d.id, bound);
        pushShadow(bound);
      } else {
        // Bug 21：`var x = init` 是对函数作用域（提升）绑定的写——臂内
        // var 声明进 fork 协议（snapshot/join）；裸 `var x;` 无写不进
        const written = new Set<string>();
        for (const d of (n.declarations ?? []) as Array<{ id?: unknown; init?: unknown }>) {
          if (d.init) collectPatternNames(d.id, written);
        }
        for (const name of written) markFree(name, nextShadowed);
      }
    } else if (n.type === "CatchClause") {
      const bound = new Set<string>();
      collectPatternNames(n.param, bound);
      pushShadow(bound);
    } else if (n.type === "ForOfStatement" || n.type === "ForInStatement") {
      const bound = new Set<string>();
      const left = n.left as
        | { type?: string; declarations?: Array<{ id?: unknown }>; name?: string }
        | undefined;
      if (left?.type === "VariableDeclaration") {
        for (const d of left.declarations ?? []) collectPatternNames(d.id, bound);
      } else {
        collectPatternNames(left, bound);
      }
      pushShadow(bound);
    } else if (n.type === "ForStatement") {
      // `for (let i = …)` / `for (const i = …)`：init 名是循环内绑定，
      // 不得进 fork 协议（否则臂外 `$copy(i)` → ReferenceError）。
      // `var` 是函数作用域——仍作自由写（与 extractForInitName 口径一致）。
      const init = n.init as
        | { type?: string; kind?: string; declarations?: Array<{ id?: unknown }> }
        | undefined;
      if (init?.type === "VariableDeclaration" && init.kind !== "var") {
        const bound = new Set<string>();
        for (const d of init.declarations ?? []) collectPatternNames(d.id, bound);
        pushShadow(bound);
      }
    }

    // 成员链根标识符（`a.b.c = …` 的 a；ThisExpression / 非标识符根不标）——
    // 赋值 / 更新 / 有状态调用三面同款，单源。
    const markFreeMemberRoot = (node: unknown): void => {
      let cur = node as { type?: string; object?: unknown; name?: string } | undefined;
      while (cur?.type === "MemberExpression") {
        cur = cur.object as { type?: string; object?: unknown; name?: string } | undefined;
      }
      if (cur?.type === "Identifier") markFree(cur.name, nextShadowed);
    };

    if (n.type === "AssignmentExpression") {
      const left = n.left as
        | { type?: string; name?: string; object?: unknown }
        | undefined;
      if (left?.type === "Identifier") markFree(left.name, nextShadowed);
      else markFreeMemberRoot(left);
    }
    if (n.type === "UpdateExpression") {
      const arg = n.argument as { type?: string; name?: string; object?: unknown } | undefined;
      if (arg?.type === "Identifier") markFree(arg.name, nextShadowed);
      else markFreeMemberRoot(arg);
    }
    if (
      n.type === "CallExpression" &&
      n.callee?.type === "MemberExpression" &&
      n.callee.computed !== true &&
      n.callee.property?.type === "Identifier" &&
      isStatefulMethodName((n.callee.property as { name: string }).name)
    ) {
      const obj = n.callee.object as
        | { type?: string; name?: string; object?: unknown }
        | undefined;
      if (obj?.type === "Identifier") markFree(obj.name, nextShadowed);
      else markFreeMemberRoot(obj);
    }

    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      if (key === "callee" || key === "property" || key === "param" || key === "params") continue;
      const child = n[key];
      if (Array.isArray(child)) {
        if (
          n.type === "BlockStatement" ||
          n.type === "Program" ||
          n.type === "StaticBlock" ||
          n.type === "SwitchCase"
        ) {
          let blockShadow = nextShadowed;
          for (const stmt of child) {
            walk(stmt, blockShadow);
            const stmtNode = stmt as {
              type?: string;
              declarations?: Array<{ id?: unknown }>;
              id?: unknown;
            } | null;
            if (!stmtNode) continue;
            const declared = new Set<string>();
            if (stmtNode.type === "VariableDeclaration") {
              for (const d of stmtNode.declarations ?? []) collectPatternNames(d.id, declared);
            } else if (
              stmtNode.type === "FunctionDeclaration" ||
              stmtNode.type === "ClassDeclaration"
            ) {
              collectPatternNames(stmtNode.id, declared);
            }
            if (declared.size > 0) {
              if (blockShadow === nextShadowed) blockShadow = new Set(blockShadow);
              for (const name of declared) blockShadow.add(name);
            }
          }
          continue;
        }
        for (const item of child) walk(item, nextShadowed);
      } else if (child && typeof child === "object") {
        walk(child, nextShadowed);
      }
    }

    // 函数参数/体在扩展后的 shadow 下求值
    if (FUNCTION_SCOPE_TYPES.has(n.type as string) && n.body) {
      walk(n.body, nextShadowed);
    }
  };

  for (const node of pending) {
    walk(node, new Set(batchDecl));
  }
  const computed = [...free].filter((n) => !batchDecl.has(n));
  for (const node of pending) freeAssignedCache.set(node, computed);
  const merged = new Set<string>(computed);
  for (const p of cachedParts) for (const n of p) {
    if (!batchDecl.has(n)) merged.add(n);
  }
  return [...merged];
}

/**
 * 抽象臂间需要 snapshot/join 的自由写绑定。
 * 仅在赋值点被臂内声明遮蔽的名字不进协议。
 */
export function collectForkBindingNames(...nodes: Array<unknown>): string[] {
  return collectFreeAssignedNames(...nodes);
}

/**
 * 本层语句表**直接**声明的遮蔽名（let / const / class / function）。
 *
 * 口径与 computeConstScope 的 walkList 同源：只看**本层**声明，不进入嵌套
 * 块 / 嵌套函数体（那些作用域各自算自己的遮蔽——嵌套块的 let 只在该块内
 * 遮蔽，嵌套函数的形参/局部名只在该函数体内遮蔽）。
 *
 * `var` 不收：var 是**函数**作用域绑定，与外层 const 同名是 SyntaxError
 * ⇒ 不可能遮蔽别名组成员（组成员恒为 const 声明名）。
 */
export function collectScopeShadowNames(stmts: readonly unknown[]): Set<string> {
  const out = new Set<string>();
  for (const s of stmts) {
    if (!s || typeof s !== "object") continue;
    const n = s as {
      type?: string;
      kind?: string;
      id?: unknown;
      declarations?: Array<{ id?: unknown }>;
    };
    if (n.type === "VariableDeclaration") {
      if (n.kind === "var") continue;
      for (const d of n.declarations ?? []) collectPatternNames(d.id, out);
      continue;
    }
    if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") {
      collectPatternNames(n.id, out);
    }
  }
  return out;
}

/**
 * 前导 run 的单步归一：const 声明本体 / 「不打断 run」/ 「打断 run」。
 *
 * - `const`：本步是一条 const 声明（可直接参与别名并查）；
 * - `skip`：本步不初始化任何绑定、也不观察别名绑定 ⇒ 不打断前导 run；
 * - `break`：本步打断前导 run（其后的声明不再参与本层别名组）。
 */
type AliasRunStep =
  | { kind: "const"; decl: VariableDeclaration }
  | { kind: "skip" }
  | { kind: "break" };

/**
 * 前导 run 的单步归一口径：
 * - `import` 声明 → `skip`（依赖模块的求值发生在模块体之前，不观察本
 *   模块的别名绑定；别名声明仍在任何后续语句之前初始化 ⇒ 无 TDZ 风险）；
 * - `export const …` → `const`（导出包装不改变初始化时序）；
 * - `export { a }` / `export * from …`（无声明体）→ `skip`（同 import）；
 * - 其余（`let`/`var` 声明、函数/类声明、表达式语句、`export default …`）
 *   → `break`。
 */
function aliasRunStepOf(stmt: Statement): AliasRunStep {
  if (stmt.type === "ImportDeclaration") return { kind: "skip" };
  if (stmt.type === "ExportNamedDeclaration") {
    const decl = stmt.declaration;
    if (!decl) return { kind: "skip" };
    if (decl.type === "VariableDeclaration") {
      return decl.kind === "const" ? { kind: "const", decl } : { kind: "break" };
    }
    return { kind: "break" };
  }
  if (stmt.type === "VariableDeclaration") {
    return stmt.kind === "const" ? { kind: "const", decl: stmt } : { kind: "break" };
  }
  return { kind: "break" };
}

/**
 * **作用域边界**语句表开头连续 const 声明里的直接别名组
 * （`const a = {...}; const b = a;`）。
 *
 * 只收 init 为同作用域、此前已声明 const 的标识符：这样别名声明一定在
 * 所有后续语句之前初始化，fork/pack 带上 `b` 不会踩 TDZ；`let`/`var` 可
 * 重绑，不能当作稳定别名。非连续（中间隔了其它语句）的别名不收集——
 * 保守漏收只会保留旧的别名缺陷，不会引入错误绑定。
 *
 * 边界口径：函数/方法体、嵌套块与**模块顶层**都算本层组（嵌套块的组与
 * 函数体同权——块内 `const x = …; const y = x;` 的别名同样要跨 fork 保持
 * 身份）。模块顶层**不经**函数体入口（模块体是逐语句发射的），其本层组
 * 由 transpile.ts 单独计算并下发（见 TranspileOptions.aliasGroups）。
 */
export function leadingConstAliasGroups(stmts: readonly Statement[]): string[][] {
  const parent = new Map<string, string>();
  const declared = new Set<string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.has(cur) && parent.get(cur) !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const stmt of stmts) {
    const step = aliasRunStepOf(stmt);
    if (step.kind === "skip") continue;
    if (step.kind === "break") break;
    for (const d of step.decl.declarations) {
      if (d.id.type !== "Identifier") continue;
      if (d.init?.type === "Identifier" && declared.has(d.init.name)) {
        union(d.id.name, d.init.name);
      }
      parent.set(d.id.name, parent.get(d.id.name) ?? d.id.name);
      declared.add(d.id.name);
    }
  }
  const groups = new Map<string, string[]>();
  for (const name of parent.keys()) {
    const root = find(name);
    const group = groups.get(root);
    if (group) group.push(name);
    else groups.set(root, [name]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * 别名组按遮蔽名过滤：组内**任一成员**在本处被重新声明 ⇒ 该成员在本处
 * 指向**不同绑定** ⇒ 该组不得用于扩展（否则 fork/pack 会把「伙伴」当成本
 * 处的绑定复制/重绑 ⇒ 断开别名身份 ⇒ 自信错值）。
 *
 * 例：外层 `const a = {}; const b = a;`，内层块 `let a = {}` 遮蔽 `a`
 * ⇒ 块内的 fork 写 `a` 时不得把外层 `b` 拉进绑定集。
 */
export function filterAliasGroups(
  groups: ReadonlyArray<readonly string[]> | undefined,
  shadow: ReadonlySet<string> | undefined,
): ReadonlyArray<readonly string[]> | undefined {
  if (!groups || groups.length === 0) return groups;
  if (!shadow || shadow.size === 0) return groups;
  const out: string[][] = [];
  for (const g of groups) {
    if (g.length === 0) continue;
    let hit = false;
    for (const n of g) {
      if (shadow.has(n)) {
        hit = true;
        break;
      }
    }
    if (hit) continue;
    out.push([...g]);
  }
  return out;
}

/**
 * 作用域边界的别名组合并：
 * - **继承**组（外层作用域）按本层遮蔽名过滤后并入——本层重新声明了组内
 *   任一成员时该成员在本层指向不同绑定（展开会复制/重绑外层伙伴 ⇒ 别名
 *   身份断开）；未被遮蔽时外层伙伴在本层仍是同一绑定（嵌套函数写外层别名
 *   成员时靠它保持身份）。
 * - **自有**组（本层开头连续 const 声明的直接别名）无条件并入——同层声明
 *   ⇒ 同绑定 ⇒ 展开安全。
 */
export function mergeAliasGroups(
  inherited: ReadonlyArray<readonly string[]> | undefined,
  own: ReadonlyArray<readonly string[]> | undefined,
  shadow: ReadonlySet<string> | undefined,
): ReadonlyArray<readonly string[]> {
  const out: string[][] = [];
  const seen = new Set<string>();
  const push = (g: readonly string[]): void => {
    const key = [...g].sort().join("\u0000");
    if (seen.has(key)) return;
    seen.add(key);
    out.push([...g]);
  };
  for (const g of filterAliasGroups(inherited, shadow) ?? []) push(g);
  for (const g of own ?? []) {
    if (g.length === 0) continue;
    push(g);
  }
  return out;
}

/**
 * 把 fork/pack 绑定集扩展到直接 const 别名伙伴。
 *
 * `const a = {...}; const b = a;` 只有 `a` 被写时，快照/ pack 若不带上 `b`，
 * 臂结束重绑 `a` 会断开 `b` 的引用。别名组在**作用域边界**上计算（见
 * TranspileOptions.aliasGroups）：函数/方法体与嵌套块由
 * `transpileFnBodyStmts` 算，模块顶层由 transpile.ts 算；每层 = 本层自有组
 * + 外层组按本层遮蔽名过滤后的结果 ⇒ 展开只在「组内成员在本处指向同一
 * 绑定」时发生（名字匹配，不做绑定身份判定）。
 */
export function expandAliasNames(
  names: Iterable<string>,
  opts: TranspileOptions,
): string[] {
  const out = new Set<string>(names);
  const groups = opts.aliasGroups;
  if (!groups || groups.length === 0) return [...out];
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      let hit = false;
      for (const n of group) {
        if (out.has(n)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      for (const n of group) {
        if (!out.has(n)) {
          out.add(n);
          changed = true;
        }
      }
    }
  }
  return [...out];
}


export function collectArrMutatorReceiversUncached(node: unknown, acc = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return acc;
  const n = node as Record<string, unknown>;
  if (
    n.type === "FunctionExpression" ||
    n.type === "ArrowFunctionExpression" ||
    n.type === "ObjectMethod" ||
    n.type === "ClassMethod" ||
    n.type === "FunctionDeclaration"
  ) {
    return acc;
  }
  if (
    n.type === "CallExpression" &&
    (n.callee as { type?: string; object?: Node; property?: Node; computed?: boolean } | undefined)
      ?.type === "MemberExpression"
  ) {
    const callee = n.callee as { object?: Node; property?: Node; computed?: boolean };
    const propName =
      !callee.computed && callee.property?.type === "Identifier"
        ? (callee.property as { name: string }).name
        : undefined;
    if (propName && isStatefulMethodName(propName)) {
      const obj = callee.object;
      if (obj?.type === "Identifier") {
        acc.add((obj as { name: string }).name);
      } else if (obj?.type === "MemberExpression") {
        let cur: { type?: string; object?: { type?: string } } | undefined =
          obj as { type?: string; object?: { type?: string } };
        while (cur?.type === "MemberExpression") {
          cur = cur.object;
        }
        if (cur?.type === "Identifier") {
          acc.add((cur as unknown as { name: string }).name);
        }
      }
    }
  }
  for (const key of Object.keys(n)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
    const child = n[key];
    if (Array.isArray(child)) child.forEach((c) => collectArrMutatorReceiversUncached(c, acc));
    else if (child && typeof child === "object") collectArrMutatorReceiversUncached(child, acc);
  }
  return acc;
}

/** 收集语句/表达式里以 Identifier 为 receiver 的数组 mutator 名 */
export function collectArrMutatorReceivers(node: unknown, acc = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return acc;
  const hit = mutatorRecvCache.get(node as object);
  if (hit) {
    for (const n of hit) acc.add(n);
    return acc;
  }
  const local = new Set<string>();
  collectArrMutatorReceiversUncached(node, local);
  mutatorRecvCache.set(node as object, local);
  for (const n of local) acc.add(n);
  return acc;
}
