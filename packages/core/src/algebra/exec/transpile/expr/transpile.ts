/**
 * 表达式发射主分派（expr 按域拆分之一；各节点类别族在兄弟模块）。
 *
 * 不变量：
 * - 入口顺序：@nudo:replace 替换 → ChainExpression 剥壳 → 可选链整链短路
 *   （./optional-chain.ts）→ Super 接收者 → 按节点类别族路由；未 lowering
 *   的表达式统一 default unsupported（不得假精确 undefined）；
 * - positionRecordWrap 只包一次：内部递归一律经 transpileExpression 入口，
 *   族模块回环经 transpile-dispatch 别名（emitTranspileExpression）；
 * - SSR 加载序陷阱：模块体尾部的 dispatch bind 是加载期副作用——必须直接
 *   import leaf（transpile-dispatch），不经 facade/barrel 中转（vite SSR 下
 *   barrel 再导出不是实例化期绑定）；短路发射（./short-circuit.ts）不由
 *   dispatch 注册，消费方（assignment/operators）直接 import。
 */
import type { Expression, Node } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { matchReplacement } from "../helpers.ts";
import { NudoUnsupportedError } from "../../unsupported.ts";
import { assertionOpsOf, type NudoAssertionOp } from "../../../../strip-types.ts";
import {
  absTypeForTsTypeText,
  entryAbsLiteralSourceOf,
  namedTypeTextsForSource,
  resolveNamedTypeText,
} from "../../../contract/ts-type-shape.ts";
import { tryTranspileOptionalChain } from "./optional-chain.ts";
import { transpileAtomExpr } from "./atom.ts";
import { transpileOperatorExpr } from "./operators.ts";
import { transpileMemberExpr } from "./member.ts";
import { transpileCallExpr } from "./call.ts";
import { transpileObjectExpr } from "./object.ts";
import { transpileAssignmentExpr } from "./assignment.ts";
import { transpileFunctionExpr } from "./function.ts";
import { bindTranspileExpression } from "../transpile-dispatch.ts";
/**
 * 表达式发射入口（位置插桩包装层）。recordPositions 时把
 * Identifier 值读 / 静态成员读的转译输出包 `$nodoPos`——
 * 运行时记 (行, 列) → Abs 并原样返回（语义恒等；无收集
 * 器时直通）。内部递归经本包装——每个子表达式恰包一次。
 */
export function transpileExpression(expr: Expression, opts: TranspileOptions = {}): string {
  const src = transpileExpressionImpl(expr, opts);
  if (!opts.recordPositions || !expr.loc) return src;
  return positionRecordWrap(expr, src);
}

/** 位置插桩包装：Identifier 记自身位；静态成员读记属性位
 * （hover 属性名直读槽位 Abs——对象 Identifier 位由
 * memberPathOf 根插桩另记）；计算成员读记表达式起始位 */
function positionRecordWrap(expr: Expression, src: string): string {
  const loc = expr.loc;
  if (!loc) return src;
  if (expr.type === "Identifier") {
    return `$nodoPos(${src}, ${loc.start.line}, ${loc.start.column})`;
  }
  if (expr.type === "MemberExpression") {
    const m = expr as unknown as {
      computed?: boolean;
      property?: {
        type: string;
        loc?: { start: { line: number; column: number } };
      };
    };
    if (
      m.computed !== true &&
      m.property?.type === "Identifier" &&
      m.property.loc
    ) {
      return `$nodoPos(${src}, ${m.property.loc.start.line}, ${m.property.loc.start.column})`;
    }
    return `$nodoPos(${src}, ${loc.start.line}, ${loc.start.column})`;
  }
  return src;
}

/**
 * BUG-265：断言算子重入保护。
 *
 * 剥除 pass 把 `x as T` / `x!` 折叠成内层表达式，并在同一节点上留下**有序
 * 算子表**（strip-types 的 `nudoAssertOps`）。发射时先按算子表还原断言域，
 * 再正常发射内层表达式；重入集合让「发射内层」那一次跳过本处理器（否则
 * 同一节点无限递归），不改写 AST（旁路保持，重复发射同一棵树结果一致）。
 */
const assertionEmissionInProgress = new WeakSet<object>();

