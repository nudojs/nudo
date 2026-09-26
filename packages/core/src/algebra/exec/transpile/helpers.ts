/**
 * transpile 共享 AST 工具：形参名、match、fold、静态键、作用域收集、mutator receiver 扫描。
 * 不依赖 stmt/expr 发射器（无环）。
 */
import type { Statement, Node, Expression } from "@babel/types";
import { formalParamsFromNodes, formalParamDisplayNames } from "../../param-surface.ts";
import type { TranspileOptions } from "./types.ts";
import { isStatefulMethodName } from "./ops.ts";

export function paramDisplayNames(params: unknown[] | undefined): string[] {
  return formalParamDisplayNames(formalParamsFromNodes(params as unknown as Parameters<typeof formalParamsFromNodes>[0]));
}

/**
 * ObjectMethod / 方法型 FunctionExpression 的宿主绑定名：
 * Identifier / 默认参左名 / RestElement 直通；其余占位 `_a`。
 * 与 emitParamBinding 的 sig 同精神，但保持方法简写路径轻量。
 */
export function methodBindNames(params: unknown[] | undefined): string[] {
  return (params ?? []).map((raw) => {
    const p = raw as { type?: string; name?: string; left?: { type?: string; name?: string }; argument?: { type?: string; name?: string } };
    if (p?.type === "Identifier" && p.name) return p.name;
    if (p?.type === "AssignmentPattern" && p.left?.type === "Identifier" && p.left.name) return p.left.name;
    if (p?.type === "RestElement" && p.argument?.type === "Identifier" && p.argument.name) return `...${p.argument.name}`;
    return "_a";
  });
}

export function matchAsOverride(stmt: Node, opts: TranspileOptions): string | null {
  if (!opts.asOverrides?.length || !stmt.loc) return null;
  const line = stmt.loc.start.line;
  for (const a of opts.asOverrides) {
    if (line >= a.stmtStart && line <= a.stmtEnd) return a.varName;
  }
  return null;
}

/**
 * 函数体是否含 this：B 路径默认把函数声明/表达式转成无宿主 this 的调用，
 * 只有 body 引用 this 的函数才需要宿主 this 注入（$rawThis）。
 * 嵌套函数声明/表达式有自己的 this 边界，不下降；箭头函数词法 this 下降。
 */
export function fnBodyHasThis(fn: { body?: Node | null }): boolean {
  const body = fn.body;
  if (!body) return false;
  const seen = new Set<Node>();
  const walk = (n: Node): boolean => {
    if (n.type === "ThisExpression") return true;
    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression") return false;
    if (seen.has(n)) return false;
    seen.add(n);
    for (const [k, v] of Object.entries(n)) {
      if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments") continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && "type" in (item as object)) {
            if (walk(item as Node)) return true;
          }
        }
      } else if (v && typeof v === "object" && "type" in (v as object)) {
        if (walk(v as Node)) return true;
      }
    }
    return false;
  };
  return walk(body);
}

/**
 * 函数体是否**直接**引用 `arguments`（不下降任何嵌套函数/箭头/方法）。
 * 仅此时建立 argsBinding——嵌套箭头的 `arguments` 沿此绑定词法继承；
 * 无绑定时 Identifier 折 $unknown()（差分 harness 外层是箭头 IIFE，
 * native 为 ReferenceError；投影外层 arguments 会假精确）。
 */
export function fnBodyHasOwnArguments(fn: { body?: Node | null }): boolean {
  const body = fn.body;
  if (!body) return false;
  const seen = new Set<Node>();
  const walk = (n: Node): boolean => {
    if (n.type === "Identifier" && (n as { name?: string }).name === "arguments") return true;
    if (
      n.type === "FunctionDeclaration" ||
      n.type === "FunctionExpression" ||
      n.type === "ArrowFunctionExpression" ||
      n.type === "ObjectMethod" ||
      n.type === "ClassMethod"
    ) {
      return false;
    }
    if (seen.has(n)) return false;
    seen.add(n);
    for (const [k, v] of Object.entries(n)) {
      if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments") continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && "type" in (item as object)) {
            if (walk(item as Node)) return true;
          }
        }
      } else if (v && typeof v === "object" && "type" in (v as object)) {
        if (walk(v as Node)) return true;
      }
    }
    return false;
  };
  return walk(body);
}

export function normWs(s: string): string {
  return s.replace(/\s+/g, "");
}


