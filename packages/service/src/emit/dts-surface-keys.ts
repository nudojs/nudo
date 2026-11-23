/**
 * 源码面**计算键**的静态折叠。
 *
 * 顶层 `const KEY = "x"` 的稳定字面量值，以及 `["a" + "b"]` / `` [`x${"y"}`] ``
 * 这类静态可判的字符串拼接。动态键（变量 / 成员表达式 / 调用）返回 undefined
 * ——声明面不猜，也不把不可判的键假造成员。
 */
import { parseSource } from "@nudojs/core";
import type { SurfaceNode } from "./dts-surface-utils.ts";

const literalConstKeyMemo = new Map<string, ReadonlyMap<string, string>>();
const LITERAL_CONST_KEY_MEMO_MAX = 8;

/** 顶层 `const x = <字符串/数字字面量>` 的稳定值（BUG-385，按源码 memo）。 */
export function literalConstKeysOf(source: string | undefined): ReadonlyMap<string, string> {
  if (source === undefined) return new Map();
  const hit = literalConstKeyMemo.get(source);
  if (hit) return hit;
  const out = new Map<string, string>();
  try {
    const ast = parseSource(source, { errorRecovery: true, keepTs: true }) as unknown as {
      program: { body: Array<Record<string, unknown>> };
    };
    for (const raw of ast.program.body) {
      const stmt =
        raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration"
          ? ((raw.declaration as Record<string, unknown> | undefined) ?? raw)
          : raw;
      if (stmt.type !== "VariableDeclaration" || stmt.kind !== "const") continue;
      for (const d of (stmt.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
        const id = d.id as { type?: string; name?: string } | undefined;
        const init = d.init as { type?: string; value?: unknown } | null | undefined;
        if (id?.type !== "Identifier" || typeof id.name !== "string" || !init) continue;
        if (init.type === "StringLiteral" && typeof init.value === "string") {
          out.set(id.name, init.value);
        } else if (init.type === "NumericLiteral" && typeof init.value === "number") {
          out.set(id.name, String(init.value));
        }
      }
    }
  } catch {
    // 解析失败 ⇒ 空表（调用方按动态键处理）
  }
  if (literalConstKeyMemo.size >= LITERAL_CONST_KEY_MEMO_MAX) {
    const oldest = literalConstKeyMemo.keys().next().value;
    if (oldest !== undefined) literalConstKeyMemo.delete(oldest);
  }
  literalConstKeyMemo.set(source, out);
  return out;
}

/**
 * BUG-119：类成员**计算键**的静态名（`["a" + "b"]` / `` [`x${"y"}`] ``）。
 * 只折静态可判的字符串拼接/模板；动态键（变量 / 成员表达式）返回 undefined
 * （不猜 ⇒ 不假造成员）。旧实现只认 Identifier/StringLiteral ⇒ 整条成员丢失。
 */
export function surfaceComputedKeyName(n: SurfaceNode | undefined): string | undefined {
  if (!n) return undefined;
  if (n.type === "StringLiteral" && typeof n.value === "string") return n.value;
  if (n.type === "NumericLiteral" && typeof n.value === "number") return String(n.value);
  if (n.type === "TemplateLiteral") {
    const exprs = (n.expressions as SurfaceNode[] | undefined) ?? [];
    const quasis = (n.quasis as SurfaceNode[] | undefined) ?? [];
    if (exprs.length === 0 && quasis.length === 1) {
      const cooked = (quasis[0]?.value as SurfaceNode | undefined)?.cooked;
      return typeof cooked === "string" ? cooked : undefined;
    }
    // 静态可折的 `${"a"}`：逐段拼
    let out = "";
    for (let i = 0; i < quasis.length; i++) {
      const cooked = (quasis[i]?.value as SurfaceNode | undefined)?.cooked;
      if (typeof cooked !== "string") return undefined;
      out += cooked;
      const e = exprs[i];
      if (e) {
        const v = surfaceComputedKeyName(e);
        if (v === undefined) return undefined;
        out += v;
      }
    }
    return out;
  }
  if (n.type === "BinaryExpression" && n.operator === "+") {
    const l = surfaceComputedKeyName(n.left as SurfaceNode | undefined);
    const r = surfaceComputedKeyName(n.right as SurfaceNode | undefined);
    return l !== undefined && r !== undefined ? l + r : undefined;
  }
  return undefined;
}