/** 断言算子的发射：最内层先求值，算子按内→外顺序叠加。 */
function transpileAssertionOps(expr: Expression, ops: readonly NudoAssertionOp[], opts: TranspileOptions): string {
  assertionEmissionInProgress.add(expr as object);
  let src: string;
  try {
    src = transpileExpression(expr, opts);
  } finally {
    assertionEmissionInProgress.delete(expr as object);
  }
  const namedTypes = opts.source ? namedTypeTextsForSource(opts.source) : undefined;
  for (const op of ops) {
    if (op.kind === "nonnull") {
      // 非空断言：剥 null / undefined 臂（既有窄化算子）。
      src = `$removeNullish(${src})`;
      continue;
    }
    // `as T` / `<T>x`：映射不到（具名类 / 泛型实例 / 不可序列化 Abs）⇒ 保留
    // 内层值（与旧解包口径一致，不伪造声明域）。
    const mapped = absTypeForTsTypeText(resolveNamedTypeText(op.text, namedTypes));
    const literal = entryAbsLiteralSourceOf(mapped);
    if (literal === undefined) continue;
    // 内层仍求值（副作用 / throws 域保留）：声明域取 `$declDomain` 的
    // shape，值证据（term / pred）保留内层——`1 as number` 仍是值 1，
    // `v as string` 仍是 v 的值（不是把值替换成声明域对象）。
    src = `$declDomain(${literal}, ${src})`;
  }
  return src;
}

function transpileExpressionImpl(expr: Expression, opts: TranspileOptions = {}): string {
  // @nudo:replace：节点源码文本匹配则换成注入变量
  const rep = matchReplacement(expr as Node, opts);
  if (rep) return rep;
  if (!assertionEmissionInProgress.has(expr as object)) {
    const ops = assertionOpsOf(expr);
    if (ops && ops.length > 0) return transpileAssertionOps(expr, ops, opts);
  }
  // ChainExpression 不在 Expression 联合里，先剥一层；Babel 8 将 Super 移出 Expression
  const anyExpr = expr as unknown as { type: string; expression?: Expression };
  if (anyExpr.type === "ChainExpression" && anyExpr.expression) {
    return transpileExpression(anyExpr.expression, opts);
  }
  // 可选链整链短路（?. 命中 nullish 时剩余链不再求值）
  const chainSrc = tryTranspileOptionalChain(expr, opts);
  if (chainSrc !== undefined) return chainSrc;
  if (anyExpr.type === "Super") {
    // Bug 14：静态方法体——super 接收者是父类构造器（classSpecOf 注入
    // extends 表达式源）。发此源落通用 $get/$invoke 路径（super.p /
    // super.m() / super[k] 一并覆盖）。
    if (opts.staticSuperSrc) return opts.staticSuperSrc;
    return `/* super */`;
  }
  switch (expr.type) {
    // 原子/字面量族（./atom.ts）
    case "NumericLiteral":
    case "StringLiteral":
    case "BooleanLiteral":
    case "BigIntLiteral":
    case "NullLiteral":
    case "Identifier":
    case "ThisExpression":
    case "RegExpLiteral":
    case "TemplateLiteral":
    case "TaggedTemplateExpression":
    case "MetaProperty":
    case "ImportExpression":
    case "JSXElement":
    case "JSXFragment":
      return transpileAtomExpr(expr, opts);
    // 函数/类表达式族（./function.ts）
    case "ClassExpression":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return transpileFunctionExpr(expr, opts);
    // 运算符/条件族（./operators.ts）
    case "LogicalExpression":
    case "ConditionalExpression":
    case "BinaryExpression":
    case "UnaryExpression":
    case "UpdateExpression":
    case "AwaitExpression":
    case "YieldExpression":
    case "SequenceExpression":
      return transpileOperatorExpr(expr, opts);
    // 成员读族（./member.ts）
    case "MemberExpression":
    case "OptionalMemberExpression":
      return transpileMemberExpr(expr, opts);
    // 调用族（./call.ts）
    case "NewExpression":
    case "CallExpression":
    case "OptionalCallExpression":
      return transpileCallExpr(expr, opts);
    // 对象/数组/展开族（./object.ts）
    case "ObjectExpression":
    case "ArrayExpression":
      return transpileObjectExpr(expr, opts);
    // 赋值族（./assignment.ts）
    case "AssignmentExpression":
      return transpileAssignmentExpr(expr, opts);
    default:
      // 未 lowering 的表达式：
      // 静默折 $lit(void 0) 是假精确——抛 unsupported 交消费方回落
      throw new NudoUnsupportedError(
        `expression:${expr.type}`,
        expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
      );
  }
}

// Register leaf dispatch so stmt/emit/member-path need not import this module.
bindTranspileExpression(transpileExpression);