export function matchReplacement(node: Node, opts: TranspileOptions): string | null {
  if (!opts.source || !opts.replacements?.length) return null;
  if (node.start == null || node.end == null || !node.loc) return null;
  const src = opts.source.slice(node.start, node.end);
  const n = normWs(src);
  const line = node.loc.start.line;
  for (const r of opts.replacements) {
    if (r.stmtStart != null && line < r.stmtStart) continue;
    if (r.stmtEnd != null && line > r.stmtEnd) continue;
    if (normWs(r.target) === n) return r.varName;
  }
  return null;
}

export function indent(n: number): string {
  return "  ".repeat(n);
}

/** 字面量 ToString（模板插值 / 字符串拼接）；非字面量 → undefined */
export function litToStringOf(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const n = node as { type?: string; value?: unknown; name?: string };
  switch (n.type) {
    case "StringLiteral":
      return typeof n.value === "string" ? n.value : undefined;
    case "NumericLiteral":
    case "BooleanLiteral":
      return String(n.value);
    case "NullLiteral":
      return "null";
    case "Identifier":
      return n.name === "undefined" ? "undefined" : undefined;
    default:
      return undefined;
  }
}

/**
 * 编译期常量字符串折叠（require 说明符子集）：
 * - StringLiteral
 * - TemplateLiteral（无插值 / 插值全为可 ToString 字面量）
 * - `+` 字符串拼接（至少一侧为可折叠字符串，另一侧为字符串或字面量）
 * 不能折叠 → undefined（诚实动态，不假精确）。
 */
