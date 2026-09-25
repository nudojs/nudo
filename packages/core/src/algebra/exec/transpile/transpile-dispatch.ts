/**
 * 表达式发射间接层 — 打断 expr ↔ stmt/emit/member-path 的模块环。
 * expr.ts 在加载时 bind 注册实现；其余模块只依赖本 leaf。
 */
import type { Expression, Node } from "@babel/types";
import type { TranspileOptions } from "./types.ts";

export type ShortCircuitParts = {
  alwaysNodes: Array<Node | null | undefined>;
  alwaysSrc: string;
  /** cons 臂表达式源；null 表示复用 __test（&&/|| 的短路返回侧） */
  consSrc: string;
  consNodes: Array<Node | null | undefined>;
  /** alt 臂表达式源；null 表示复用 __test */
  altSrc: string;
  altNodes: Array<Node | null | undefined>;
  /** 覆盖 $fork 测试表达式（?? 用 $nullishTest(left)） */
  testSrc?: string;
};

type ExprFn = (expr: Expression, opts?: TranspileOptions) => string;
type ShortCircuitFn = (opts: TranspileOptions, parts: ShortCircuitParts) => string;

type Dispatch = {
  expr?: ExprFn;
  shortCircuit?: ShortCircuitFn;
};

const dispatch: Dispatch = {};

export function bindTranspileExpression(fn: ExprFn): void {
  dispatch.expr = fn;
}

export function bindTranspileShortCircuit(fn: ShortCircuitFn): void {
  dispatch.shortCircuit = fn;
}

export function emitTranspileExpression(expr: Expression, opts: TranspileOptions = {}): string {
  const fn = dispatch.expr;
  if (!fn) throw new Error("transpileExpression not bound (expr.ts not loaded)");
  return fn(expr, opts);
}

export function emitTranspileShortCircuit(
  opts: TranspileOptions,
  parts: ShortCircuitParts,
): string {
  const fn = dispatch.shortCircuit;
  if (!fn) throw new Error("transpileShortCircuitExpr not bound (expr.ts not loaded)");
  return fn(opts, parts);
}
