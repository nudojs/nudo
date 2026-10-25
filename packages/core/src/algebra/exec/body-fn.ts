/**
 * body 编译执行（迁移件 4）：自包含 Abs fn 的 body 转译成 JS 函数，
 * 调用时直接执行（替代 evalNode 解释）。语义门：
 * - 自由名从 impl.env 注入（vars/fns）；全局名留给 new Function 全局作用域
 *   （未定义名 ReferenceError = 原生奇偶，不再整体回落解释）；
 * - phi 由调用方 gate（phi 线程收窄是解释语义，eval 执行不支持）。
 * 按 impl 对象 WeakMap memo（body AST 身份稳定）。
 * 编译失败 → undefined（调用方回落非 body 面 / fail-closed）。
 */
import type { Abs } from "../abs.ts";
import { absFunction, type AbsFnImpl } from "../abs-fn.ts";
import type { Node } from "@babel/types";
import { transpileBodyNode } from "./transpile.ts";
import { shadowedIntrinsicsOf } from "./transpile/helpers.ts";
import { compileRuntimeUnit, runtimeArgValues } from "./rt.ts";
import { noteEvalFallback } from "./run.ts";

const compiledByImpl = new WeakMap<object, (args: Abs[]) => Abs>();
/** 自名注入的 Abs 按 body 对象缓存——$callNamed cycle 键（对象身份）可立即命中 */
const selfAbsByBody = new WeakMap<object, Abs>();

/** 词法作用域：`fn` = 函数级 var 作用域边界（函数体 / class 静态块），否则块作用域。 */
type FreeScope = { names: Set<string>; fn: boolean };

/** body 的自由标识符集合（参数/词法声明之外引用的名字）。
 *
 *  作用域模型（与 JS 词法一致，不再「函数边界一刀切」）：
 *  - 函数作用域：形参、`var`、函数体顶层的函数声明；
 *  - 块作用域：BlockStatement / SwitchStatement（各 case 共享一块）/
 *    For/ForIn/ForOf（头 + 体）/ CatchClause 参数 / class 体；
 *  - class 静态块（StaticBlock）是**独立 var 作用域**（var/函数声明不漏到
 *    外层函数）；class 体（方法 / 静态块 / 字段 / 计算键）恒 strict，块级
 *    函数声明在 class 体内永无 Annex B 提升——即使源文件是 sloppy CJS；
 *  - `let`/`const`/`class` 与块级函数声明只绑定块作用域；sloppy
 *    （`strict === false`）下（class 体外）块级函数声明另有 Annex B 函数
 *    作用域绑定（原生 sloppy 语义：块外可见）；ESM/strict 源无此提升。
 *  - `var` 一律提升到最近函数作用域。
 *
 *  嵌套函数 params/声明只作用于其词法作用域（不污染外层）；
 *  非计算 property key（o.x / {x: 1} / {x(){}}）不计数。 */
