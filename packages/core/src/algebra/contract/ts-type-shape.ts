/**
 * TS 声明类型文本 → Abs 形状（Bug 479 / BUG-036）。
 *
 * 剥除 pass 留下的旁路是**源码文本**（`string` / `number[]` /
 * `{ a: number }` / `string | number`）。这里把 TS **内建复合类型**也映射成
 * Abs 形状：数组 / 元组 / 对象字面量 / 联合。此前只认 5 个 primitive，其余
 * 一律不映射 ⇒ 入口形参退「无约束 any」，`x.length` / `String(x)` 这类在
 * **合法 TypeScript 里保证不抛**的操作被记成 `nudo:entry-may-throw`（L2
 * 假红），而 dts 面同一注解完整保留 ⇒ 两面互相矛盾。
 *
 * 口径：
 * - 只映射结构可表达的形态；别名 / 泛型实例化 / 条件类型 / 映射类型 /
 *   交叉类型等仍不映射（⇒ 回落 any，不猜）；
 * - 嵌套位递归映射，**任一位不可映射 ⇒ 整条不映射**（半映射会把声明域
 *   悄悄收窄，比不映射更危险）；
 * - `null` / `undefined` / `void` 没有「窄形状」（Abs 的 literal 精度靠 term，
 *   本函数只产 Shape）⇒ 保守地映成 `unknown`，不谎报成精确值。
 */
import { abs, type Shape } from "../abs.ts";

/** 形状 → 嵌套位用的 Abs（无 term / pred：声明域，不是求值观测） */
function absOf(shape: Shape) {
  return abs(shape, undefined, undefined, "exact");
}

/** 去掉包裹整条类型的括号（`(A | B)[]` 的内层括号不能误剥） */
function unwrapParens(text: string): string {
  let t = text.trim();
  while (t.startsWith("(") && t.endsWith(")")) {
    let depth = 0;
    let wrapped = true;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++;
      else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") depth--;
      if (depth === 0 && i < t.length - 1) {
        wrapped = false;
        break;
      }
    }
    if (!wrapped) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

/**
 * 顶层分隔符切分（忽略 `<>` / `()` / `[]` / `{}` 与字符串里的分隔符）。
 * 数组后缀 `T[]`、泛型实参 `Record<string, number>` 里的逗号不能误切。
 */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote !== "") {
      cur += ch;
      if (ch === quote && text[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ">" || ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** 对象类型的键（去引号 / readonly / ?）；不可静态命名的键 ⇒ undefined */
function objectKeyOf(raw: string): { key: string; optional: boolean } | undefined {
  let k = raw.trim().replace(/^readonly\s+/, "");
  let optional = false;
  if (k.endsWith("?")) {
    optional = true;
    k = k.slice(0, -1).trim();
  }
  if (/^["'`]/.test(k)) {
    const quote = k[0]!;
    k = k.slice(1);
    if (k.endsWith(quote)) k = k.slice(0, -1);
  }
  return /^[A-Za-z_$][\w$]*$/.test(k) ? { key: k, optional } : undefined;
}

/** 声明类型文本 → Abs 形状（不可映射 ⇒ undefined） */
export function absShapeForTsTypeText(text: string | undefined): Shape | undefined {
  if (!text) return undefined;
  const t = unwrapParens(text.trim());
  if (!t) return undefined;

  switch (t) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
      return { k: "prim", type: t };
    case "any":
      return { k: "any" };
    case "unknown":
    case "void":
    case "undefined":
    case "null":
      return { k: "unknown" };
    case "never":
      return { k: "never" };
    case "object":
      return { k: "obj", slots: {}, open: true };
    default:
      break;
  }

  // 字面量类型（`"a"` / `1` / `true`）：term 精度带不进本函数，退回基类型
  if (/^(?:"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|true|false)$/.test(t)) {
    if (/^["']/.test(t)) return { k: "prim", type: "string" };
    if (t === "true" || t === "false") return { k: "prim", type: "boolean" };
    return { k: "prim", type: "number" };
  }

  // 联合（`A | B`）：任一支不可映射 ⇒ 整条不映射
  const union = splitTopLevel(t, "|");
  if (union.length > 1) {
    const shapes = union.map((part) => absShapeForTsTypeText(part));
    if (shapes.some((s) => s === undefined)) return undefined;
    return { k: "sum", members: shapes.map((s) => absOf(s!)) };
  }
  // 交叉 / 条件 / 推断等不映射
  if (splitTopLevel(t, "&").length > 1 || t.includes("extends") || t.includes("infer")) {
    return undefined;
  }

  // `readonly T[]` / `T[]`
  const arrMatch = /^(?:readonly\s+)?(.+)\[\]$/.exec(t);
  if (arrMatch) {
    const el = absShapeForTsTypeText(arrMatch[1]);
    return el ? { k: "arr", element: absOf(el) } : undefined;
  }
  // `Array<T>` / `ReadonlyArray<T>`
  const genericArr = /^(?:Readonly)?Array<(.+)>$/.exec(t);
  if (genericArr) {
    const el = absShapeForTsTypeText(genericArr[1]);
    return el ? { k: "arr", element: absOf(el) } : undefined;
  }

  // 元组 `[A, B]`（rest / 可选位先当普通位，长度是声明事实）
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    const parts = inner === "" ? [] : splitTopLevel(inner, ",");
    const shapes = parts.map((part) =>
      absShapeForTsTypeText(part.replace(/^\.\.\.\s*/, "").replace(/\?$/, "")),
    );
    if (shapes.some((s) => s === undefined)) return undefined;
    return { k: "tuple", elements: shapes.map((s) => absOf(s!)) };
  }

  // 对象类型 `{ a: number; b?: string }`
  if (t.startsWith("{") && t.endsWith("}")) {
    const inner = t.slice(1, -1).trim();
    const members = inner === "" ? [] : splitTopLevel(inner.replace(/;/g, ","), ",");
    const slots: Extract<Shape, { k: "obj" }>["slots"] = {};
    let open = false;
    for (const member of members) {
      const m = member.trim();
      if (m === "") continue;
      const idx = splitTopLevel(m, ":");
      if (idx.length !== 2) {
        // 索引签名 / 方法签名 / 不可解析的写法 ⇒ 开放对象（不谎报精确域）
        open = true;
        continue;
      }
      const key = objectKeyOf(idx[0]!);
      if (!key) {
        open = true;
        continue;
      }
      const value = absShapeForTsTypeText(idx[1]);
      if (!value) {
        open = true;
        continue;
      }
      slots[key.key] = { value: absOf(value), ...(key.optional ? { optional: true } : {}) };
    }
    return { k: "obj", slots, ...(open ? { open: true } : {}) };
  }

  // 其余（类型名 / 别名 / 泛型实例化 / 函数类型 …）不映射
  return undefined;
}
