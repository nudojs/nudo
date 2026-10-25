/**
 * 运算符 → $op 运行时名映射；数组 mutator / 有状态 RegExp 方法名表在
 * exec/method-names.ts（无依赖叶子，执行面 arr-methods 共用），此处 re-export
 * 维持既有 import 面。
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


export {
  ARR_MUTATORS as ARR_MUTATOR_NAMES,
  REGEX_STATEFUL_NAMES,
  STRING_REGEX_ARG_STATE_NAMES,
  isStatefulMethodName,
} from "../method-names.ts";
