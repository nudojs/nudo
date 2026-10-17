/**
 * 运算符 → $op 运行时名映射 + 数组 mutator / 有状态 RegExp 方法表。
 */

export const BIN_OPS: Record<string, string> = {
  "+": "$add",
  "-": "$sub",
  "*": "$mul",
  "/": "$div",
  "%": "$mod",
  "<": "$lt",
  "<=": "$le",
  ">": "$gt",
  ">=": "$ge",
  "===": "$eq",
  "!==": "$ne",
  "==": "$eqLoose",
  "!=": "$neLoose",
  "&": "$bitand",
  "|": "$bitor",
  "^": "$bitxor",
  "<<": "$shl",
  ">>": "$shr",
  ">>>": "$ushr",
  "**": "$pow",
  in: "$in",
};

/** 复合赋值 → 二元运行时（标识符与成员路径统一走读-改-写） */
export const COMPOUND_OPS: Record<string, string> = {
  "+=": "$add",
  "-=": "$sub",
  "*=": "$mul",
  "/=": "$div",
  "%=": "$mod",
  "**=": "$pow",
  "<<=": "$shl",
  ">>=": "$shr",
  ">>>=": "$ushr",
  "&=": "$bitand",
  "|=": "$bitor",
  "^=": "$bitxor",
};


export const ARR_MUTATOR_NAMES = new Set([
  "push",
  "unshift",
  "splice",
  "pop",
  "shift",
  "reverse",
  "sort",
  "copyWithin",
  "fill",
]);

/** RegExp 有状态方法：语句/表达式位置都要把状态更新后的 receiver 重绑
 *  （test/exec 的 lastIndex；Bug 126：compile 重建 source/flags/lastIndex 归 0）。 */
export const REGEX_STATEFUL_NAMES = new Set(["test", "exec", "compile"]);

/** Bug 96：参数位消费 RegExp 状态的 String.prototype 方法——语句位写回镜像
 *  $reStateCall 臂（spec @@match/@replace 对**原正则** Set lastIndex：全局 →
 *  0；非全局 sticky → 单次 exec 推进）。search（先置 0 后恢复）/ split
 *  （不动）/ matchAll（克隆不动原件）不在此列。 */
export const STRING_REGEX_ARG_STATE_NAMES = new Set(["match", "replace", "replaceAll"]);

export function isStatefulMethodName(name: string): boolean {
  return ARR_MUTATOR_NAMES.has(name) || REGEX_STATEFUL_NAMES.has(name);
}
