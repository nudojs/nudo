/**
 * TS enum 初始化器的常量折叠（源码面扫描）。
 *
 * 只折 TS 允许的「常量 enum 表达式」：字面量 / 负数 / 模板 / 前序成员引用 /
 * 算术 / 位运算 / 字符串拼接。其余（调用、成员访问、外部变量）⇒ undefined：
 * 声明面不猜求值结果，也**绝不**把不可渲染的初始化器当成「无初始化器」去
 * 自增（`enum E { A = 1, B = val() }` 的 B 不是 2）。
 */
import type { SurfaceNode } from "./dts-surface-utils.ts";

export function enumConstValue(
  node: SurfaceNode | undefined,
  members: ReadonlyMap<string, number | string>,
): number | string | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case "StringLiteral":
      return typeof node.value === "string" ? node.value : undefined;
    case "NumericLiteral":
      return typeof node.value === "number" ? node.value : undefined;
    case "Identifier":
      // 同一 enum 内**已折出**的成员引用（`B = A + 1`）；外部绑定不猜。
      return node.name === undefined ? undefined : members.get(String(node.name));
    case "TemplateLiteral": {
      const quasis = (node.quasis as SurfaceNode[] | undefined) ?? [];
      const exprs = (node.expressions as SurfaceNode[] | undefined) ?? [];
      let out = "";
      for (let i = 0; i < quasis.length; i++) {
        const cooked = (quasis[i]?.value as SurfaceNode | undefined)?.cooked;
        if (typeof cooked !== "string") return undefined;
        out += cooked;
        const e = exprs[i];
        if (e !== undefined) {
          const v = enumConstValue(e, members);
          if (v === undefined) return undefined;
          out += String(v);
        }
      }
      return out;
    }
    case "UnaryExpression": {
      const arg = enumConstValue(node.argument as SurfaceNode | undefined, members);
      if (typeof arg !== "number") return undefined;
      if (node.operator === "-") return -arg;
      if (node.operator === "+") return arg;
      if (node.operator === "~") return ~arg;
      return undefined;
    }
    case "ParenthesizedExpression":
      return enumConstValue(node.expression as SurfaceNode | undefined, members);
    case "BinaryExpression": {
      const l = enumConstValue(node.left as SurfaceNode | undefined, members);
      const r = enumConstValue(node.right as SurfaceNode | undefined, members);
      if (l === undefined || r === undefined) return undefined;
      const op = String(node.operator ?? "");
      // `+` 是 enum 里唯一允许字符串的运算符（`"a" + "b"` / `"a" + 1`）
      if (op === "+") {
        if (typeof l === "string" || typeof r === "string") return String(l) + String(r);
        return l + r;
      }
      if (typeof l !== "number" || typeof r !== "number") return undefined;
      switch (op) {
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return l / r;
        case "%":
          return l % r;
        case "**":
          return l ** r;
        case "<<":
          return l << r;
        case ">>":
          return l >> r;
        case ">>>":
          return l >>> r;
        case "&":
          return l & r;
        case "|":
          return l | r;
        case "^":
          return l ^ r;
        default:
          return undefined;
      }
    }
    default:
      return undefined;
  }
}

/** 折出的常量值 → enum 初始化器文本（`String(-0)` 与 tsc 一致为 `0`） */
export function enumInitTextOfValue(value: number | string): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
