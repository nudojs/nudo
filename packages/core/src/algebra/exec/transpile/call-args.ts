/**
 * 调用实参发射的单一实现。
 *
 * 此前 `expr/call.ts` 内联了 8 份相同的 `SpreadElement → ...$elems(...)`
 * 映射；可选链的 `flattenChain` 又维护了第 9 份，且把 spread 折成
 * `$unknown()`（实参个数错误）。所有调用面统一走本模块。
 */
import type { Expression, SpreadElement } from "@babel/types";
import type { TranspileOptions } from "./types.ts";
import { emitTranspileExpression } from "./transpile-dispatch.ts";

/** 发射实参列表（不含外层方括号）；spread 统一展开为 `...$elems(<expr>)`。 */
export function emitArgList(
  args: readonly unknown[],
  opts: TranspileOptions,
): string {
  return args
    .map((arg) => {
      const a = arg as { type?: string };
      if (a?.type === "SpreadElement") {
        return `...$elems(${emitTranspileExpression((arg as SpreadElement).argument as Expression, opts)})`;
      }
      return emitTranspileExpression(arg as Expression, opts);
    })
    .join(", ");
}
