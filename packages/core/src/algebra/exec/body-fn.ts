/**
 * body 编译执行（迁移件 4）：自包含 Abs fn 的 body 转译成 JS 函数，
 * 调用时直接执行（替代 evalNode 解释）。语义门：
 * - body 无自由标识符（闭包/兄弟函数/自递归引用——property key 不算）
 *   → 可编译；否则 undefined（调用方回落 evalNode，递归预算仍生效）；
 * - phi 由调用方 gate（phi 线程收窄是解释语义，B 执行不支持）。
 * 按 impl 对象 WeakMap memo（body AST 身份稳定）。
 */
import type { Abs } from "../abs.ts";
import { absFunction, type AbsFnImpl } from "../abs-fn.ts";
import type { Node } from "@babel/types";
import { transpileBodyNode, runtimeImportOf } from "./transpile.ts";
import { rtAllBindings } from "./rt.ts";
import { noteBPathFallback } from "./run.ts";

const RUNTIME_IMPORT_RE = /^import\s*\{[^}]+\}\s*from\s*"[^"]+";\s*$/m;

const compiledByImpl = new WeakMap<object, (args: Abs[]) => Abs>();

/** body 的自由标识符集合（参数/声明/嵌套函数参数之外引用的名字）。
 *  非计算 property key（o.x / {x: 1}）不计数。 */
function freeIdentifiers(body: Node, params: string[]): Set<string> {
  const declared = new Set<string>(params);
  const free = new Set<string>();
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const o = n as { type?: string; [k: string]: unknown };
    if (o.type === "Identifier" && typeof (o as { name?: unknown }).name === "string") {
      const name = (o as { name: string }).name;
      if (!declared.has(name)) free.add(name);
      return;
    }
    if (o.type === "VariableDeclarator") {
      const id = o.id as { type?: string; name?: string } | undefined;
      if (id?.type === "Identifier" && id.name) declared.add(id.name);
    }
    if (o.type === "FunctionDeclaration") {
      const id = o.id as { type?: string; name?: string } | undefined;
      if (id?.type === "Identifier" && id.name) declared.add(id.name);
    }
    if (
      o.type === "ArrowFunctionExpression" ||
      o.type === "FunctionExpression" ||
      o.type === "ObjectMethod" ||
      o.type === "ClassMethod"
    ) {
      for (const p of (o.params as Array<{ type?: string; name?: string }>) ?? []) {
        if (p.type === "Identifier" && p.name) declared.add(p.name);
      }
    }
    for (const key of Object.keys(o)) {
      if (key === "loc" || key === "start" || key === "end" || key === "tokens") continue;
      // 非计算 property key：不当作引用
      if (
        (o.type === "MemberExpression" || o.type === "ObjectProperty" || o.type === "ObjectMethod") &&
        key === "property" &&
        (o as { computed?: boolean }).computed !== true &&
        o.type !== "ObjectMethod"
      ) {
        continue;
      }
      if (o.type === "MemberExpression" && key === "property" && (o as { computed?: boolean }).computed !== true) {
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
  return free;
}

/**
 * 编译 body → (args) => Abs。自由标识符（闭包）从 impl.env 解析注入：
 * vars → Abs 值；fns → absFunction 包装（调用走 $callNamed → applyAbsFn，
 * 解释语义/递归预算保留）。不可解析（全局名/自递归名）→ undefined
 * （调用方回落解释执行）。
 */
export function compiledBodyOf(impl: AbsFnImpl): ((args: Abs[]) => Abs) | undefined {
  if (!impl.body) return undefined;
  const implKey = impl as unknown as object;
  const hit = compiledByImpl.get(implKey);
  if (hit !== undefined) return hit;
  const free = freeIdentifiers(impl.body, impl.params);
  // 闭包注入面：自由名逐个解析；任一不可解析 → 整体回落
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
      closureVals.push(absFunction(f.params, { body: f.body, async: f.async, env: impl.env }));
      continue;
    }
    return undefined;
  }
  let runner: ((args: Abs[]) => Abs) | undefined;
  try {
    const bodySrc = transpileBodyNode(impl.body, {});
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
    noteBPathFallback(e);
    return undefined;
  }
  return runner;
}
