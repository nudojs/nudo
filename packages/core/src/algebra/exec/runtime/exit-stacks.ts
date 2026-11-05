/**
 * 函数求值作用域的退出栈（loop/throw 早期退出收集）+ try 标记栈 + soft
 * may-throw 帧标记 + NudoReturn 早退信号（#9 state.ts 拆分）。
 *
 * **#8 统一裁决记录——四条 ALS 保留原样，不合入 collector-scope 槽**：
 * `exec/runtime/async.ts` 生成器路径直接 `loopExitsAls.run(localExits, …)`
 * （真 AsyncLocalStorage.run——跨 `it.next()` settle 步**跨 await 隐式传播**，
 * 携带的帧栈在挂起/恢复间保持）+ `control.ts` 多处 `loopExitsAls.getStore()`
 * 直读；collector-scope 的 `createScopedSlot` 只表同步 save/restore，
 * 表达不了「以既有值为初始 store 进入」（runFresh 是全新 init）。语义必须
 * 恒等 ⇒ 保持真 ALS（任务书逃逸阀：无法恒等表达的槽保留 ALS + 注释）。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Abs } from "../../abs.ts";
import {
  $tryDigestSoft,
  $tryMarkSoft,
  $tryReleaseSoft,
  orphanMayThrowEffects,
  popMayThrowFrame,
} from "../../diagnostics/may-throw.ts";
import type { MayThrowEffect } from "../../diagnostics/may-throw.ts";

// 退出栈（ALS）+ $try*
export const loopExitsAls = new AsyncLocalStorage<Abs[]>();
export const throwExitsAls = new AsyncLocalStorage<Abs[]>();
export const tryMarksAls = new AsyncLocalStorage<number[]>();
/** 每个 try 是否仍有未消化的 soft may-throw 帧（digest/release 幂等） */
export const softFrameActiveAls = new AsyncLocalStorage<boolean[]>();

/** 函数求值作用域：收集抽象分支上的 early-return / throw 值；try 标记栈同边界 */
export function runWithLoopExits<T>(body: () => T): T {
  return loopExitsAls.run([], () =>
    throwExitsAls.run([], () =>
      tryMarksAls.run([], () => softFrameActiveAls.run([], body)),
    ),
  );
}

export function takeLoopExits(): Abs[] {
  return loopExitsAls.getStore() ?? [];
}

export function takeThrowExits(): Abs[] {
  return throwExitsAls.getStore() ?? [];
}

export function pushLoopExit(v: Abs): void {
  loopExitsAls.getStore()?.push(v);
}

export function pushThrowExit(v: Abs): void {
  throwExitsAls.getStore()?.push(v);
}

/** transpile 生成代码用：`$pushLoopExit` */
export function $pushLoopExit(v: Abs): void {
  pushLoopExit(v);
}

/** try 块开始：压栈 hard/soft 标记 */
export function $tryMark(): number {
  $tryMarkSoft();
  softFrameActiveAls.getStore()?.push(true);
  const store = throwExitsAls.getStore();
  const m = store?.length ?? 0;
  tryMarksAls.getStore()?.push(m);
  return m;
}

/** 当前最内层 try 的 mark（return 时 drain 用；嵌套调用不串栈） */
export function $tryCurrentMark(): number {
  const stack = tryMarksAls.getStore();
  return stack && stack.length > 0 ? stack[stack.length - 1]! : 0;
}

export function $tryPopMark(): void {
  tryMarksAls.getStore()?.pop();
  const soft = softFrameActiveAls.getStore();
  if (soft && soft.length > 0) {
    if (soft[soft.length - 1]) $tryReleaseSoftOut();
    soft.pop();
  }
}

/** 取出 mark 之后新记录的 throw（try 吸收 / catch 合并） */
export function $tryTakeSince(mark: number): Abs[] {
  const store = throwExitsAls.getStore();
  if (!store) return [];
  return store.splice(Math.min(mark, store.length));
}

/** 窥视 mark 之后新记录的 throw（不摘除——pure memo 捕获用） */
export function peekThrowExitsSince(mark: number): Abs[] {
  const store = throwExitsAls.getStore();
  if (!store) return [];
  return store.slice(Math.min(mark, store.length));
}

/** 当前 throwExits 帧长度（pure memo 捕获的 mark 基线） */
export function throwExitsMark(): number {
  return throwExitsAls.getStore()?.length ?? 0;
}

/** catch 入口消化 try 内 soft may-throw（幂等；design §3.3） */
export function $tryDigestSoftCatch(): void {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return;
  $tryDigestSoft();
  soft[soft.length - 1] = false;
}

/**
 * 正常完成路径 + catch 可能 rethrow：soft 效果不得消化——假想 soft throw
 * 经 catch rethrow 逃逸（try { u.name } catch (e) { throw e; } 的 L2）。
 * 摘帧上浮（collector / 外层 try 帧可再消化），并清 soft 标记防二次释放。
 */
export function $tryReleaseSoftCatch(): void {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return;
  $tryReleaseSoft();
  soft[soft.length - 1] = false;
}

/**
 * catch 入口摘下 soft 效果（不消化）。catch 正常落出口再 discard；
 * catch rethrow 时 orphan 上浮（外层 try 可再消化）。
 */
export function $tryDetachSoftCatch(): MayThrowEffect[] {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return [];
  const effects = popMayThrowFrame(false);
  soft[soft.length - 1] = false;
  return effects;
}

/** catch 无 rethrow 落出口：丢弃已摘下的 soft（design：catch 消化） */
export function $tryDiscardSoft(_effects: MayThrowEffect[]): void {
  /* digest */
}

/** catch rethrow：摘下的 soft 上浮（嵌套 try 归外层帧） */
export function $tryOrphanSoft(effects: MayThrowEffect[]): void {
  orphanMayThrowEffects(effects);
}

/** 无 handler / 出口：上浮未消化 soft may-throw（幂等） */
export function $tryReleaseSoftOut(): void {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return;
  $tryReleaseSoft();
  soft[soft.length - 1] = false;
}

// 循环信号（NudoReturn / NudoLoopSignal）
// --- early return from loop bodies (C2.1) ---

/** 求值引擎「函数提前 return」信号（区别于 throw） */
export class NudoReturn extends Error {
  readonly absValue: Abs;
  constructor(absValue: Abs) {
    super("nudo:return");
    this.name = "NudoReturn";
    this.absValue = absValue;
  }
}

export function isNudoReturn(e: unknown): e is NudoReturn {
  return e instanceof NudoReturn;
}

/** transpile `return x` inside for/while → `$loopReturn(x)` */
export function $loopReturn(v: Abs): never {
  throw new NudoReturn(v);
}

/**
 * transpile 函数体边界吸收器：`try { body } catch (e) { return $catchReturn(e); }`
 * —— 函数体内 $loopReturn 早退（循环 / if 臂）在函数自身边界收成返回值，
 * 转译模块对裸宿主调用（e2e 真实 .mjs 导入 / 模块顶层互调）自包含；
 * 其余异常（NudoThrow / 原生错误）原样 rethrow。仅在发射体含 $loopReturn
 * 时由 transpile 侧包裹。
 */
export function $catchReturn(e: unknown): Abs {
  if (isNudoReturn(e)) return e.absValue;
  throw e;
}
