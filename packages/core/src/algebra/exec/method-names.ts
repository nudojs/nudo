/**
 * 数组 mutator / 有状态 RegExp 方法名——**唯一事实源**（无依赖叶子：
 * 本文件不 import 任何模块）。
 *
 * 消费方：
 * - transpile/ops.ts（发射面判定：语句位重绑 / lastIndex 写回）
 * - runtime/containers/arr-methods.ts（执行面 isArrMutator）
 * - class/invoke.ts（借用面：字符串接收者定抛 / 数组样接收者就地派发）
 *
 * 发射面与执行面的集合必须同源——两处各自维护曾在 copyWithin/fill 上
 * 漏项（语句位不重绑容器 ⇒ unsound 精确断言）。
 */

/** 数组原地 mutator（语句位要重绑变更后的容器而非返回值） */
export const ARR_MUTATORS = new Set([
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
  return ARR_MUTATORS.has(name) || REGEX_STATEFUL_NAMES.has(name);
}
