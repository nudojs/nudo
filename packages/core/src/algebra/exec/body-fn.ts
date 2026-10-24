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
import { transpileBodyNode, runtimeImportOf } from "./transpile.ts";
import { rtAllBindings } from "./rt.ts";
import { noteEvalFallback } from "./run.ts";

const RUNTIME_IMPORT_RE = /^import\s*\{[^}]+\}\s*from\s*"[^"]+";\s*$/m;

const compiledByImpl = new WeakMap<object, (args: Abs[]) => Abs>();
/** 自名注入的 Abs 按 body 对象缓存——$callNamed cycle 键（对象身份）可立即命中 */
const selfAbsByBody = new WeakMap<object, Abs>();

/** body 的自由标识符集合（参数/词法声明之外引用的名字）。
 *  嵌套函数 params/声明只作用于其词法作用域（不污染外层）；
 *  非计算 property key（o.x / {x: 1} / {x(){}}）不计数。 */
export function freeIdentifiers(body: Node, params: string[]): Set<string> {
  const free = new Set<string>();
  const scopes: Set<string>[] = [new Set(params)];
  const declare = (name: string): void => {
    scopes[scopes.length - 1]!.add(name);
  };
  const isDeclared = (name: string): boolean => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i]!.has(name)) return true;
    }
    return false;
  };
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const o = n as { type?: string; [k: string]: unknown };
    if (o.type === "Identifier" && typeof (o as { name?: unknown }).name === "string") {
      const name = (o as { name: string }).name;
      if (!isDeclared(name)) free.add(name);
      return;
    }
    if (o.type === "VariableDeclarator") {
      const id = o.id as { type?: string; name?: string } | undefined;
      if (id?.type === "Identifier" && id.name) declare(id.name);
      // 只扫 init：id 已按声明处理（解构 id 保守当引用，保持既有覆盖面）
      if (o.init && typeof o.init === "object") visit(o.init);
      return;
    }
    const isFnLike =
      o.type === "ArrowFunctionExpression" ||
      o.type === "FunctionExpression" ||
      o.type === "FunctionDeclaration" ||
      o.type === "ObjectMethod" ||
      o.type === "ClassMethod";
    if (o.type === "FunctionDeclaration") {
      const id = o.id as { type?: string; name?: string } | undefined;
      // 函数名进外层作用域（提升）
      if (id?.type === "Identifier" && id.name) declare(id.name);
    }
    if (isFnLike) {
      scopes.push(new Set());
      try {
        const rawParams = (o.params as Array<{ type?: string; name?: string; argument?: { type?: string; name?: string } }>) ?? [];
        for (const p of rawParams) {
          if (p.type === "Identifier" && p.name) declare(p.name);
          if (p.type === "RestElement" && p.argument?.type === "Identifier" && p.argument.name) {
            declare(p.argument.name);
          }
        }
        for (const p of rawParams as unknown[]) {
          if (!p || typeof p !== "object") continue;
          const pe = p as { type?: string; right?: unknown; [k: string]: unknown };
          if (pe.type === "AssignmentPattern") {
            if (pe.right && typeof pe.right === "object") visit(pe.right);
          } else if (pe.type !== "Identifier" && pe.type !== "RestElement") {
            visit(p);
          }
        }
        if (o.body && typeof o.body === "object") visit(o.body);
      } finally {
        scopes.pop();
      }
      return;
    }
    for (const key of Object.keys(o)) {
      if (key === "loc" || key === "start" || key === "end" || key === "tokens") continue;
      // 非计算 property key：不当作引用（MemberExpression.property /
      // ObjectProperty|ObjectMethod|ClassMethod|ClassProperty.key）
      const isNonComputedKey =
        (key === "property" || key === "key") &&
        (o.type === "MemberExpression" ||
          o.type === "ObjectProperty" ||
          o.type === "ObjectMethod" ||
          o.type === "ClassMethod" ||
          o.type === "ClassProperty") &&
        (o as { computed?: boolean }).computed !== true;
      if (isNonComputedKey) continue;
      const v = o[key];
      if (Array.isArray(v)) {
        for (const item of v) if (item && typeof item === "object") visit(item);
      } else if (v && typeof v === "object") {
        visit(v);
      }
    }
  };
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
  const free = freeIdentifiers(impl.body, impl.params);
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
    if (f) {
      closureArgs.push(name);
      // Bug 9：闭包函数值透传声明名（f.name 值读折 exact；env 键即声明名）
      const fnOpts = { name };
      if (f.body === impl.body) {
        let selfAbs = selfAbsByBody.get(f.body);
        if (selfAbs === undefined) {
          selfAbs = absFunction(f.params, { body: f.body, async: f.async, env: impl.env }, fnOpts);
          selfAbsByBody.set(f.body, selfAbs);
        }
        closureVals.push(selfAbs);
      } else {
        closureVals.push(absFunction(f.params, { body: f.body, async: f.async, env: impl.env }, fnOpts));
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
    const bodySrc = transpileBodyNode(impl.body, {
      userIdents: bodyIdentNames(impl.body, impl.params),
    });
    const js = [
      runtimeImportOf("@nudojs/core/exec"),
      `function __body(${impl.params.join(", ")}) {`,
      bodySrc,
      `}`,
      "return __body;",
    ].join("\n");
    const cleaned = js.replace(RUNTIME_IMPORT_RE, "");
    const argNames = [...Object.keys(rtAllBindings()), ...closureArgs];
    const factory = new Function(...argNames, cleaned) as (...vals: unknown[]) => (...a: Abs[]) => Abs;
    const bodyFn = factory(...Object.values(rtAllBindings()), ...closureVals);
    runner = (args: Abs[]) => bodyFn(...args);
    compiledByImpl.set(implKey, runner);
  } catch (e) {
    // 编译面回落：unsupported（body 含未 lowering 构造）/ internal 都记录
    noteEvalFallback(e);
    return undefined;
  }
  return runner;
}
