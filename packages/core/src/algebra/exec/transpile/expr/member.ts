/**
 * 成员读族发射（expr 按域拆分之一；主分派在 ./transpile.ts）。
 *
 * 不变量：
 * - super 读三分支：类实例方法 $getSuper / 对象字面量方法 $getSuperObj /
 *   静态方法体不拦截（Super 节点已发父类构造器源）；
 * - 宿主 Symbol 常量键（m[Symbol.iterator]）投影 "@@name" 字符串键；
 * - 私有名（this.#x / C.#x）→ "#x" 混淆键槽（公有名不含 "#"，无碰撞）；
 * - 写目标的重绑路径在 ./assignment.ts（member-path 写回链），此处只读。
 */
import type { Expression, MemberExpression, OptionalMemberExpression } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { isExpression, privateNameKeySrc } from "../helpers.ts";
import { NudoUnsupportedError } from "../../unsupported.ts";
import { emitTranspileExpression as transpileExpression } from "../transpile-dispatch.ts";
/**
 * 成员读族：静态/计算/私有名/length 读与 super 属性读（三分支）。
 */
export function transpileMemberExpr(
  expr:
    | MemberExpression
    | OptionalMemberExpression,
  opts: TranspileOptions = {},
): string {
  switch (expr.type) {
    case "MemberExpression":
    case "OptionalMemberExpression": {
      const optional = (expr as { optional?: boolean }).optional === true;
      // super.p / super[k] 属性读（Bug 14/19）：
      // - 类实例方法 → $getSuper（父类链访问器/方法，receiver = this）
      // - 对象字面量方法 → $getSuperObj（home object 原型链，排除自有）
      // - 静态方法体 → 不拦截：Super 节点已发父类构造器源，落通用 $get
      if (expr.object.type === "Super" && opts.thisParam && !opts.staticSuperSrc) {
        const keySrc = expr.computed
          ? transpileExpression(expr.property as Expression, opts)
          : `$lit(${JSON.stringify((expr.property as { name: string }).name)})`;
        if (opts.className) {
          return `$getSuper(${opts.thisParam}, ${JSON.stringify(opts.className)}, ${keySrc})`;
        }
        return `$getSuperObj(${opts.thisParam}, ${keySrc})`;
      }
      if (expr.computed) {
        const obj = transpileExpression(expr.object as Expression, opts);
        const key = expr.property;
        if (key.type === "StringLiteral") {
          return optional
            ? `$optionalGet(${obj}, ${JSON.stringify(key.value)})`
            : `$get(${obj}, ${JSON.stringify(key.value)})`;
        }
        if (key.type === "NumericLiteral") {
          return optional
            ? `$optionalGet(${obj}, ${JSON.stringify(String(key.value))})`
            : `$idx(${obj}, $lit(${key.value}))`;
        }
        // 宿主 Symbol 常量键（m[Symbol.iterator]）：投影为 "@@name" 字符串键，
        // runtime $get 对内建 brand 解析为可 typeof 的方法形状
        if (
          key.type === "MemberExpression" &&
          key.computed !== true &&
          key.object.type === "Identifier" &&
          key.object.name === "Symbol" &&
          key.property.type === "Identifier"
        ) {
          const symKey = JSON.stringify(`@@${key.property.name}`);
          return optional ? `$optionalGet(${obj}, ${symKey})` : `$get(${obj}, ${symKey})`;
        }
        if (isExpression(key)) {
          const k = transpileExpression(key, opts);
          return `$idx(${obj}, ${k})`;
        }
        // 计算属性键非 Expression：抛 unsupported 交消费方回落（不得假精确 undefined）
        throw new NudoUnsupportedError(
          `member:computed`,
          expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
        );
      }
      if (expr.property.type === "PrivateName") {
        // Bug 78：this.#x / C.#x → "#x" 混淆键槽读写（公有名不含 "#"，
        // 无碰撞）；不再抛 unsupported 令整模块 fail-closed
        const recv = transpileExpression(expr.object as Expression, opts);
        const key = privateNameKeySrc(
          expr.property as { id?: { name?: string }; name?: string },
        );
        if (!key) {
          throw new NudoUnsupportedError(
            `member:PrivateName`,
            expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
          );
        }
        return optional ? `$optionalGet(${recv}, ${key})` : `$get(${recv}, ${key})`;
      }
      if (expr.property.type !== "Identifier") {
        // 其余非 Identifier 属性：抛 unsupported 交消费方回落
        const ptype = (expr.property as { type: string }).type;
        throw new NudoUnsupportedError(
          `member:${ptype}`,
          expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
        );
      }
      // o.length
      if (expr.property.name === "length") {
        return `$len(${transpileExpression(expr.object as Expression, opts)})`;
      }
      const recv = transpileExpression(expr.object as Expression, opts);
      const key = JSON.stringify(expr.property.name);
      return optional ? `$optionalGet(${recv}, ${key})` : `$get(${recv}, ${key})`;
    }
  }
}
