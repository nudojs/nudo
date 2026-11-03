/**
 * 静态折叠 / 键计算 / 文本小工具（transpile helper 叶）：字面量 ToString、
 * 编译期常量字符串折叠（require 说明符子集）、对象静态键与 Symbol.X 投影键、
 * PrivateName 混淆键、缩进 / AST 谓词 / opts 小工具。全部纯函数，无模块级状态。
 */
import type { Node, Expression } from "@babel/types";
import type { TranspileOptions } from "../types.ts";

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

export function isExpression(n: { type: string }): n is Expression {
  return n.type !== "PrivateName" && !n.type.endsWith("Statement") && !n.type.endsWith("Declaration");
}

/** PrivateName 节点 → "#x" 混淆键（裸串；公有名不含 "#"，无碰撞）。
 * 统一提取点（call.ts / optional-chain.ts / class-emit.ts 的键推导都走
 * 这里——防内联复制复发）。无名（解析异常）→ null，交调用方 fail-closed。 */
export function privateNameKeyOf(prop: { id?: { name?: string }; name?: string }): string | null {
  const priv = prop.id?.name ?? prop.name;
  return priv ? `#${priv}` : null;
}

/** PrivateName 节点 → "#x" 混淆键源串（JSON 字符串字面量；公有名不含
 *  "#"，无碰撞）。成员读/写（Bug 78）与 in 运算符（Bug 80）共用——
 *  无名（解析异常）→ null，交调用方 fail-closed。 */
export function privateNameKeySrc(prop: { id?: { name?: string }; name?: string }): string | null {
  const key = privateNameKeyOf(prop);
  return key === null ? null : JSON.stringify(key);
}

/**
 * Bug 133：ES **NamedEvaluation**——类表达式绑定到名字时以该名为类名
 * （`const K = class {}` → `K.name === "K"`；`K = class {}` /
 * `{ K: class {} }` 同）。原生只有「类表达式**自身**在具名位置」才取名，
 * 其余位置（数组元素 / 实参 / 未绑定）类名是空串。
 *
 * 只给**类表达式**节点挂 hint：非类表达式原样返回 opts（不得把 hint 泄进
 * 任意子表达式的类表达式里）。
 */
export function withClassNameHint(
  opts: TranspileOptions,
  node: Node | null | undefined,
  name: string | undefined,
): TranspileOptions {
  if (name === undefined || node?.type !== "ClassExpression") return opts;
  return { ...opts, classNameHint: name };
}
