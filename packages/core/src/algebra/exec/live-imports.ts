/**
 * ESM live import 绑定（Bug ②）：import 绑定是间接引用，非绑定时刻快照。
 *
 * 机制：每个带绑定的 import 模块在求值时注册一个 refresh 闭包（闭包内
 * 逐个重赋值本模块的 import `let` 绑定 = cell 重读）；`$call` 出口统一
 * 触发 refresh——依赖模块状态的变异只能经跨模块函数调用发生（顶层求值
 * 先于 import 绑定；导出函数调用必经 $call 派发），调用返回即重读，
 * 与 ESM「读取时解析依赖当前值」等价。
 *
 * 无限重入安全：refresh 闭包只做属性读取与绑定重赋值（bindImport /
 * bindNamespace / named getter 均 pure），不发起新的 $call。
 * TDZ 容忍：import 语句文本位置先于顶层调用时（exec 模式罕见形态），
 * refresh 命中未初始化 `let` 抛 ReferenceError——吞掉即可（该绑定创建时
 * 读到的已是变异后当前值，无需 refresh）。
 *
 * 叶子模块（无依赖）：run.ts（注册）与 call.ts（触发）共用，避免环。
 */

const refreshers: Array<() => void> = [];

/** 模块求值时注册本模块的 import 绑定 refresh 闭包（transpile 产物注入） */
export function registerLiveImportRefresh(fn: () => void): void {
  refreshers.push(fn);
}

/** $call 出口触发：全部已注册模块的 import 绑定重读依赖当前导出值 */
export function refreshLiveImports(): void {
  if (refreshers.length === 0) return;
  for (const fn of refreshers) {
    try {
      fn();
    } catch {
      /* TDZ / 模块域异常：绑定创建时读当前值即正确，跳过本轮 */
    }
  }
}

/** 每轮模块图求值入口清空：上一轮 refresh 闭包只指向已死模块作用域，
 * 语义无害但滞留膨胀；新图重新注册（evalAbsModuleGraph 入口调用）。 */
export function clearLiveImportRefreshers(): void {
  refreshers.length = 0;
}
