/**
 * 模块级 collector / 分析可变状态的 AsyncLocalStorage 作用域原语（叶子模块）。
 *
 * 历史形态：collector 是模块级单变量，靠 set → finally → restore 配对维持。
 * 同步路径下单线程 + 栈式 save/restore 足够；但宿主入口（LSP validateText /
 * analyzeFileAsync）在 **await 窗口**（path-env 预载、防抖、发布前检查）会让
 * 另一次分析的 set/排干交错进来——两轮「await 窗口偷诊断」事故的根因。
 *
 * 收敛形态（调用方零改动）：
 * - 每个状态点改为 `createScopedSlot` / `createScopedDiagChannel`：
 *   无作用域时读写模块级 fallback（**行为 = 今日**），公共 setter/getter
 *   签名不变；既有 save/restore 配对在作用域内同样正确（写最内层 store）。
 * - 分析入口包 `runWithCollectorScope`：最外层为每个注册的槽/通道开新
 *   store（plain 槽**继承**进入时的当前值，通道**空缓冲 + 继承观察者**），
 *   await 后自然续在原 store，交错分析各开各的，互不串台。幂等：已在
 *   作用域内（同步嵌套 / 同一异步链）直接执行 body，不重复开 store——
 *   嵌套入口（checkSource → runTranspiled → 导出桥）零额外开销地共享
 *   外层作用域，与今日嵌套共享模块全局的语义一致。
 *
 * 先例：algebra/may-throw.ts（runWithMayThrowSession）、exec/member-diag.ts
 * （runWithEvalMissingSlot）——本模块把该形态抽成共享原语。
 */
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 可 ALS 隔离的模块级可变槽。
 * 语义：`get`/`set` 作用于当前最内层 store（无作用域 = fallback）；
 * `runScoped` 以**进入时当前值**为初始值开新 store（继承语义：嵌套
 * save/restore 与今日模块全局逐位一致）。
 */
export type ScopedSlot<T> = {
  get(): T;
  set(v: T): void;
  runScoped<R>(body: () => R): R;
};

export function createScopedSlot<T>(init: () => T): ScopedSlot<T> {
  const als = new AsyncLocalStorage<{ v: T }>();
  const fallback: { v: T } = { v: init() };
  const current = () => als.getStore() ?? fallback;
  return {
    get: () => current().v,
    set: (v: T) => {
      current().v = v;
    },
    runScoped: <R>(body: () => R) => als.run({ v: current().v }, body),
  };
}

/** 作用域参与者：把 body 包进自己那条 ALS store（runWithCollectorScope 组合用） */
export type CollectorScopeParticipant = <R>(body: () => R) => R;

const participants: CollectorScopeParticipant[] = [];

/**
 * 注册一个作用域参与者（模块加载时调用一次）。
 * 参与者未加载 = 其状态本就无人触碰，不注册无影响。
 */
export function registerCollectorScopeParticipant(
  enter: CollectorScopeParticipant,
): void {
  participants.push(enter);
}

const scopeActive = new AsyncLocalStorage<boolean>();

/**
 * 求值轮次（epoch）：**最外层** {@link runWithCollectorScope} 开新作用域时 +1。
 *
 * 为什么需要（BUG-056）：模块求值结果里可能住着**活的模块级 `let` 状态**
 * （generalize.ts / check-may-throw.ts 的 evaluator 缓存直接复用 run 表，
 * 表里就是活的 `let` 绑定）。这种状态只在**一轮分析**内有意义：跨轮复用
 * 等于把上一次分析（例如 analyzer 的一次 generalize）已经 ++ 过的实例递给
 * 下一次（check 闸门）⇒ 同一份源码在不同路径下读出 1 / 2 / 3，且
 * `contract --emit` 与 `check` 永不收敛。缓存键带 epoch ⇒ 每轮重新求值；
 * 嵌套入口走幂等路径共享外层 epoch（不涨轮）。
 */
let evalRoundEpoch = 0;

/** 当前求值轮次（供**按轮**缓存做键；见 {@link runWithCollectorScope}） */
export function currentEvalRoundEpoch(): number {
  return evalRoundEpoch;
}

/**
 * 进入一次完整分析的 collector 生命周期作用域。幂等（已在作用域内 →
 * 直接执行）。body 可返回 Promise：async 续体沿 ALS 链继承 store，
 * await 窗口内交错开启的其它作用域互不可见。
 */
export function runWithCollectorScope<R>(body: () => R): R {
  if (scopeActive.getStore() === true) return body();
  // 逆序组合：participants[0](participants[1](…(body)))——各自把后续包进
  // 自己的 ALS store，作用域标记最外层
  let scoped: () => R = body;
  for (let i = participants.length - 1; i >= 0; i--) {
    const enter = participants[i]!;
    const inner = scoped;
    scoped = () => enter(inner);
  }
  // 新的一轮分析 ⇒ 涨轮（按轮缓存据此作废，见 currentEvalRoundEpoch）
  evalRoundEpoch++;
  return scopeActive.run(true, scoped);
}