export function freeIdentifiers(body: Node, params: string[], strict = false): Set<string> {
  const free = new Set<string>();
  const scopes: FreeScope[] = [{ names: new Set(params), fn: true }];
  // 当前词法上下文是否 strict：源种类之外，**class 体恒 strict**（类定义
  // 整体是 strict mode code，含方法体/静态块/字段初始值）。class 体内部
  // 的块级函数声明因此永不做 Annex B 提升，即使源文件是 sloppy CJS。
  let inStrictCtx = strict;
  const currentScope = (): FreeScope => scopes[scopes.length - 1]!;
  const nearestFnScope = (): FreeScope => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i]!.fn) return scopes[i]!;
    return scopes[0]!;
  };
  const declare = (name: string, scope: FreeScope = currentScope()): void => {
    scope.names.add(name);
  };
  const declareVar = (name: string): void => {
    declare(name, nearestFnScope());
  };
  const isDeclared = (name: string): boolean => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i]!.names.has(name)) return true;
    }
    return false;
  };
  const pushScope = (fn: boolean): void => {
    scopes.push({ names: new Set(), fn });
  };
  const popScope = (): void => {
    scopes.pop();
  };
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const child = (v: unknown): { type?: string; [k: string]: unknown } | undefined =>
    v && typeof v === "object" ? (v as { type?: string; [k: string]: unknown }) : undefined;

  /** 绑定模式：声明其中的名字；默认值 / 计算键只作引用访问。 */
  function bindPattern(p: unknown, declareName: (name: string) => void): void {
    const b = child(p);
    if (!b) return;
    switch (b.type) {
      case "Identifier":
        if (typeof b.name === "string") declareName(b.name);
        return;
      case "RestElement":
        bindPattern(b.argument, declareName);
        return;
      case "AssignmentPattern":
        bindPattern(b.left, declareName);
        if (b.right) visit(b.right);
        return;
      case "ObjectPattern":
        for (const prop of arr(b.properties)) {
          const pp = child(prop);
          if (!pp) continue;
          if (pp.type === "RestElement") {
            bindPattern(pp.argument, declareName);
            continue;
          }
          if (pp.computed === true) visit(pp.key);
          bindPattern(pp.value, declareName);
        }
        return;
      case "ArrayPattern":
        for (const el of arr(b.elements)) if (el) bindPattern(el, declareName);
        return;
      case "TSParameterProperty":
        bindPattern(b.parameter, declareName);
        return;
      default:
        // 未知绑定形态：保守当引用（宁可多注入，不可漏注入）
        visit(p);
    }
  }

  function visitFunction(o: { type?: string; [k: string]: unknown }): void {
    const id = child(o.id);
    const name =
      id?.type === "Identifier" && typeof id.name === "string" ? id.name : undefined;
    if (o.type === "FunctionDeclaration" && name) {
      // 函数声明名进外层作用域（块级 → 块作用域；函数体顶层 → 函数作用域）。
      declare(name);
      // sloppy 且不在 class 体内：块级函数声明另有 Annex B 函数作用域绑定
      if (!inStrictCtx && !currentScope().fn) declareVar(name);
    }
    if (
      (o.type === "ObjectMethod" || o.type === "ClassMethod" || o.type === "ClassPrivateMethod") &&
      o.computed === true
    ) {
      visit(o.key);
    }
    pushScope(true);
    try {
      // FunctionExpression 自名仅自身作用域可见（FunctionDeclaration 名亦然）
      if (name) declare(name);
      for (const p of arr(o.params)) bindPattern(p, declare);
      const bodyNode = child(o.body);
      if (bodyNode?.type === "BlockStatement") {
        // 函数体块不额外开块：顶层 let/const 与 var 同属函数作用域（对自由
        // 名判定无差），顶层函数声明保持函数作用域提升口径。
        for (const st of arr(bodyNode.body)) visit(st);
      } else if (bodyNode) {
        visit(bodyNode);
      }
    } finally {
      popScope();
    }
  }

  function visitClass(o: { type?: string; [k: string]: unknown }): void {
    const id = child(o.id);
    const name =
      id?.type === "Identifier" && typeof id.name === "string" ? id.name : undefined;
    if (o.type === "ClassDeclaration" && name) declare(name);
    // heritage / decorators 在外层（可能 sloppy）上下文求值
    if (o.superClass) visit(o.superClass);
    if (o.decorators) visit(o.decorators);
    const prevStrictCtx = inStrictCtx;
    // class 体（方法 / 静态块 / 字段 / 计算键）恒 strict
    inStrictCtx = true;
    pushScope(false);
    try {
      // 类体内自名可见（ClassExpression 亦然）
      if (name) declare(name);
      visit(o.body);
    } finally {
      popScope();
      inStrictCtx = prevStrictCtx;
    }
  }

  function visit(n: unknown): void {
    const o = child(n);
    if (!o) return;
    if (o.type === "Identifier") {
      if (typeof o.name === "string" && !isDeclared(o.name)) free.add(o.name);
      return;
    }
    switch (o.type) {
      case "VariableDeclaration": {
        // `var` 提升到最近函数作用域；let/const/using 绑定当前块
        const declareName = o.kind === "var" ? declareVar : declare;
        for (const d of arr(o.declarations)) {
          const decl = child(d);
          if (!decl) continue;
          bindPattern(decl.id, declareName);
          if (decl.init) visit(decl.init);
        }
        return;
      }
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "ObjectMethod":
      case "ClassMethod":
      case "ClassPrivateMethod":
      case "TSDeclareMethod":
        visitFunction(o);
        return;
      case "ClassDeclaration":
      case "ClassExpression":
        visitClass(o);
        return;
      case "StaticBlock": {
        // class 静态块自带独立 var 作用域（ClassStaticBlockDeclaration 的
        // var 环境）：`var` 与函数声明不得漏到外层函数。按函数作用域边界
        // 压栈（nearestFnScope 在此停止），且块内类体上下文已恒 strict。
        pushScope(true);
        try {
          for (const st of arr(o.body)) visit(st);
        } finally {
          popScope();
        }
        return;
      }
      case "BlockStatement": {
        pushScope(false);
        try {
          for (const st of arr(o.body)) visit(st);
        } finally {
          popScope();
        }
        return;
      }
      case "SwitchStatement": {
        if (o.discriminant) visit(o.discriminant);
        // case 子句共享一个块作用域（let/const/函数声明的 switch 块语义）
        pushScope(false);
        try {
          for (const c of arr(o.cases)) {
            const cc = child(c);
            if (!cc) continue;
            if (cc.test) visit(cc.test);
            for (const st of arr(cc.consequent)) visit(st);
          }
        } finally {
          popScope();
        }
        return;
      }
      case "ForStatement": {
        // for 头部的 let/const 绑定只覆盖头 + 体
        pushScope(false);
        try {
          if (o.init) visit(o.init);
          if (o.test) visit(o.test);
          if (o.update) visit(o.update);
          if (o.body) visit(o.body);
        } finally {
          popScope();
        }
        return;
      }
      case "ForInStatement":
      case "ForOfStatement": {
        pushScope(false);
        try {
          if (o.left) visit(o.left);
          if (o.right) visit(o.right);
          if (o.body) visit(o.body);
        } finally {
          popScope();
        }
        return;
      }
      case "CatchClause": {
        pushScope(false);
        try {
          if (o.param) bindPattern(o.param, declare);
          if (o.body) visit(o.body);
        } finally {
          popScope();
        }
        return;
      }
      default:
        break;
    }
    for (const key of Object.keys(o)) {
      if (key === "loc" || key === "start" || key === "end" || key === "tokens") continue;
      // 非计算 property key：不当作引用（MemberExpression.property /
      // ObjectProperty|ObjectMethod|ClassMethod|ClassProperty.key）
      const isNonComputedKey =
        (key === "property" || key === "key") &&
        (o.type === "MemberExpression" ||
          o.type === "OptionalMemberExpression" ||
          o.type === "ObjectProperty" ||
          o.type === "ObjectMethod" ||
          o.type === "ClassMethod" ||
          o.type === "ClassPrivateMethod" ||
          o.type === "ClassProperty" ||
          o.type === "ClassPrivateProperty") &&
        (o as { computed?: boolean }).computed !== true;
      if (isNonComputedKey) continue;
      const v = o[key];
      if (Array.isArray(v)) {
        for (const item of v) if (item && typeof item === "object") visit(item);
      } else if (v && typeof v === "object") {
        visit(v);
      }
    }
  }

  visit(body);
  return free;
}

