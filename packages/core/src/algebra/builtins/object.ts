/**
 * Object.assign 非 obj 源键投影 + Object.* 静态方法
 * （facade 保持原导入面不变）。
 *
 * 按域拆分：
 * - descriptor    assign/defineProperty 描述符机器 + readProperty（[[Get]] 收口）
 * - enum-entries  枚举视图接收者键投影 + groupBy 折叠（foldGroupBy）
 * - methods       evalObjectMethod —— Object.* 静态面大分派
 */
export {
  assignSourceSlots,
  primTargetAssignThrows,
  mkPropDescAbs,
  maybePropDescAbs,
  readProperty,
} from "./object/descriptor.ts";
export { foldGroupBy, type GroupByFold } from "./object/enum-entries.ts";
export { evalObjectMethod } from "./object/methods.ts";
