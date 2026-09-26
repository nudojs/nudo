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

/** RegExp 有状态方法：语句/表达式位置都要把 lastIndex 更新后的 receiver 重绑 */
export const REGEX_STATEFUL_NAMES = new Set(["test", "exec"]);

export function isStatefulMethodName(name: string): boolean {
  return ARR_MUTATOR_NAMES.has(name) || REGEX_STATEFUL_NAMES.has(name);
}