/**
 * body 内出现的**全部标识符词形**（形参 + body 内每个 Identifier——
 * 含属性键 / 嵌套函数 / 解构子名）。
 *
 * 用途：body 编译路径**没有源文本**（`transpileBodyNode(impl.body, …)`
 * 的 opts 无 `source`）⇒ 转译侧 `internalTmpName` 的避让集恒空 ⇒ 引擎
 * 内部临时名（`__nudoTm_{n}` / `__nudoE_{n}` / `__nudoRet` / `__nudoArgs` …）
 * 与用户标识符相撞 ⇒ 产物非法 JS（重复词法声明 / 遮蔽）⇒ 求值 fail-closed。
 * 本集合是该路径**唯一可用**的避让来源（AST 词形 = 源文本词形的子集，
 * 保守够用：用户绑定名必以 Identifier 出现）。
 */
export function bodyIdentNames(body: Node, params: readonly string[]): Set<string> {
  const names = new Set<string>(params);
  const seen = new WeakSet<object>();
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as object;
    if (seen.has(obj)) return;
    seen.add(obj);
    const o = n as { type?: string; name?: unknown; [k: string]: unknown };
    if (o.type === "Identifier" && typeof o.name === "string") {
      names.add(o.name);
      return;
    }
    for (const key of Object.keys(o)) {
      if (
        key === "loc" ||
        key === "start" ||
        key === "end" ||
        key === "tokens" ||
        key === "comments" ||
        key === "leadingComments" ||
        key === "trailingComments" ||
        key === "innerComments"
      ) {
        continue;
      }
      const v = o[key];
      if (Array.isArray(v)) {
        for (const item of v) if (item && typeof item === "object") visit(item);
      } else if (v && typeof v === "object") {
        visit(v);
      }
    }
  };
  visit(body);
  return names;
}

