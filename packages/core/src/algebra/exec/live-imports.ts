/**
 * ESM live import 绑定（Bug ②）：import 绑定是间接引用，非绑定时刻快照。
 *
 * 机制：每个带绑定的 import 模块在求值时注册一个 refresh 闭包（闭包内
 * 逐个重赋值本模块的 import `let` 绑定 = cell 重读）；`$call` 出口与
 * 宿主调用入口统一触发 refresh——依赖模块状态的变异只能经跨模块函数调用
 * 发生（顶层求值先于 import 绑定；导出函数调用必经 $call 派发），调用
 * 返回即重读，与 ESM「读取时解析依赖当前值」等价。
 *
 * 无限重入安全：refresh 闭包只做属性读取与绑定重赋值（bindImport /
 * bindNamespace / named getter 均 pure），不发起新的 $call。
 * TDZ 容忍：import 语句文本位置先于顶层调用时（exec 模式罕见形态），
 * refresh 命中未初始化 `let` 抛 ReferenceError——吞掉即可（该绑定创建时
 * 读到的已是变异后当前值，无需 refresh）。
 *
 * 存活口径（Bug 456）：注册表持**弱引用**——refresh 闭包由模块作用域
 * 持有（transpile 产物把闭包存进模块域变量），模块域随其 run 表一起
 * 不可达即被回收，注册表随之丢弃该闭包。强引用会让「模块域」永不释放
 * （注册表 → 闭包 → 模块域 → run 表 → 导出表）——长会话（LSP 逐键
 * 重分析）下无界滞留。
 *
 * 不再按「每轮模块图求值」清空：模块实例会被会话缓存（abs-module 缓存 /
 * evaluator run 缓存）跨轮复用，其 refresh 闭包仍须活着——清了它，跨模块
 * import 绑定就永久停在绑定时刻的快照（ESM import 环里先求值的一侧绑定到
 * unknown，且此后无人再刷新）。清理由「模块域死」自然完成（弱引用回收），
 * 或由 clearLiveImportRefreshers 显式清（会话缓存全清时）。
 *
 * 叶子模块（无依赖）：run.ts（注册）与 call.ts / run.ts（触发）共用，避免环。
 */

const refreshers: Array<WeakRef<() => void>> = [];

/** 模块求值时注册本模块的 import 绑定 refresh 闭包（transpile 产物注入） */
export function registerLiveImportRefresh(fn: () => void): void {
  refreshers.push(new WeakRef(fn));
}

/** 调用边界触发：全部**存活**模块的 import 绑定重读依赖当前导出值 */
export function refreshLiveImports(): void {
  if (refreshers.length === 0) return;
  let keep = 0;
  for (let i = 0; i < refreshers.length; i++) {
    const ref = refreshers[i]!;
    const fn = ref.deref();
    // 模块域已死（run 表不再可达）→ 该闭包无须再刷新，丢弃引用
    if (!fn) continue;
    refreshers[keep++] = ref;
    try {
      fn();
    } catch {
      /* TDZ / 模块域异常：绑定创建时读当前值即正确，跳过本轮 */
    }
  }
  refreshers.length = keep;
}

/** 会话缓存全清时显式清空注册表（模块域随之死；弱引用本会自动回收，
 *  这里是让「下一轮」的注册表从空开始，避免残留弱引用条目）。 */
export function clearLiveImportRefreshers(): void {
  refreshers.length = 0;
}
