/**
 * 表达式发射：transpileExpression / transpileShortCircuitExpr。
 * 按域拆分（facade 保持原导入面不变）：
 * - transpile      主分派（replace/Chain/可选链入口/switch 路由 + dispatch bind）
 * - short-circuit  $fork 短路协议（&&/||/??/三元/逻辑赋值）
 * - optional-chain 可选链整链短路（flatten/emit/delete 链）
 * - atom           字面量/标识符/模板/import()/JSX
 * - operators      二元逻辑/条件/一元/更新/await/yield/序列
 * - member         成员读（静态/计算/私有名/length/super 读）
 * - call           调用/new/super 调用/require
 * - object         对象/数组字面量与展开
 * - assignment     赋值/复合赋值/逻辑赋值/解构赋值
 * - function       函数/类表达式 + 参数模式名
 *
 * 本文件是**表达式入口**（公开面）：`transpileExpression` 在此补遮蔽判定
 * （见下方函数注释）——主分派（./expr/transpile.ts）保持纯发射。
 */
import type { Expression } from "@babel/types";
import type { TranspileOptions } from "./types.ts";
import { shadowedIntrinsicsOf } from "./helpers.ts";
import { transpileExpression as transpileExpressionImpl } from "./expr/transpile.ts";

export { transpileShortCircuitExpr } from "./expr/short-circuit.ts";

/**
 * 表达式入口（公开面）：**遮蔽判定**补声明扫描。
 *
 * 宿主内建名（undefined / NaN / Infinity）的读点按遮蔽分态（未遮蔽 → 字面量
 * 精确折叠；已遮蔽 → 标识符读点 `$absVal`，由 JS 词法绑定决定读值）。模块
 * 入口（transpileFile / transpileBodyNode / body-fn）按**单元级**扫描声明
 * 绑定名判定；表达式入口此前只信调用方给的 `opts.shadowedIntrinsics` ⇒ 表达
 * 式**内部**的声明（形参名 undefined / 局部 let / const / var / catch 参数）
 * 不可见 ⇒ 体折宿主内建（原生读的是绑定值 ⇒ 自信的错值）。
 *
 * 口径与模块入口同源（helpers.ts 的 shadowedIntrinsicsOf）：单元级**保守**
 * 扫描（任意作用域出现同名绑定即计入）∪ 调用方已给的遮蔽集（注入名 / mock）。
 * 无命中 → 不写 opts 字段 ⇒ 产物逐字节不变。
 */
export function transpileExpression(expr: Expression, opts: TranspileOptions = {}): string {
  const shadowed = shadowedIntrinsicsOf(expr, opts.shadowedIntrinsics);
  return transpileExpressionImpl(expr, shadowed ? { ...opts, shadowedIntrinsics: shadowed } : opts);
}