/**
 * body 的**严格后代**节点集合（不含 root 自身）。
 *
 * 用途：闭包注入时排除「body 内部的嵌套函数声明」——它在本编译单元里有
 * 自己的原生作用域（块级函数声明在 strict 下块外不可见、sloppy 下 Annex B
 * 提升；顶层声明/表达式本就随产物一起编译）。把它当外层闭包注入会把块级
 * 函数「救活」到块外，抹平 strict 语义（应有 ReferenceError 的引用被折成
 * 嵌套函数值）。自名条目的 body === root ⇒ 不在集合内，递归注入不受影响。
 */
function nestedBodyNodes(root: object): WeakSet<object> {
  const nested = new WeakSet<object>();
  const seen = new WeakSet<object>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as object;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (obj !== root) nested.add(obj);
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      if (
        key === "loc" ||
        key === "start" ||
        key === "end" ||
        key === "tokens" ||
        key === "comments" ||
        key === "leadingComments" ||
        key === "trailingComments" ||
        key === "innerComments"
      ) {
        continue;
      }
      const v = (obj as Record<string, unknown>)[key];
      if (Array.isArray(v)) {
        for (const item of v) walk(item);
      } else if (v && typeof v === "object") {
        walk(v);
      }
    }
  };
  walk(root);
  return nested;
}

/**
 * 编译 body → (args) => Abs。自由标识符（闭包）从 impl.env 解析注入：
 * vars → Abs 值；fns → absFunction 包装（调走 $callNamed → $call，递归预算保留）。
 * 全局名不注入——编译产物经 new Function 全局作用域解析（未定义名
 * ReferenceError = 原生奇偶）。编译失败 → undefined（调用方回落非 body 面）。
 */
