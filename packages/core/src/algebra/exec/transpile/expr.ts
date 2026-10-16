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
 */
export { transpileExpression } from "./expr/transpile.ts";
export { transpileShortCircuitExpr } from "./expr/short-circuit.ts";
