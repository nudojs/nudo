/**
 * @nudo:as / @nudo:replace 指令匹配面（transpile helper 叶）。
 *
 * 不变量（@nudo:as / @nudo:replace 指令面）：
 * - **作用范围按 AST 节点身份**（源文本字符区间 [start, end)）判定，
 *   不是「同一行号窗口」：多行语句 / 嵌套块 / 同行下一条语句都不再被命中
 *   （Bug 166）。as 的目标是**承载指令的那条语句**；replace 的目标是该
 *   语句子树内、**不跨作用域边界**的子表达式节点（边界在收集面划定）。
 * - **replace 命中的子表达式仍要求值**（副作用与 throws 域保留），只是
 *   结果被注入值取代（Bug 165）；旧口径整段替换 → 副作用与抛错域消失。
 *
 * 模块级状态收敛于本文件：replacingNodes（防替换命中自递归的 WeakSet）。
 * 经 transpile-dispatch 进入表达式发射（原表达式要求值一次）——承自旧
 * helpers.ts 的同一条间接边，不新增环。
 */
import type { Node, Expression } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { emitTranspileExpression } from "../transpile-dispatch.ts";
import { NudoUnsupportedError } from "../../unsupported.ts";

/**
 * Bug 166：@nudo:as 的作用范围 = **承载指令的那条语句**（节点身份：源文本
 * 字符区间 [stmtStart, stmtEnd)），不是「整条语句的行区间」窗口。
 *
 * 旧口径 `line >= a.stmtStart && line <= a.stmtEnd`（只看行号）会让多行语句
 * （if 块 / 多行 const）内部的嵌套语句、以及同行的下一条语句都被误覆盖——
 * 违反文档「only affects the immediately following statement」。
 *
 * Bug 635：**export 包装**形态的载体身份。`// @nudo:as string()` 写在
 * `export const raw = 1;` 前面时，指令的载体节点是 **ExportNamedDeclaration**
 * （Babel 把前置注释挂在 export 语句上），而转译面拿到的声明节点是**内层**
 * `VariableDeclaration` ⇒ 两个字符区间不重合 ⇒ 覆盖**匹配不到** ⇒
 * 工具打印「Bindings applied」却类型不变（假成功）。
 *
 * 修法：补一条「export 前缀」匹配——**尾端相同**（export 语句与其内层声明
 * 同一处结尾）+ **前缀恰是 export 引导词**（`export ` / `export default `）
 * ⇒ 命中。前缀用源文本核对（`opts.source`），避免「同尾不同语句」误命中。
 */
export function matchAsOverride(stmt: Node, opts: TranspileOptions): string | null {
  if (!opts.asOverrides?.length) return null;
  if (typeof stmt.start !== "number" || typeof stmt.end !== "number") return null;
  for (const a of opts.asOverrides) {
    if (a.stmtStart === stmt.start && a.stmtEnd === stmt.end) return a.varName;
    if (
      a.stmtEnd === stmt.end &&
      a.stmtStart < stmt.start &&
      isExportWrapperGap(opts.source, a.stmtStart, stmt.start)
    ) {
      return a.varName;
    }
  }
  return null;
}

/**
 * 区间 `[from, to)` 是否**只是 export 引导词**（`export ` / `export default `）。
 *
 * 只认 export 引导词 ⇒ export 语句与其内层声明是「同一处结尾」时才算包装；
 * 其它同尾区间（不同语句凑巧同尾）不误命中。源文本缺失 ⇒ 不认（fail-closed：
 * 退回 Bug 166 的精确匹配口径）。
 */
function isExportWrapperGap(source: string | undefined, from: number, to: number): boolean {
  if (typeof source !== "string") return false;
  if (from < 0 || to > source.length || to <= from) return false;
  return /^export\s+(?:default\s+)?$/.test(source.slice(from, to));
}

export function normWs(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * Bug 165：正在被「求值式替换」展开的节点集合。
 * 替换命中后要把**原表达式**再发射一遍（求值），内层那次发射不得再次
 * 匹配本节点——否则自递归。用 WeakSet（节点身份）而非标志位。
 */
const replacingNodes = new WeakSet<Node>();

/**
 * @nudo:replace 命中面（Bug 165 + Bug 166）。
 *
 * - **Bug 166（作用域）**：命中条件是 **AST 节点身份**——节点的源文本字符
 *   区间与登记区间完全一致（收集面已按「该语句子树内、不跨作用域边界」
 *   圈定候选）。旧口径是「行号窗口 + 文本匹配」→ 泄漏进嵌套语句与同行
 *   下一条语句。
 * - **Bug 165（求值）**：命中的子表达式**仍要求值**（副作用与 throws 域
 *   保留），只是**结果**被注入值取代——旧口径整段替换 → 副作用与抛错域
 *   整段消失（L2 门禁假绿 + 错值）。
 */
export function matchReplacement(node: Node, opts: TranspileOptions): string | null {
  if (!opts.source || !opts.replacements?.length) return null;
  if (replacingNodes.has(node)) return null;
  if (typeof node.start !== "number" || typeof node.end !== "number") return null;
  for (const r of opts.replacements) {
    if (r.stmtStart == null || r.stmtEnd == null) continue;
    if (r.stmtStart !== node.start || r.stmtEnd !== node.end) continue;
    if (normWs(r.target) !== normWs(opts.source.slice(node.start, node.end))) continue;
    return replacedValueSrc(node, r.varName, opts);
  }
  return null;
}

/**
 * Bug 165：原表达式求值一次（副作用 + throws 域保留），结果取注入值。
 * 逗号表达式 `(原表达式, 注入值)`：左值求值后丢弃，右值是本次替换的结果。
 */
function replacedValueSrc(node: Node, varName: string, opts: TranspileOptions): string {
  replacingNodes.add(node);
  try {
    const orig = emitTranspileExpression(node as unknown as Expression, opts);
    return `((${orig}), ${varName})`;
  } catch (e) {
    // 引擎**无法 lowering** 该表达式（unsupported）→ 本就无从求值：退回旧
    // 口径（只给注入值）。否则整模块 fail-closed（unknown）——比修复前更差。
    if (e instanceof NudoUnsupportedError) return varName;
    throw e;
  } finally {
    replacingNodes.delete(node);
  }
}
