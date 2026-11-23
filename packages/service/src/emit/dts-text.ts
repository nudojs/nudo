/**
 * dts 声明面的纯文本工具。
 *
 * 从 `dts-generator.ts` 抽出：形参名清洗 / 属性键 / 顶层切分 / rest 类型闸门
 * 既被函数签名发射器使用，也被类与 namespace 发射器使用。放在这里避免
 * 发射器模块之间互相 import（循环依赖）。
 */
import {
  formatObjectKey,
  isJsBindingIdent,
  toJsBindingIdent,
} from "@nudojs/core/internal";

/**
 * 函数 / 类名 → 合法 TS 绑定名。作用域名（`C.m`）不是合法标识符；保留字
 * （`default` / `class` …）直出会 TS1359。`toJsBindingIdent` 是仓里既有的
 * Unicode 保真口径：合法名原样、保留字加 `_` 前缀、非法字符逐字清洗。
 */
export function dtsIdentifier(name: string): string {
  return toJsBindingIdent(name);
}

/**
 * 成员声明里不能用保留字/非法标识符；空名与非 ident 落到 argN。
 * optional 标签（`options?`）先剥下再判 ident、保留 `?` 输出
 * （与 formatShape 的 `label?` 口径一致，BUG-020/S6-005：
 * 旧实现整名换 argN，`?` 语义丢失变必填）。
 */
export function sanitizeParamName(name: string, index: number): string {
  let optional = false;
  let base = name;
  if (base.endsWith("?")) {
    optional = true;
    base = base.slice(0, -1);
  }
  if (base.startsWith("...")) {
    const rest = base.slice(3);
    if (isJsBindingIdent(rest)) return `...${rest}${optional ? "?" : ""}`;
    return `...arg${index}`;
  }
  if (isJsBindingIdent(base)) return `${base}${optional ? "?" : ""}`;
  return `arg${index}`;
}

/** 对象字面量键：ident / 规范数字键可裸写，其余 JSON 引号（与 schema formatJsObjectKey 同口径）。 */
export function formatPropKey(k: string): string {
  return formatObjectKey(k);
}

/**
 * 顶层切分（忽略 `<>` / `()` / `[]` / `{}` 内的分隔符）。
 * 类型形参子句里常见 `T extends Record<string, unknown>` —— 逗号在实参里，
 * 不能就地 split。
 */
export function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++;
    // 箭头函数 `=>`（`T extends (x: number) => string, U`）里的 `>` 是运算符
    // 而不是闭合括号：当成闭合会把 depth 减成负数，后续 `,` 全被当成实参内
    // 分隔符 ⇒ 第二个形参 `U` 从子句里消失（形参名 / 返回位引用被误判未声明）。
    else if (
      (ch === ">" && text[i - 1] !== "=") ||
      ch === ")" ||
      ch === "]" ||
      ch === "}"
    ) {
      depth--;
    }
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

/** 类型形参子句里的形参名（`<T, U extends X = Y>` ⇒ `["T","U"]`） */
export function typeParamNamesInClause(clause: string | undefined): string[] {
  if (!clause) return [];
  const trimmed = clause.trim();
  if (!/^</.test(trimmed)) return [];
  const inner = trimmed.slice(
    1,
    trimmed.lastIndexOf(">") >= 0 ? trimmed.lastIndexOf(">") : undefined,
  );
  return splitTopLevel(inner, ",")
    .map(
      (p) => /^(?:(?:const|in|out)\s+)*([A-Za-z_$][\w$]*)/.exec(p.trim())?.[1],
    )
    .filter((n): n is string => n !== undefined);
}

/**
 * rest 位可用的类型文本（`T[]` / `Array<T>` / `ReadonlyArray<T>` / 元组）。
 *
 * TS 4.0 起 rest 形参允许**元组**（`...x: [string, boolean]`：实参元数 = 元组
 * 长度）⇒ 闸门必须放行 `[A, B]` / `readonly [A, B]`，否则注解被丢、回落
 * 符号哨兵的 `unknown[]`（BUG-242）。
 */
export function isArrayTypeText(t: string): boolean {
  const text = t.trim();
  return (
    /\[\]$/.test(text) ||
    /^Array<.*>$/.test(text) ||
    /^ReadonlyArray<.*>$/.test(text) ||
    /^readonly\s+\[[\s\S]*\]$/.test(text) ||
    /^\[[\s\S]*\]$/.test(text)
  );
}

/**
 * 构造器 / 方法形参的声明片段。
 *
 * 有注解时**原文保真**：形参注解不是「猜类型」，是声明面事实——抽象 /
 * 无体方法在分析面没有条目，源码面是唯一证据源。rest 位的注解在合法 TS 里
 * 本来就是数组类型（`...rest: number[]`），不得再追加 `[]`（`number[][]`
 * 会让消费方 `new C(1, 2, 3)` 报 TS2345）；只有注解不可用（缺 / 非数组文本）
 * 时才补 `unknown[]`。
 */
export function paramDeclOf(name: string, index: number, annotation?: string): string {
  const safe = sanitizeParamName(name, index);
  if (annotation !== undefined) {
    if (safe.startsWith("...") && !isArrayTypeText(annotation)) {
      return `${safe}: ${annotation}[]`;
    }
    return `${safe}: ${annotation}`;
  }
  return safe.startsWith("...") ? `${safe}: unknown[]` : `${safe}: unknown`;
}