export function compiledBodyOf(impl: AbsFnImpl): ((args: Abs[]) => Abs) | undefined {
  if (!impl.body) return undefined;
  const implKey = impl as unknown as object;
  const hit = compiledByImpl.get(implKey);
  if (hit !== undefined) return hit;
  // 严格性按**源码种类**（impl.strict 由源 AST 生产者写入 ESM/CJS 面判定）：
  // 只影响块级函数声明/未声明赋值等 sloppy↔strict 分叉，不按函数猜。
  const strict = impl.strict === true;
  const free = freeIdentifiers(impl.body, impl.params, strict);
  // env.fns 里 body 内部的嵌套声明（extractFn 的指令作用域登记面）不是
  // 外层闭包：它们随本 body 一起编译，原生作用域语义（块级可见性 / 提升）
  // 由产物自身承担。注入会把块级函数错误地「救活」到块外。
  const nestedBodies =
    impl.env && impl.env.fns.size > 0 ? nestedBodyNodes(impl.body as object) : undefined;
  // 闭包注入面：env 可解析名注入（vars → Abs；fns → absFunction 包装）；
  // 自名（env 条目指向同一 body）经 per-body 缓存的同一 Abs 注入——递归
  // 走 $callNamed（eval 调用预算：cycle 键按对象身份，同一 Abs → 立即截断，
  // 深度 64 兜底）。其余自由名（Math/JSON 等全局）不注入——编译产物经
  // new Function 全局作用域解析，与 B run 同语义（未定义名 ReferenceError
  // = 原生奇偶；不再整体回落）。
  const closureArgs: string[] = [];
  const closureVals: unknown[] = [];
  for (const name of free) {
    const v = impl.env?.vars.get(name);
    if (v) {
      closureArgs.push(name);
      closureVals.push(v);
      continue;
    }
    const f = impl.env?.fns.get(name);
    if (f && !nestedBodies?.has(f.body as object)) {
      closureArgs.push(name);
      // Bug 9：闭包函数值透传声明名（f.name 值读折 exact；env 键即声明名）
      const fnOpts = { name };
      // 同源闭包继承同一严格性（env 条目自带则优先）
      const closureStrict = f.strict ?? impl.strict;
      const strictOpt = closureStrict !== undefined ? { strict: closureStrict } : {};
      if (f.body === impl.body) {
        let selfAbs = selfAbsByBody.get(f.body);
        if (selfAbs === undefined) {
          selfAbs = absFunction(
            f.params,
            { body: f.body, async: f.async, env: impl.env, ...strictOpt },
            fnOpts,
          );
          selfAbsByBody.set(f.body, selfAbs);
        }
        closureVals.push(selfAbs);
      } else {
        closureVals.push(
          absFunction(
            f.params,
            { body: f.body, async: f.async, env: impl.env, ...strictOpt },
            fnOpts,
          ),
        );
      }
      continue;
    }
    // 全局名：留给编译产物的全局作用域（原生奇偶）
  }
  let runner: ((args: Abs[]) => Abs) | undefined;
  try {
    // Bug 1058 遗留 3（族 59 · W9）：本路径**无 source** ⇒ 转译侧内部临时名
    // 的避让集恒空 ⇒ 用户标识符与引擎临时名相撞 ⇒ 产物非法 JS ⇒ 整模块
    // fail-closed。补上 AST 词形（body 内全部 Identifier + 形参）作为避让源。
    //
    // 宿主内建遮蔽：形参名（`function f(undefined)`）与 env 可解析的闭包绑定
    // （模块级 `const undefined = 5` 经 impl.env.vars 注入首参）都必须在转译
    // 单元里按「已遮蔽」发射标识符读点；否则未遮蔽面的字面量折叠会绕过闭包
    // 注入的值（读成宿主全局）。body 内局部声明的遮蔽由 transpileBodyNode 自
    // 行扫描。
    const intrinsicExtra = new Set<string>(impl.params);
    for (const name of free) {
      if (impl.env?.vars.has(name) || impl.env?.fns.has(name)) intrinsicExtra.add(name);
    }
    const shadowedIntrinsics = shadowedIntrinsicsOf(impl.body, intrinsicExtra);
    const bodySrc = transpileBodyNode(impl.body, {
      userIdents: bodyIdentNames(impl.body, impl.params),
      ...(shadowedIntrinsics ? { shadowedIntrinsics } : {}),
    });
    const js = [
      // ESM 源与 B run 的 strict 前缀同口径；CJS/sloppy 不发射。指令必须
      // 位于编译单元首语句（运行时符号由 compileRuntimeUnit 以形参注入，
      // 单元不拼运行时 import 行）。
      ...(strict ? [`"use strict";`] : []),
      `function __body(${impl.params.join(", ")}) {`,
      bodySrc,
      `}`,
      "return __body;",
    ].join("\n");
    const factory = compileRuntimeUnit<(...a: Abs[]) => Abs>(js, closureArgs);
    const bodyFn = factory(...runtimeArgValues(), ...closureVals);
    runner = (args: Abs[]) => bodyFn(...args);
    compiledByImpl.set(implKey, runner);
  } catch (e) {
    // 编译面回落：unsupported（body 含未 lowering 构造）/ internal 都记录
    noteEvalFallback(e);
    return undefined;
  }
  return runner;
}