export function foldStaticStringExpr(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const n = node as {
    type?: string;
    value?: unknown;
    quasis?: Array<{ value: { cooked?: string | null; raw: string } }>;
    expressions?: unknown[];
    operator?: string;
    left?: unknown;
    right?: unknown;
    expression?: unknown;
  };
  // ESTree 括号（Babel 通常无此节点，防御）
  if (n.type === "ParenthesizedExpression") return foldStaticStringExpr(n.expression);
  switch (n.type) {
    case "StringLiteral":
      return typeof n.value === "string" ? n.value : undefined;
    case "TemplateLiteral": {
      const quasis = n.quasis ?? [];
      const exprs = n.expressions ?? [];
      let out = "";
      for (let i = 0; i < quasis.length; i++) {
        out += quasis[i]!.value.cooked ?? quasis[i]!.value.raw;
        if (i < exprs.length) {
          const part = foldStaticStringExpr(exprs[i]) ?? litToStringOf(exprs[i]);
          if (part === undefined) return undefined;
          out += part;
        }
      }
      return out;
    }
    case "BinaryExpression": {
      if (n.operator !== "+") return undefined;
      const ls = foldStaticStringExpr(n.left);
      const rs = foldStaticStringExpr(n.right);
      if (ls !== undefined && rs !== undefined) return ls + rs;
      if (ls !== undefined) {
        const r = litToStringOf(n.right);
        if (r !== undefined) return ls + r;
        return undefined;
      }
      if (rs !== undefined) {
        const l = litToStringOf(n.left);
        if (l !== undefined) return l + rs;
        return undefined;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** require(...) 第一个参数 → 可折叠说明符（StringLiteral / 模板 / 字面量拼接） */
export function foldRequireSpecArg(arg: unknown): string | undefined {
  if (!arg || typeof arg !== "object") return undefined;
  const a = arg as { type?: string };
  if (a.type === "SpreadElement") return undefined;
  return foldStaticStringExpr(arg);
}

/** 对象键 → 字符串（Identifier/StringLiteral/NumericLiteral；其余 null）。
 *  { 10: "a" } 的键是 NumericLiteral，与 "10" 同键（原生 ToPropertyKey）。 */
export function staticKeyOf(key: { type?: string; name?: string; value?: unknown } | null | undefined): string | null {
  if (!key || typeof key !== "object") return null;
  if (key.type === "Identifier") return key.name ?? null;
  if (key.type === "StringLiteral" || key.type === "NumericLiteral") return String(key.value);
  return null;
}

/** 计算键 [Symbol.X] → 已引号化的 "@@X" 投影（对象字面量/访问器）；
 *  其余计算键 → null。镜像成员访问 m[Symbol.iterator] 的投影口径。 */
export function symbolKeyOf(key: { type?: string; computed?: boolean; object?: { type?: string; name?: string }; property?: { type?: string; name?: string } } | null | undefined): string | null {
  if (!key || typeof key !== "object") return null;
  if (
    key.type === "MemberExpression" &&
    key.computed !== true &&
    key.object?.type === "Identifier" &&
    key.object.name === "Symbol" &&
    key.property?.type === "Identifier"
  ) {
    return JSON.stringify(`@@${key.property.name}`);
  }
  return null;
}

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

export const BINDING_SCOPE_TYPES = new Set([
  ...FUNCTION_SCOPE_TYPES,
  "CatchClause",
  "ForOfStatement",
  "ForInStatement",
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
 * 收集子树内 **词法声明** 名（let/const/function/class；不含 var——函数作用域）。
 * 不进入嵌套函数（那些绑定属于内层作用域）。
 * 用于 fork 协议：臂内声明不是「自由写」，不得 `$copy(未定义名)`。
 */
export function collectLexicalDeclNames(node: unknown, acc: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as {
    type?: string;
    kind?: string;
    id?: unknown;
    declarations?: Array<{ id?: unknown }>;
    [k: string]: unknown;
  };
  if (FUNCTION_SCOPE_TYPES.has(n.type as string) && n.type !== "BlockStatement") {
    // 函数本体的词法名属于内层；只收函数名（若 FunctionDeclaration）
    if (n.type === "FunctionDeclaration") collectPatternNames(n.id, acc);
    return;
  }
  if (n.type === "VariableDeclaration" && n.kind !== "var") {
    for (const d of n.declarations ?? []) collectPatternNames(d.id, acc);
  } else if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") {
    collectPatternNames(n.id, acc);
  }
  for (const key of Object.keys(n)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
    const child = n[key];
    if (Array.isArray(child)) child.forEach((c) => collectLexicalDeclNames(c, acc));
    else if (child && typeof child === "object") collectLexicalDeclNames(child, acc);
  }
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
    if (name && name !== "undefined" && !shadowed.has(name)) free.add(name);
  };
  // 同批节点内的词法声明（let/const/function）遮蔽本批自由写——
  // 臂内 `let shares = []; shares.push` 不得进外层 fork 协议（$copy(TDZ)）。
  const batchDecl = new Set<string>();
  for (const node of nodes) collectLexicalDeclNames(node, batchDecl);
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
      pushShadow(bound);
    } else if (n.type === "BlockStatement") {
      const bound = new Set<string>();
      for (const stmt of (n.body as unknown[] | undefined) ?? []) {
        collectLexicalDeclNames(stmt, bound);
      }
      pushShadow(bound);
    } else if (n.type === "VariableDeclaration") {
      if (n.kind !== "var") {
        const bound = new Set<string>();
        for (const d of n.declarations ?? []) collectPatternNames(d.id, bound);
        pushShadow(bound);
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

    if (n.type === "AssignmentExpression") {
      const left = n.left as
        | { type?: string; name?: string; object?: unknown }
        | undefined;
      if (left?.type === "Identifier") markFree(left.name, nextShadowed);
      else if (left?.type === "MemberExpression") {
        let cur: { type?: string; object?: unknown; name?: string } | undefined =
          left as { type?: string; object?: unknown; name?: string };
        while (cur?.type === "MemberExpression") {
          cur = cur.object as { type?: string; object?: unknown; name?: string } | undefined;
        }
        if (cur?.type === "Identifier") markFree(cur.name, nextShadowed);
      }
    }
    if (n.type === "UpdateExpression") {
      const arg = n.argument as { type?: string; name?: string; object?: unknown } | undefined;
      if (arg?.type === "Identifier") markFree(arg.name, nextShadowed);
      else if (arg?.type === "MemberExpression") {
        let cur: { type?: string; object?: unknown; name?: string } | undefined =
          arg as { type?: string; object?: unknown; name?: string };
        while (cur?.type === "MemberExpression") {
          cur = cur.object as { type?: string; object?: unknown; name?: string } | undefined;
        }
        if (cur?.type === "Identifier") markFree(cur.name, nextShadowed);
      }
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
      else if (obj?.type === "MemberExpression" || obj?.type === "ThisExpression") {
        let cur: { type?: string; object?: unknown; name?: string } | undefined = obj as unknown as { type?: string; object?: unknown; name?: string };
        while (cur?.type === "MemberExpression") {
          cur = cur.object as { type?: string; object?: unknown; name?: string } | undefined;
        }
        if (cur?.type === "Identifier") markFree(cur.name, nextShadowed);
      }
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

export function isExpression(n: { type: string }): n is Expression {
  return n.type !== "PrivateName" && !n.type.endsWith("Statement") && !n.type.endsWith("Declaration");
}
