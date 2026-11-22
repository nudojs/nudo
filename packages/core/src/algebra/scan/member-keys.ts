/**
 * 类 / 对象成员键的**共享 AST 索引**。
 *
 * 背景（BUG-385）：core 的函数普查（`listTopFunctions`）与 service 的普查
 * （`collectTopLevelFunctions`）各有一份「顶层字面量 const + 计算键」解析。
 * 两份实现一旦漂移，同一份源码在 check / dts / export 三个面就会看到不同的
 * 成员名。本模块是唯一实现；两个普查面只消费结果。
 *
 * 这里只做 AST 形状判定，不读环境、不执行代码。
 */
import type { Node } from "@babel/types";

/**
 * 顶层 `const x = <字符串/数字字面量>` 的稳定值（BUG-385）。
 *
 * 只收单标识符绑定；解构 / 复合初始化器不猜。`export const k = "dyn"` 与
 * 裸 `const k = "dyn"` 同等对待。
 */
export function literalConstValuesOf(body: readonly Node[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const stmt of body) {
    const decl =
      stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration"
        ? ((stmt as { declaration?: Node }).declaration ?? stmt)
        : stmt;
    if (decl.type !== "VariableDeclaration" || (decl as { kind?: string }).kind !== "const") {
      continue;
    }
    for (const d of (decl as { declarations?: unknown[] }).declarations ?? []) {
      const id = (d as { id?: { type?: string; name?: string } }).id;
      const init = (d as { init?: { type?: string; value?: unknown } | null }).init;
      if (id?.type !== "Identifier" || typeof id.name !== "string" || !init) continue;
      if (init.type === "StringLiteral" && typeof init.value === "string") {
        out.set(id.name, init.value);
      } else if (init.type === "NumericLiteral" && typeof init.value === "number") {
        out.set(id.name, String(init.value));
      }
    }
  }
  return out;
}

/**
 * 类 / 对象成员键名（Bug 105 + BUG-385）。
 *
 * - 非计算 Identifier / 字符串字面量 / 数字字面量 ⇒ 稳定名；
 * - 计算 `["mk"]` ⇒ 字面量键的稳定名；
 * - 计算 `[k]` 且 `k` 绑定到顶层字面量 const ⇒ 该字面量（tsc 的稳定实体名）；
 * - 其余动态计算键 ⇒ undefined（不猜）。
 */
export function memberKeyNameOf(
  node: unknown,
  literalConsts?: ReadonlyMap<string, string>,
): string | undefined {
  const m = node as
    | {
        key?: { type?: string; name?: string; value?: unknown } | undefined;
        computed?: boolean;
      }
    | undefined;
  const k = m?.key;
  if (!k) return undefined;
  if (k.type === "Identifier") {
    if (typeof k.name !== "string") return undefined;
    if (m?.computed === true) return literalConsts?.get(k.name);
    return k.name;
  }
  if (typeof k.value === "string") return k.value;
  if (typeof k.value === "number") return String(k.value);
  return undefined;
}
