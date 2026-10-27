/**
 * 成员读族发射（expr 按域拆分之一；主分派在 ./transpile.ts）。
 *
 * 不变量：
 * - super 读三分支：类实例方法 $getSuper / 对象字面量方法 $getSuperObj /
 *   静态方法体不拦截（Super 节点已发父类构造器源）；
 * - 宿主 Symbol 常量键（m[Symbol.iterator]）投影 "@@name" 字符串键，
 *   并带 symbolKey 标记（陷阱边界还原成真 symbol——Bug 149）；
 * - 私有名（this.#x / C.#x）→ "#x" 混淆键槽（公有名不含 "#"，无碰撞）；
 * - 写目标的重绑路径在 ./assignment.ts（member-path 写回链），此处只读。
 */
import type { Expression, MemberExpression, Node, OptionalMemberExpression } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { emitMemberKey } from "../member-key.ts";
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
      // o.length：静态属性走 $len（长度/诊断通道，不是普通槽读）。
      if (!expr.computed && expr.property.type === "Identifier" && expr.property.name === "length") {
        return `$len(${transpileExpression(expr.object as Expression, opts)})`;
      }
      const memberKey = emitMemberKey(
        expr.property as Node,
        expr.computed === true,
        opts,
      );
      if (memberKey === null) {
        const ptype = (expr.property as { type?: string }).type ?? "unknown";
        throw new NudoUnsupportedError(
          `member:${expr.computed ? "computed" : ptype}`,
          expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
        );
      }
      const recv = transpileExpression(expr.object as Expression, opts);
      if (memberKey.kind === "get") {
        const key = JSON.stringify(memberKey.key);
        // Bug 149：符号投影键带 symbolKey 标记——Proxy 陷阱边界据此把
        // "@@name" 还原成真 symbol（字面量串键 "@@name" 不带标记）。
        const opt = memberKey.symbol !== undefined ? `, { symbolKey: true }` : "";
        return optional
          ? `$optionalGet(${recv}, ${key}${opt})`
          : `$get(${recv}, ${key}${opt})`;
      }
      if (memberKey.constNumber !== undefined) {
        return optional
          ? `$optionalGet(${recv}, ${JSON.stringify(String(memberKey.constNumber))})`
          : `$idx(${recv}, ${memberKey.keySrc})`;
      }
      return `$idx(${recv}, ${memberKey.keySrc})`;
    }
  }
}
