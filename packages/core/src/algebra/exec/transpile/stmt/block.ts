/**
 * 块 thunk 化与 for-init 提名（stmt 按域拆分之一）。
 *
 * 不变量：
 * - 循环体/条件臂内的 return 是函数提前返回，不是 thunk 的表达式值——
 *   $loopReturn 走函数退出侧信道（裸 JS return 的 thunk 值会被语句位 $fork
 *   丢弃）；
 * - return 表达式推导 hover 键 = return 关键字起始位（裸 return 不记录）；
 * - extractForInitName：var init 与多声明 init 必须返回 null 走 fallback
 *   （var 是函数作用域共享绑定；多声明静默丢剩余声明是错误）。
 */
import type { Expression, Statement } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { indent } from "../helpers.ts";
import { emitTranspileExpression } from "../transpile-dispatch.ts";
import { transpileFnBodyStmts } from "./fn-body.ts";
import { transpileStatement } from "./statement.ts";
/**
 * setter thunk 发射（类访问器与对象字面量访问器共用）：
 * - 体包内层箭头：原生 setter 返回值被丢弃（赋值表达式值 = RHS），thunk 契约
 *   恒返回接收者——体内早退 if 提升（return $fork）/裸 return/带值 return/
 *   throw 臂的 joined 臂值不得顶掉接收者（否则 $set 把接收者重绑成臂值，
 *   F3：裸 return 折 undefined → 后续成员读 TypeError）。
 * - 接收者回收：体内经**别名绑定**写接收者（`o._v = v` / `C._v = v`——标识符根
 *   的成员写进 fork 协议，早退 if 提升时臂 copy/join 会重绑别名绑定）时，赋值点
 *   `root = $set(root, …)` 拿过时的 __this 重绑会把 join 结果冲掉（成员读折
 *   undefined）。尾部回收：入参时值 === __this 且体内跑完后分叉了的别名绑定
 *   就是更新后的接收者，返回它（未分叉 / 非接收者别名 / 继承派发的父类写
 *   都原样 return __this）。
 */
export function transpileBlockAsThunk(stmt: Statement, depth: number, opts: TranspileOptions): string {
  if (stmt.type === "BlockStatement") {
    const inner = transpileFnBodyStmts(stmt.body, depth + 1, opts);
    return `() => {\n${inner}\n${indent(depth)}}`;
  }
  if (stmt.type === "ReturnStatement") {
    const v = stmt.argument ? emitTranspileExpression(stmt.argument, opts) : "$lit(void 0)";
    // return 表达式推导 hover：单语句 if 臂 return 快路径同 emitRet
    // 口径记录（键 = return 关键字起始位；裸 return 不记录）
    const rec =
      opts.recordPositions && stmt.argument?.loc && stmt.loc
        ? `$nodoPos(${v}, ${stmt.loc.start.line}, ${stmt.loc.start.column})`
        : v;
    // C2.1：循环体内的 return 是函数提前返回，不是 thunk 的表达式值。
    // if 臂 thunk 内（conditionalFlow>0）同口径——$loopReturn 走函数退出
    // 侧信道，裸 JS return 的 thunk 值会被语句位 $fork 丢弃。
    if ((opts.inLoop ?? 0) > 0 || (opts.conditionalFlow ?? 0) > 0) {
      return `() => { $loopReturn(${rec}); }`;
    }
    return `() => ${rec}`;
  }
  const one = transpileStatement(stmt, depth + 1, opts);
  return `() => {\n${one}\n${indent(depth)}}`;
}

export function extractForInitName(init: Statement | Expression | null | undefined): string | null {
  if (!init || init.type !== "VariableDeclaration") return null;
  // `var` 是函数作用域共享绑定——不得走每迭代参数槽（闭包会误做成 per-iteration）。
  // 返回 null 路由到 fallback：init 就地发射，test/update/body 读真实绑定。
  if (init.kind === "var") return null;
  // 多声明 `let i = 0, j = 10`：主路径只发射 declarations[0]，其余声明（及其
  // 初始化副作用）被静默丢弃，剩余标识符成自由变量（运行期 ReferenceError）。
  // 路由 fallback——经 transpileStatement 发射完整多声明 init。
  if (init.declarations.length !== 1) return null;
  const d = init.declarations[0];
  return d?.id.type === "Identifier" ? d.id.name : null;
}
