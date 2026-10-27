/**
 * 表达式发射间接层 — 打断 expr ↔ stmt/emit/member-path 的模块环。
 * expr.ts 在加载时 bind 注册实现；其余模块只依赖本 leaf。
 *
 * 只有表达式入口走 dispatch：短路发射（`./short-circuit.ts`）由消费方
 * （expr/assignment.ts、expr/operators.ts）直接 import——不占 dispatch 槽，
 * 避免「注册了但没人读」的写死槽位。
 */
import type { Expression } from "@babel/types";
import type { TranspileOptions } from "./types.ts";

type ExprFn = (expr: Expression, opts?: TranspileOptions) => string;

type Dispatch = {
  expr?: ExprFn;
};

const dispatch: Dispatch = {};

export function bindTranspileExpression(fn: ExprFn): void {
  dispatch.expr = fn;
}

export function emitTranspileExpression(expr: Expression, opts: TranspileOptions = {}): string {
  const fn = dispatch.expr;
  if (!fn) throw new Error("transpileExpression not bound (expr.ts not loaded)");
  return fn(expr, opts);
}
