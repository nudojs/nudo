/**
 * 控制流：loop/try 退出栈、$fork/$for/$while、$throw。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { bumpEvalForkBudget, noteLoopTruncation } from "../../call-budget.ts";
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, never, numLit, unknown, type Confidence } from "../../abs.ts";
import { lit } from "../../term.ts";
import type { Phi } from "../../pred.ts";
import { pTrue, and, predEquals } from "../../pred.ts";
import {
  beginCollectionFork,
  endCollectionFork,
  popCollectionArm,
  pushCollectionArm,
} from "../../collections.ts";
import { joinAbs, objOf } from "../../objects.ts";
import {
  errorTypeAbs, $tryMarkSoft, $tryDigestSoft, $tryReleaseSoft, popMayThrowFrame,
  orphanMayThrowEffects, recordMayThrow, type MayThrowEffect,
} from "../may-throw.ts";
import {
  NudoThrow, isNudoThrow, noBody, undef, oobUndef, writeInPlace, clearStaleTermPred,
  asAbsVal, callAtFunctionBoundary, $lit, litTruth, isDefinitelyTrue, isDefinitelyFalse,
  currentExecPhi, withExecPhi, isNudoReturn, isNudoBreak, isNudoContinue, confPartial, confPartialPacked,
  NudoReturn, NudoLoopSignal, withAbstractForkArm, loopExitsAls, throwExitsAls, tryMarksAls, softFrameActiveAls,
  runWithLoopExits, takeLoopExits, takeThrowExits, pushLoopExit, pushThrowExit, $pushLoopExit,
} from "./state.ts";
import { $unknown, $eq, $ne, $lt, $le, $gt, $ge, $add, $sub, $typeof, $not } from "./ops.ts";
import { $arr } from "./containers.ts";
import {
  notePromiseExecutorFork,
  enterPromiseForkArm,
  leavePromiseForkArm,
  notePromiseExecutorHang,
  promiseExecutorActive,
  notePromiseForkExit,
  currentPromiseSettleArm,
} from "../../builtins.ts";
import { falseConstraint } from "../../arithmetic.ts";
import { leqAbs } from "../../leq.ts";

// 退出栈（ALS）+ $try*
/**
 * if：两侧都探索（抽象条件），具体条件短路。
 * 循环/函数体内 early-return：抽象分支把 NudoReturn 记入 loop-exit
 * 侧信道并让另一侧继续，避免只保留「先跑完的那一侧」而低估结果域。
 * throw 同理：记录 throw-exit，兄弟臂继续探索（P0-4）。
 */

// fork / for
export type ForkArm =
  | { kind: "val"; v: Abs }
  | { kind: "ret"; v: Abs }
  | { kind: "throw"; v: Abs };

/** 生成器 yield 收集器：els = yield 值序列；ctxs = 每 yield 点 try 上下文位
 *  （Bug 52：$yield/$yieldStar 第二实参，transpile 静态标注——.return()/
 *  .throw() 挂起点语义用）。els/ctxs 恒等长（同一 push 点成对压入）。 */
export interface GenYieldCollector {
  els: Abs[];
  ctxs: number[];
}

/** yield 点 try 上下文位（Bug 52）：1 = 外层任一 try 带 finally；2 = 外层任一
 *  try 带 catch。finalizer 静态事实（.transpile 标注）：4 = 最近 finalizer 含
 *  yield/yield*（.return 后可再交付 → done 并 boolean）；8 = 最近 finalizer
 *  含 return（.return 注入值可被覆盖 → 值并 unknown）。
 *  catch 静态事实（R1a，最近 enclosing catch）：16 = catch 体含 return
 *  （吸收后完成）；32 = catch 体含 yield/yield*（吸收后续体可再交付）；
 *  64 = catch 体可能 rethrow 且外层还有 catch（吸收结局不可静态分类——
 *  内层重抛会被外层 catch 二次吸收，外层 catch 事实未标注）。
 *  transpile 侧以数值字面量发射。 */
export const YIELD_TRY_FINALLY = 1;
export const YIELD_TRY_CATCH = 2;
export const YIELD_FINALLY_YIELDS = 4;
export const YIELD_FINALLY_RETURNS = 8;
export const YIELD_CATCH_RETURNS = 16;
export const YIELD_CATCH_YIELDS = 32;
export const YIELD_CATCH_RETHROWS = 64;
/** R1a：yield* 委托进**生成器对象**的 yield 点位（$yieldStar 运行时标注，
 *  非 transpile）：.throw() 原生转发进内层迭代器——内层 catch 吸收后续体
 *  （可再交付）超出外层 ctx 可分类面 → 吸收结局不可折 done。数组/字符串
 *  等无 throw() 方法的内层：原生 TypeError 回注外层帧 → 外层 catch 吸收
 *  （可折），不置位。 */
export const YIELD_DELEGATED_GEN = 128;

/** 生成器 yield 收集：抽象分支时标记路径敏感，禁止 exact 元组出货 */
export let yieldStack: GenYieldCollector[] = [];
export let genPathSensitive = 0;
export let genJoinOverride: Abs | null = null;
export function setGenJoinOverride(v: Abs | null): void { genJoinOverride = v; }
export function bumpGenPathSensitive(): void { genPathSensitive++; }

export function withIsolatedYields<T>(fn: () => T): { v: T; ys: GenYieldCollector | null } {
  const top = yieldStack[yieldStack.length - 1];
  // 无收集器：不换槽、不建 armYs（fork 热路径常态）
  if (!top) return { v: fn(), ys: null };
  const armYs: GenYieldCollector = { els: [], ctxs: [] };
  yieldStack[yieldStack.length - 1] = armYs;
  try {
    return { v: fn(), ys: armYs };
  } finally {
    yieldStack[yieldStack.length - 1] = top;
  }
}

export function mergeArmYields(armYsList: Array<GenYieldCollector | null>): void {
  const top = yieldStack[yieldStack.length - 1];
  if (!top || armYsList.length === 0) return;
  const concrete = armYsList.filter((x): x is GenYieldCollector => x !== null);
  if (concrete.length === 0) return;
  if (concrete.length === 1) {
    top.els.push(...concrete[0]!.els);
    top.ctxs.push(...concrete[0]!.ctxs);
    return;
  }
  // 多臂：join 各臂 yield 序列，并标记路径敏感
  let joined: Abs | null = null;
  for (const ys of concrete) {
    joined = joined ? joinAbs(joined, $arr(ys.els)) : $arr(ys.els);
  }
  genPathSensitive++;
  if (joined) genJoinOverride = joined;
  // 父收集器仍并入全部臂元素（过近似），conf 由 genJoinOverride/path 敏感性压低
  for (const ys of concrete) {
    top.els.push(...ys.els);
    top.ctxs.push(...ys.ctxs);
  }
}

export function runForkArm(arm: () => Abs): ForkArm {
  // N1：fork 臂 = 替代路径——promise executor 内各臂的 settle（resolve/
  // reject）按臂路径 token 判定 first-wins（兄弟臂 settle 均活，见
  // evalPromiseCtor）；executor 外零开销（enter 内部门闩）。
  enterPromiseForkArm();
  try {
    return { kind: "val", v: asAbsVal(arm()) };
  } catch (e) {
    if (isNudoReturn(e)) {
      // N5：return 截断延续（join 后 trailing settle 不在此路径）——打点
      notePromiseForkExit(currentPromiseSettleArm());
      return { kind: "ret", v: e.absValue };
    }
    if (isNudoThrow(e)) {
      // N5：throw 同款截断（延续是 catch/函数边界，非 join 后主路径）
      notePromiseForkExit(currentPromiseSettleArm());
      pushThrowExit(e.absValue);
      return { kind: "throw", v: e.absValue };
    }
    throw e;
  } finally {
    leavePromiseForkArm();
  }
}

export function settleForkArms(a: ForkArm, b: ForkArm, exits: Abs[] | undefined): Abs {
  // 避开 filter 数组分配：两臂直判
  const aThrow = a.kind === "throw";
  const evalThrow = b.kind === "throw";
  if (aThrow && evalThrow) {
    // 全 throw：兄弟臂已探索完，再抛 join（调用边界收成 throws）
    throw new NudoThrow(joinAbs(a.v, b.v));
  }
  // 混合 throw + val/ret：throws 已在 throwExits；继续处理非 throw 臂
  const first = aThrow ? b : a;
  const second = aThrow ? a : b;
  // ret 值只经一个通道交付（恰一次）：双 ret 臂合并后抛 NudoReturn 由函数
  // 边界收值；单 ret 臂入 exits 侧信道（语句位 fork 继续 fall-through，值
  // 由边界 join）——不再由 runForkArm 预推（双 ret 会与抛出值双重计数）。
  if (first.kind === "ret" && second.kind === "ret") {
    throw new NudoReturn(joinAbs(first.v, second.v));
  }
  if (aThrow !== evalThrow) {
    // 恰一臂 throw：只携带非 throw 臂
    if (first.kind === "ret") {
      if (!exits) throw new NudoReturn(first.v);
      exits.push(first.v);
      // ret 臂经 exits 交付、throw 臂已上 throwExits——两路径都离开了语句位，
      // 无 fall-through 可言：幻影 undef() 会被边界 join 成假 undefined 臂
      // （`if (g) return "s"; throw E` 错显 `undefined | "s"`）。never 是
      // joinAbs 幂等元，正常完成不存在时静默消失。
      return never;
    }
    return first.v;
  }
  if (first.kind === "ret") {
    if (!exits) throw new NudoReturn(first.v);
    exits.push(first.v);
    return second.v;
  }
  if (second.kind === "ret") {
    if (!exits) throw new NudoReturn(second.v);
    exits.push(second.v);
    return first.v;
  }
  return joinAbs(first.v, second.v);
}

/** Φ 规模上限：递归×循环下 Φ 逐层 and 累积（每层 term 不同 → 去重失效）→
 *  cmp 的 implies(Φ,pred) 在巨大 Φ 上爆炸（real-packages lodash _baseFlatten
 *  实测 50+ 项 → 60s+ 卡死；main 无 Φ-native 时 31ms）。超限丢弃新增项
 *  （保留原 Φ）——剪枝更少 = 更保守，安全。 */
export const PHI_MAX_NODES = 24;
/** 单 pred 追加进 and 链：避开 and() 全量 flatten 的 O(n²) 去重。 */
export function boundedPhi(p: Phi, q: Phi): Phi {
  if (q.op === "true") return p;
  if (p.op === "true") return q.op === "and" && q.args.length > PHI_MAX_NODES ? p : q;
  if (q.op !== "and") {
    if (p.op === "and") {
      if (p.args.length > PHI_MAX_NODES) return p;
      for (let i = 0; i < p.args.length; i++) {
        if (predEquals(p.args[i]!, q)) return p;
      }
      const args = p.args.slice();
      args.push(q);
      return { op: "and", args };
    }
    return predEquals(p, q) ? p : { op: "and", args: [p, q] };
  }
  const r = and(p, q);
  if (r.op !== "and") return r;
  return r.args.length > PHI_MAX_NODES ? p : r;
}

export function $fork(test: Abs, consequent: () => Abs, alternate?: () => Abs): Abs {
  // Promise executor 内分叉：各臂 resolve 需 join（见 evalPromiseCtor）
  notePromiseExecutorFork();
  // 缺参/宿主裸值：先收成 Abs，否则 litTruth 读 .shape 炸掉、被 executor catch 成 unknown
  const testAbs = asAbsVal(test);
  // 分支展开上限（递归×循环爆炸阀）：超限放弃分支 = unknown（最保守）。
  // 截断已由 bumpEvalForkBudget → noteEvalForkTruncation 上报（nudo:fork-truncated）
  if (!bumpEvalForkBudget()) return unknown;
  // Φ-native：测试判定已由 cmp 消费 currentExecPhi（$gt 等传模块级 currentExecPhi()）；
  // 此处把 Φ∧test（真臂）/ Φ∧¬test（假臂）压进臂作用域——嵌套/兄弟分支的
  // 路径事实沿臂累积（外层已证 x>y ⇒ 内层同测试折叠）。
  // 单次 litTruth：isDefinitelyTrue/False 各算一遍是纯浪费。
  const truth = litTruth(testAbs);
  const p = currentExecPhi();
  const tCons = testAbs.pred;
  if (truth === true) {
    return asAbsVal(withExecPhi(tCons ? boundedPhi(p, tCons) : p, consequent));
  }
  if (truth === false || testAbs.shape.k === "never") {
    if (!alternate) return undef();
    const tNeg = falseConstraint(testAbs);
    return asAbsVal(withExecPhi(tNeg ? boundedPhi(p, tNeg) : p, alternate));
  }
  const phiTrue = tCons ? boundedPhi(p, tCons) : p;
  // 假臂 Φ 惰性：隐式 else 不跑 body，用不到 ¬test
  let phiFalse: Phi | undefined;
  const falsePhi = (): Phi => {
    if (phiFalse === undefined) {
      const tNeg = falseConstraint(testAbs);
      phiFalse = tNeg ? boundedPhi(p, tNeg) : p;
    }
    return phiFalse;
  };

  const exits = loopExitsAls.getStore();
  // 集合 side-table：抽象分支各自 overlay，结束后 join（防身份污染）
  // overlay 本身惰性分配——无 Map/Set 写入时零堆分配
  beginCollectionFork();
  const arms: Array<ReturnType<typeof popCollectionArm>> = [];
  const armYsList: Array<GenYieldCollector | null> = [];
  let a: ForkArm;
  let b: ForkArm;
  try {
    pushCollectionArm();
    try {
      // 抽象双臂：臂内 break/continue 信号标记 abstract（兄弟臂未执行，
      // 循环捕获点据此宽化循环携带绑定，Bug 47/48）
      const r = withExecPhi(phiTrue, () =>
        withIsolatedYields(() => withAbstractForkArm(() => runForkArm(consequent))),
      );
      a = r.v;
      armYsList.push(r.ys);
    } finally {
      arms.push(popCollectionArm());
    }
    if (alternate) {
      pushCollectionArm();
      try {
        const r = withExecPhi(falsePhi(), () =>
          withIsolatedYields(() => withAbstractForkArm(() => runForkArm(alternate))),
        );
        b = r.v;
        armYsList.push(r.ys);
      } finally {
        arms.push(popCollectionArm());
      }
    } else {
      // 隐式 else：无写也必须占一臂，否则条件写入会被 merge 成必然（P0）。
      // N5：隐式 else 也是替代路径——executor 内无 settle 则该路径悬挂 →
      // 必须占 settle 臂 token（`if (c) resolve(1)` 单臂 settle 不得折确定）
      pushCollectionArm();
      try {
        b = promiseExecutorActive() ? runForkArm(() => undef()) : { kind: "val", v: undef() };
        armYsList.push(null);
      } finally {
        arms.push(popCollectionArm());
      }
    }
  } finally {
    endCollectionFork(arms);
    if (yieldStack.length > 0) mergeArmYields(armYsList);
  }

  return settleForkArms(a, b, exits);
}

export { DEFAULT_MAX_LOOP_ITERS, MAX_CONCRETE_LOOP_ITERS, LOOP_TRUNCATION_LABEL } from "./loop-budget.ts";
import { DEFAULT_MAX_LOOP_ITERS, MAX_CONCRETE_LOOP_ITERS, LOOP_TRUNCATION_LABEL } from "./loop-budget.ts";
import { makeLoopWidener } from "./loop-widen.ts";
import { applyExitJoinInvariants, applyInvariantsToPack, hasInvariantSpecs } from "./invariant-apply.ts";

/**
 * for 的惰性展开：生成器只负责「按上限吐状态」。
 * 抽象条件无法诚实终止——消费者必须自带 maxIters。
 */
export function* $forIter(
  init: Abs,
  test: (s: Abs) => Abs,
  step: (s: Abs) => Abs,
  body: (s: Abs) => Abs,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
): Generator<{ state: Abs; test: Abs; afterBody: Abs }, void, void> {
  let s = init;
  for (let i = 0; i < maxIters; i++) {
    const t = test(s);
    if (isDefinitelyFalse(t)) {
      yield { state: s, test: t, afterBody: s };
      return;
    }
    let afterBody: Abs = s;
    let broke = false;
    try {
      afterBody = body(s);
    } catch (e) {
      if (isNudoBreak(e)) broke = true;
      else if (isNudoContinue(e)) afterBody = s; // 体提前结束
      else throw e;
    }
    yield { state: s, test: t, afterBody };
    if (broke) return;
    s = step(afterBody);
  }
}

/**
 * 有界 for：unroll ≤ maxIters，每步「可能退出」的态 join；
 * 相邻态 leq 视为不动点提前停。
 */
export function $for(
  init: Abs,
  test: (s: Abs) => Abs,
  step: (s: Abs) => Abs,
  body: (s: Abs) => Abs,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
  opts?: {
    pack?: () => Abs;
    unpack?: (s: Abs) => void;
    /** 标签循环（`outer: for …`）：仅吸收同标签 break/continue 信号 */
    label?: string;
    /** 循环变量的最新写（Bug 228）：continue 臂取「体退出瞬间的循环变量值」
     *  ——转译侧在体的 finally 里写回共享槽；缺省（未插桩）时以 state 近似。 */
    loopVar?: () => Abs;
  },
): Abs {
  let state = init;
  let exitJoin: Abs | undefined;
  let extJoin: Abs | undefined;
  const pack = opts?.pack;
  const unpack = opts?.unpack;
  // 循环携带绑定宽化器（Bug 48，与 $while/$forOf 同一机制）：计数器
  // （state 线程）与外层绑定（extJoin 打包）各一个——抽象条件预算耗尽的
  // 有界快照 join（{0..8}，conf exact）对任意迭代次数欠近似；增长槽位
  // 宽化到无上界域（sound），join-幂等绑定不动
  const counterWiden = makeLoopWidener();
  const extWiden = pack ? makeLoopWidener() : undefined;
  const snapCounter = (): void => {
    counterWiden.observe(state);
    exitJoin = exitJoin ? joinAbs(exitJoin, state) : state;
  };
  const snapExt = (): void => {
    if (!pack) return;
    const p = pack();
    extWiden?.observe(p);
    extJoin = extJoin ? joinAbs(extJoin, p) : p;
  };
  const applyExtJoin = (widened: boolean): void => {
    if (!extJoin || !pack || !unpack) return;
    const joined = widenLoopJoin(joinAbs(extJoin, pack()));
    unpack(widened && extWiden ? extWiden.widenFinal(joined) : joined);
  };

  // 具体延展（两段预算）：maxIters 是**抽象**展开预算；预算边界上条件仍
  // definitely-true 时迭代空间具体可判定（原生语义确定），截断会产出错误
  // 的 #exact（globToRegex 对 12 字符串只跑 8 轮拼出 `^lib\/debu$` 还声明
  // exact）——延展到 MAX_CONCRETE_LOOP_ITERS。硬上限仍未终止 → 截断观测
  // （noteLoopTruncation）+ conf 降级（有界、可观测，与 fork/call 预算同
  // posture）。延展相里条件退化为抽象即停（回到耗尽口径，不越抽象预算）。
  let limit = maxIters;
  let extended = false;
  let concreteExhausted = false;
  for (let i = 0; i < limit; i++) {
    const t = test(state);
    if (isDefinitelyFalse(t)) {
      snapCounter();
      snapExt();
      applyExtJoin(false);
      return exitJoin ?? state;
    }

    const abstractTest = !isDefinitelyTrue(t);
    if (abstractTest) {
      if (extended) break;
      // N5：出口臂（本轮 test 假 → 跳过体直达循环后）：无 post-loop settle
      // 覆盖则该路径悬挂（executor 内不得折确定 settle）
      enterPromiseForkArm();
      leavePromiseForkArm();
      snapCounter();
      snapExt();
    }

    let afterBody: Abs;
    // N5：抽象条件迭代体 = 条件路径（体 settle 不得覆盖出口臂）
    if (abstractTest) enterPromiseForkArm();
    try {
      afterBody = body(state);
    } catch (e) {
      // break 吸收 → 本轮为最终态后退出；continue 吸收 → 体提前完成，
      // 用 pack 收集已发生的绑定写（continue 前语句的副作用保留）
      if (isNudoBreak(e, opts?.label)) {
        // break 打断体（抽象 fork 的 break 臂冒泡，本迭代剩余语句丢失）——
        // 「先跑任意次再 break」的累加器/计数器域不可观测，整体宽化；
        // definite 分支的 break 是忠实语义（e.abstract=false），不宽化
        snapCounter();
        snapExt();
        if (e.abstract) {
          counterWiden.markInterrupted();
          extWiden?.markInterrupted();
        }
        applyExtJoin(e.abstract);
        return exitJoin !== undefined
          ? e.abstract
            ? counterWiden.widenFinal(exitJoin)
            : exitJoin
          : state;
      }
      if (isNudoContinue(e, opts?.label)) {
        // 体未走完 return；continue 之前对**循环变量**的写必须传给步进
        // （原生：for (let i…) 每轮绑定独立，continue 前的 i=5 写进本轮
        // 绑定 → 下一轮 i++ 得 6）。循环变量是状态线程形参（JS 作用域无该
        // 绑定），体对它的写在形参槽里——$for 拿不到 ⇒ 转译侧在体的
        // finally 里把最新值写回共享槽（loopVar 回调），此处取用。
        // 无共享槽（未插桩的调用）时以 state 近似（旧口径）。
        // 抽象 continue 臂丢失本迭代外层绑定效应 → 标记打断（耗尽出口
        // 宽化）；definite continue 忠实
        if (e.abstract) extWiden?.markInterrupted();
        afterBody = state;
        const lv = opts?.loopVar?.();
        if (lv !== undefined) afterBody = lv;
      } else if (isNudoReturn(e)) {
        // Bug 99：抽象条件轮的体内 return——0 迭代/后续退出路径仍活，
        // 令牌冒泡会让函数边界只收体内返回值、post-loop 语句被吞
        // （whileGuard(any) 折 0 #exact，unsound）。$switch/$fork 同构：
        // 返回值收为一臂（exits 侧信道，函数边界 joinControlExits 汇合），
        // 循环按出口收口（snapCounter 已含本轮入口快照）后 post-loop 语句
        // 作为兄弟臂继续。definite-true 轮（出口臂不可达，for(;;){return}
        // 保持 #exact）与无 exits 通道（裸宿主调用——$catchReturn 自包含
        // 边界，吸收即丢值）保持原样冒泡。$gen/$async thunk 内 push 落
        // **本地** exits 作用域（async.ts：臂值并入终末值域 / promise
        // inner），不再漏成外层函数幻影臂。NudoThrow 是真异常，照抛。
        const retExits = loopExitsAls.getStore();
        if (abstractTest && retExits) {
          retExits.push(e.absValue);
          // N5：return 截断本臂延续（同 runForkArm 收 token 口径）
          notePromiseForkExit(currentPromiseSettleArm());
          snapCounter();
          snapExt();
          counterWiden.markInterrupted();
          extWiden?.markInterrupted();
          applyExtJoin(true);
          return exitJoin !== undefined ? counterWiden.widenFinal(exitJoin) : state;
        }
        throw e;
      } else if (isNudoThrow(e)) {
        throw e;
      } else {
        throw e;
      }
    } finally {
      if (abstractTest) leavePromiseForkArm();
    }
    const next = step(afterBody);
    // 抽象条件：本轮 body 完成后的绑定也是合法出口（下一轮 test 可能为假）
    if (abstractTest) {
      state = afterBody;
      snapExt();
    }

    if (i > 0) {
      const nvR = litValue(next);
      const svR = litValue(state);
      // 「是否字面量」看 ok（LitValueResult 契约）；值比较用 ===（与 JS 一致，NaN 不等）。
      // 双字面量等值 / 双方均无「有定义值字面量」时的 leq 回退，与旧哨兵写法等价。
      const stuck =
        (nvR.ok && svR.ok && nvR.value === svR.value) ||
        ((!nvR.ok || nvR.value === undefined) &&
          (!svR.ok || svR.value === undefined) &&
          leqAbs(next, state).ok);
      if (stuck) {
        state = next;
        snapCounter();
        snapExt();
        applyExtJoin(false);
        return exitJoin ?? next;
      }
    }
    state = next;

    // 边界门：本轮结束后到达预算/硬上限，且下一轮条件仍具体真
    if (i + 1 === limit && isDefinitelyTrue(test(state))) {
      if (limit < MAX_CONCRETE_LOOP_ITERS) {
        limit = MAX_CONCRETE_LOOP_ITERS;
        extended = true;
      } else {
        concreteExhausted = true;
      }
    }
  }

  snapCounter();
  snapExt();
  if (concreteExhausted) {
    noteLoopTruncation(LOOP_TRUNCATION_LABEL);
    // N5：确定性死循环截断——悬挂路径真实存在（条件恒真不退出），除非
    // 截断点之前已 settle，结果带 unsettled（post-loop settle 不可达）
    notePromiseExecutorHang();
    if (extJoin && pack && unpack) unpack(confPartialPacked(widenLoopJoin(joinAbs(extJoin, pack()))));
    return confPartial(exitJoin ?? state);
  }
  // 抽象预算耗尽（条件非 definitely-false 仍有剩余迭代空间）：容器型外层
  // 绑定按「长度未知」widen（sum-of-tuples(不同长度) → arr）——否则第二次
  // 循环/后续读以具体下标越过已知长度，得到假 undefined 并误报 may-throw
  //（DP 表双循环 `d[i][1] = d[i-1][1] + 1` 的 never 折叠，issue #98）；
  // 增长计数器/累加器宽化到无上界域（Bug 48，sound 超集）
  if (extJoin && pack && unpack) unpack(extWiden!.widenFinal(widenLoopJoin(joinAbs(extJoin, pack()))));
  return exitJoin !== undefined ? counterWiden.widenFinal(exitJoin) : state;
}

/**
 * 循环出口 join 的容器 widen：把「不同长度 tuple 的 sum」收成 arr
 *（元素域 = 全部已知元素 join；OOB undefined 不烘焙——读位事实由 $idx
 * 抽象下标读并入，#156）。只动顶层与 obj 槽位；非增长形态（等长
 * tuple / 非容器）原样。#176：末尾实施 @nudo:invariant（绑定包槽位按
 * 名下钻强化）——$for 的 applyExtJoin 循环头 join、耗尽/截断出口三处
 * 调用点统一在本体内覆盖，喂下一轮迭代体读点与出口读点强化后的域。
 */
function widenLoopJoin(a: Abs): Abs {
  return applyInvariantsToPack(widenLoopJoinInner(a));
}

function widenLoopJoinInner(a: Abs): Abs {
  const widenValue = (v: Abs): Abs => {
    if (v.shape.k !== "sum") return v;
    const members = (v.shape as { k: "sum"; members: Abs[] }).members;
    const els: Abs[] = [];
    const undefArms: Abs[] = [];
    const lengths = new Set<number>();
    let hasArr = false;
    for (const m of members) {
      if (m.shape.k === "tuple") {
        const t = m.shape as { k: "tuple"; elements: Abs[]; holes?: number[] };
        lengths.add(t.elements.length);
        els.push(...t.elements);
        if (t.holes?.length) undefArms.push(oobUndef());
      } else if (m.shape.k === "arr") {
        hasArr = true;
        els.push((m.shape as { k: "arr"; element: Abs }).element);
      } else {
        return v; // 非容器成员：不动（保持 join 精度）
      }
    }
    if (!hasArr && lengths.size <= 1) return v; // 等长 tuple join：无增长，不 widen
    // 长度增长（或已有 arr 臂）→ 长度未知。#156：元素域 = 全部已知元素
    // join（hole 下标读值 undefined 是真实元素值域，保留）；OOB undefined
    // 不烘焙——越界是读位事实（$idx 抽象下标读已并入元素 ∪ undefined），
    // 烘焙会把「循环 + push」对任何元素契约变成不可证（凭空 undefined 臂）
    const known = els.length ? els.reduce((x, y) => joinAbs(x, y)) : unknown;
    const element = undefArms.length
      ? undefArms.reduce((x, y) => joinAbs(x, y), known)
      : known;
    return abs(
      { k: "arr", element },
      undefined,
      undefined,
      confJoin(v.conf, "widened"),
    );
  };
  const s = a.shape;
  if (s.k === "obj") {
    let changed = false;
    const slots: Record<string, { value: Abs }> = Object.create(null);
    for (const [k, slot] of Object.entries(s.slots)) {
      const w = widenValue(slot.value);
      if (w !== slot.value) changed = true;
      slots[k] = { value: w };
    }
    return changed ? abs({ ...s, slots }, undefined, undefined, a.conf) : a;
  }
  return widenValue(a);
}

// while
/**
 * 有界 while：state 线程穿 test/step（与 $for 同折叠语义）。
 * 抽象条件无法诚实终止——必须 maxIters。
 */
export function $while(
  init: Abs,
  test: (s: Abs) => Abs,
  step: (s: Abs) => Abs,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
): Abs {
  let state = init;
  let exitJoin: Abs | undefined;
  // 循环携带绑定宽化器（Bug 48）：抽象条件预算耗尽时出口 join 是有界
  // 快照 {0..8}——常步长计数器对任意迭代次数欠近似（n=100 → 100 ∉
  // {0..8}）且 conf exact 是硬声称；增长槽位宽化到无上界域（sound）
  const widen = makeLoopWidener();
  // 具体延展：与 $for 同口径（见其注释）——预算边界条件仍具体真时延展到
  // 硬上限；硬上限仍具体真 → 截断观测 + conf 降级。
  let limit = maxIters;
  let extended = false;
  let concreteExhausted = false;

  for (let i = 0; i < limit; i++) {
    const t = test(state);
    if (isDefinitelyFalse(t)) {
      return exitJoin ? joinAbs(exitJoin, state) : state;
    }
    const abstractTest = !isDefinitelyTrue(t);
    if (abstractTest) {
      if (extended) break;
      // N5：出口臂（同 $for——无 post-loop settle 覆盖则悬挂）
      enterPromiseForkArm();
      leavePromiseForkArm();
      widen.observe(state);
      exitJoin = exitJoin ? joinAbs(exitJoin, state) : state;
    }
    // N5：抽象条件迭代 = 条件路径（体 settle 不得覆盖出口臂）
    let next: Abs;
    if (abstractTest) enterPromiseForkArm();
    try {
      next = step(state);
    } finally {
      if (abstractTest) leavePromiseForkArm();
    }
    if (i > 0) {
      const nvR = litValue(next);
      const svR = litValue(state);
      // 同上：.ok 判字面量，禁止 value !== undefined 哨兵。
      const stuck =
        (nvR.ok && svR.ok && nvR.value === svR.value) ||
        ((!nvR.ok || nvR.value === undefined) &&
          (!svR.ok || svR.value === undefined) &&
          leqAbs(next, state).ok);
      if (stuck) {
        return exitJoin ? joinAbs(exitJoin, next) : next;
      }
    }
    state = next;
    if (i + 1 === limit && isDefinitelyTrue(test(state))) {
      if (limit < MAX_CONCRETE_LOOP_ITERS) {
        limit = MAX_CONCRETE_LOOP_ITERS;
        extended = true;
      } else {
        concreteExhausted = true;
      }
    }
  }
  if (concreteExhausted) {
    noteLoopTruncation(LOOP_TRUNCATION_LABEL);
    // N5：确定性死循环截断（同 $for）——悬挂路径需 unsettled
    notePromiseExecutorHang();
    return confPartial(exitJoin ? joinAbs(exitJoin, state) : state);
  }
  // 抽象预算耗尽：增长计数器宽化到无上界域（Bug 48；稳定不动点原样）
  return exitJoin ? widen.widenFinal(joinAbs(exitJoin, state)) : state;
}

/**
 * 顺序 while（具体/可变闭包）：body 内对 JS 变量赋值。
 * 提供 pack/unpack 时，抽象条件的可能出口会 join 回绑定（P0 健全）；
 * 未 instrument 的调用保持旧语义（预算截断，文档已声明）。
 */
export function $whileSeq(
  test: () => Abs,
  body: () => void,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
  opts?: {
    /** 把当前绑定收成 Abs 状态（transpile 注入） */
    pack?: () => Abs;
    /** 把 join 后的状态写回绑定 */
    unpack?: (s: Abs) => void;
    /** 标签循环：仅吸收同标签 break/continue 信号 */
    label?: string;
  },
): void {
  const pack = opts?.pack;
  const unpack = opts?.unpack;
  let exitJoin: Abs | undefined;
  // 循环携带绑定宽化器（Bug 48，与 $while/$forOf 同一机制）：抽象条件
  // 预算耗尽的出口 join 是有界快照并集（{0..8}，conf exact）——常步长
  // 计数器对任意迭代次数欠近似；增长槽位宽化到无上界域（sound）
  const widen = pack ? makeLoopWidener() : undefined;
  const snapExit = (): void => {
    if (!pack) return;
    const s = pack();
    widen?.observe(s);
    exitJoin = exitJoin ? joinAbs(exitJoin, s) : s;
  };
  const applyExitJoin = (exhausted: boolean): void => {
    if (!pack || !unpack) return;
    // Bug 215：具体出口（无快照 join）也须实施 @nudo:invariant——否则
    // while / do-while 的公理被静默丢弃（$for 走 applyExtJoin 有实施）。
    // 无公理时不取绑定包（零行为变化：取包会暴露转译侧 pack 闭包的既有缺陷）。
    if (!exitJoin) {
      if (!hasInvariantSpecs()) return;
      const cur = pack();
      const strengthened = applyExitJoinInvariants(cur);
      if (strengthened !== cur) unpack(strengthened);
      return;
    }
    const joined = joinAbs(exitJoin, pack());
    const out = exhausted && widen ? widen.widenFinal(joined) : joined;
    unpack(applyExitJoinInvariants(out));
  };
  // 具体延展：与 $for 同口径（见其注释）——预算边界条件仍具体真时延展到
  // 硬上限；硬上限仍具体真 → 截断观测 + 绑定 conf 降级。
  let limit = maxIters;
  let extended = false;
  let concreteExhausted = false;
  // 边界门：本轮结束后到达预算/硬上限，且下一轮条件仍具体真。continue
  // 吸收后同样要过门（下一轮仍从 test 开始，边界判定不得跳过）。
  const boundaryGate = (i: number): void => {
    if (i + 1 !== limit || !isDefinitelyTrue(test())) return;
    if (limit < MAX_CONCRETE_LOOP_ITERS) {
      limit = MAX_CONCRETE_LOOP_ITERS;
      extended = true;
    } else {
      concreteExhausted = true;
    }
  };
  for (let i = 0; i < limit; i++) {
    const t = test();
    if (isDefinitelyFalse(t)) {
      applyExitJoin(false);
      return;
    }
    // 抽象条件：当前绑定是合法出口之一，先 snapshot 再进 body；
    // 延展相只接受具体真——条件退化抽象即停（不越抽象预算）
    const abstractIter = !isDefinitelyTrue(t);
    if (abstractIter) {
      if (extended) break;
      // N5：出口臂（本轮 test 假 → 跳过体直达循环后）：无 post-loop settle
      // 覆盖则该路径悬挂（`while (c) { r(1); }` 不得折确定 promise<1>）
      enterPromiseForkArm();
      leavePromiseForkArm();
      snapExit();
    }
    // N5：抽象条件迭代体 = 条件路径（体 settle 不得覆盖出口臂——但
    // `while (c) { r(1); } r(2);` 的 post-loop settle 覆盖出口 → 确定 1|2）
    if (abstractIter) enterPromiseForkArm();
    try {
      body();
    } catch (e) {
      if (isNudoBreak(e, opts?.label)) {
        // break 打断体（抽象 fork 的 break 臂冒泡，本迭代剩余语句丢失）——
        // 「先跑任意次再 break」的累加器域不可观测，出口整体宽化；
        // definite 分支的 break 是忠实语义（e.abstract=false），不宽化
        if (e.abstract) widen?.markInterrupted();
        applyExitJoin(e.abstract);
        return;
      }
      if (isNudoContinue(e, opts?.label)) {
        // continue 同款打断（e.abstract 同口径；definite continue 忠实）
        if (e.abstract) widen?.markInterrupted();
        boundaryGate(i); // 体提前结束，副作用已在绑定
        continue;
      }
      if (isNudoReturn(e)) {
        // Bug 99（$whileSeq 面，同 $for）：抽象条件轮体内 return 收臂 +
        // 循环出口续体——令牌冒泡会让函数边界只收体内返回值、post-loop
        // 语句被吞（0 迭代路径丢失）。snapExit 已含本轮入口快照（0 迭代/
        // 先退出路径绑定），applyExitJoin 收口后 post-loop 语句作为兄弟臂
        // 继续，返回值经 exits 侧信道在函数边界 joinControlExits 汇合。
        // definite-true 轮（出口臂不可达）与无 exits 通道（裸宿主调用——
        // $catchReturn 自包含边界，吸收即丢值）保持原样冒泡。$gen/$async
        // thunk 内 push 落本地 exits 作用域（同 $for 面注释）。
        const retExits = loopExitsAls.getStore();
        if (abstractIter && retExits) {
          retExits.push(e.absValue);
          // N5：return 截断本臂延续（同 runForkArm 收 token 口径）
          notePromiseForkExit(currentPromiseSettleArm());
          widen?.markInterrupted();
          applyExitJoin(true);
          return;
        }
        throw e;
      }
      if (isNudoThrow(e)) throw e;
      throw e;
    } finally {
      if (abstractIter) leavePromiseForkArm();
    }
    boundaryGate(i);
  }
  // 预算耗尽：最后一轮条件仍可能为真 → 当前态也是出口
  snapExit();
  if (concreteExhausted) {
    noteLoopTruncation(LOOP_TRUNCATION_LABEL);
    // N5：确定性死循环截断（同 $for）——悬挂路径需 unsettled
    notePromiseExecutorHang();
    if (exitJoin && pack && unpack) unpack(confPartialPacked(joinAbs(exitJoin, pack())));
    return;
  }
  // 抽象预算耗尽：增长计数器宽化到无上界域（Bug 48；稳定不动点原样）
  applyExitJoin(true);
}

/**
 * switch：具体 disc 选中匹配 case；抽象 disc 并所有分支。
 * 抽象路径与 $fork 同构：集合 side-table 按臂 overlay，共享 body 只跑一次；
 * 臂内 NudoReturn/NudoThrow 不冒泡污染兄弟臂。
 * **无 default 时必须隐式 fall-through 臂（undef）**，否则无匹配路径被丢掉（P0-2）。
 *
 * Bug 241：**字面量判别式 + 非字面量 case 测试**（`switch (true) { case x > 0: … }`）
 * ——原生里 case 测试是运行时求值的表达式，命中与否取决于测试值；此前字面量
 * 判别式路径只接受「case 测试也是字面量」的臂，其余臂被**整条丢弃**（永不
 * 命中）⇒ 臂内返回值从返回域/签名里消失 ⇒ 契约真实违约被漏报（L1 门禁假绿）。
 * 修法：遇到非字面量 case 测试 ⇒ **分叉**（命中该臂 / 不命中继续后续臂与
 * default），两路结果并入返回域（switchForked）。
 */
export function $switch(
  disc: Abs,
  cases: Array<{ test: Abs; run: () => Abs }>,
  dflt?: () => Abs,
): Abs {
  const dvR = litValue(disc);
  // 「是否字面量」必须看 ok：lit(undefined) 的 value 就是 undefined，
  // 用 value !== undefined 当门闩会让 case undefined 永不精确命中。
  if (dvR.ok) {
    for (let k = 0; k < cases.length; k++) {
      const c = cases[k]!;
      const tvR = litValue(c.test);
      if (!tvR.ok) {
        // 非字面量 case 测试 ⇒ 命中与否不可判定 ⇒ 分叉（Bug 241）
        return switchForked(cases, dflt, k, dvR.value, new Map());
      }
      // switch case 匹配是严格相等（===）：NaN 不匹配 NaN case；0 与 -0 互配。
      // Object.is 是 SameValue（NaN 相等），会假匹配 NaN case（假精确）。
      if (tvR.value === dvR.value) return asAbsVal(c.run());
    }
    return dflt ? asAbsVal(dflt()) : undef();
  }

  const exits = loopExitsAls.getStore();
  beginCollectionFork();
  const armOverlays: Array<ReturnType<typeof popCollectionArm>> = [];
  const armYsList: Array<GenYieldCollector | null> = [];
  const runArm = (fn: () => Abs): ForkArm => {
    pushCollectionArm();
    try {
      // 抽象 disc 臂：臂内 break/continue 信号标记 abstract（同 $fork）
      const r = withIsolatedYields(() => withAbstractForkArm(() => runForkArm(fn)));
      armYsList.push(r.ys);
      return r.v;
    } finally {
      armOverlays.push(popCollectionArm());
    }
  };
  const results: ForkArm[] = [];
  try {
    // 共享 body（case 1: case 2: …）只执行一次，避免非幂等副作用被放大
    const seenRuns = new Set<() => Abs>();
    for (const c of cases) {
      if (seenRuns.has(c.run)) continue;
      seenRuns.add(c.run);
      results.push(runArm(c.run));
    }
    if (dflt) {
      if (!seenRuns.has(dflt)) results.push(runArm(dflt));
    } else {
      // 隐式 no-match 臂：全 case 不命中时 fall-through（P0-2）。
      // N5：隐式臂也是替代路径（同 $fork 隐式 else）——executor 内必须占
      // settle 臂 token，否则抽象 disc 全不命中路径被静默丢弃
      pushCollectionArm();
      try {
        results.push(
          promiseExecutorActive() ? runForkArm(() => undef()) : { kind: "val", v: undef() },
        );
        armYsList.push(null);
      } finally {
        armOverlays.push(popCollectionArm());
      }
    }
  } finally {
    endCollectionFork(armOverlays);
    if (yieldStack.length > 0) mergeArmYields(armYsList);
  }
  if (results.length === 0) return undef();

  const throws = results.filter((r): r is { kind: "throw"; v: Abs } => r.kind === "throw");
  const nonThrow = results.filter((r) => r.kind !== "throw");
  if (nonThrow.length === 0) {
    throw new NudoThrow(throws.map((t) => t.v).reduce((x, y) => joinAbs(x, y)));
  }
  const allRet = nonThrow.every((r) => r.kind === "ret");
  if (allRet) {
    throw new NudoReturn(nonThrow.map((r) => r.v).reduce((a, b) => joinAbs(a, b)));
  }
  // 混合：ret 臂值入 exits 侧信道（恰一次，$fork settle 同口径）；语句位只携带 val 臂值继续
  const retParts = nonThrow.filter((r): r is { kind: "ret"; v: Abs } => r.kind === "ret");
  if (retParts.length > 0) {
    if (!exits) {
      throw new NudoReturn(retParts.map((r) => r.v).reduce((a, b) => joinAbs(a, b)));
    }
    for (const r of retParts) exits.push(r.v);
  }
  const valParts = nonThrow.filter((r) => r.kind === "val").map((r) => r.v);
  if (valParts.length === 0) return undef();
  return valParts.reduce((a, b) => joinAbs(a, b));
}

/**
 * Bug 241：字面量判别式下的**非字面量 case 测试** ⇒ 分叉。
 *
 * 原生 CaseBlock：case 测试是运行时求值的表达式（`case x > 0:`），命中与否
 * 取决于测试值 —— 判别式是字面量（`switch (true)`）并不使测试变字面量。
 * 引擎此前把这类臂当「永不匹配」整条丢弃 ⇒ 臂内返回值从返回域消失
 * ⇒ 签名谎报（少一个分支）+ 契约真实违约被漏报（L1 门禁假绿）。
 *
 * 分叉两路（原生同语义）：
 * - 命中路径：该臂体（`cases[k]`）；
 * - 不命中路径：继续按序匹配后续臂（后续臂也可能是非字面量测试 ⇒ 递归分叉），
 *   全不命中则走 default（无 default ⇒ 隐式 no-match 臂 = undefined）。
 *
 * 两路经 $fork 同构机制合并（集合 side-table 按臂 overlay；臂内
 * NudoReturn/NudoThrow 不冒泡污染兄弟臂）⇒ 返回域 = 两路并集。
 *
 * 共享体（`case a: case b:` 合并出的同一 run）只执行一次（同抽象判别式路径
 * 的 seenRuns 口径）——非幂等副作用不得被分叉放大。
 */
function switchForked(
  cases: Array<{ test: Abs; run: () => Abs }>,
  dflt: (() => Abs) | undefined,
  k: number,
  discValue: unknown,
  cache: Map<() => Abs, ForkArm>,
): Abs {
  const exits = loopExitsAls.getStore();
  beginCollectionFork();
  const armOverlays: Array<ReturnType<typeof popCollectionArm>> = [];
  const armYsList: Array<GenYieldCollector | null> = [];
  const runArm = (fn: () => Abs): ForkArm => {
    pushCollectionArm();
    try {
      // 分叉臂：命中与否不可判定 ⇒ 臂内 break/continue 信号标记 abstract
      // （同 $fork 抽象臂）
      const r = withIsolatedYields(() => withAbstractForkArm(() => runForkArm(fn)));
      armYsList.push(r.ys);
      return r.v;
    } finally {
      armOverlays.push(popCollectionArm());
    }
  };
  /** 已执行过的共享体：复用其结局（不重复执行副作用） */
  const replay = (arm: ForkArm): Abs => {
    if (arm.kind === "ret") throw new NudoReturn(arm.v);
    if (arm.kind === "throw") throw new NudoThrow(arm.v);
    return arm.v;
  };
  let a: ForkArm;
  let b: ForkArm;
  try {
    const hit = cases[k]!;
    const cachedHit = cache.get(hit.run);
    a = cachedHit ?? runArm(hit.run);
    if (!cachedHit) cache.set(hit.run, a);
    b = runArm(() => {
      for (let j = k + 1; j < cases.length; j++) {
        const c = cases[j]!;
        const tvR = litValue(c.test);
        if (!tvR.ok) return switchForked(cases, dflt, j, discValue, cache);
        if (tvR.value === discValue) {
          const cached = cache.get(c.run);
          if (cached) return replay(cached);
          return asAbsVal(c.run());
        }
      }
      if (!dflt) return undef();
      const cachedDflt = cache.get(dflt);
      if (cachedDflt) return replay(cachedDflt);
      return asAbsVal(dflt());
    });
  } finally {
    endCollectionFork(armOverlays);
    if (yieldStack.length > 0) mergeArmYields(armYsList);
  }
  return settleForkArms(a, b, exits);
}


// throws
// --- throws ---

/** transpile `throw x` → `$throw(x)` */
export function $throw(v: Abs): never {
  throw new NudoThrow(v);
}

/**
 * fork 臂是否以控制流退出（return / throw）。
 * 生成代码用此决定 continue-path free-write 标志：退出臂的写
 * 不得污染 join 后的 continue 绑定。
 */
export function $isForkExit(e: unknown): boolean {
  return isNudoReturn(e) || isNudoThrow(e);
}

/**
 * catch 参数：从 NudoThrow 取出 Abs；宿主 Error 补 name/message；否则 unknown。
 *
 * Bug 211：**控制流信号（break / continue）不是异常**——原生里 `break` 是
 * 控制流完成值，根本到不了 catch 处理器（catch 体不跑、循环照常退出）。
 * 引擎的循环信号是 Error 子类 ⇒ 会被 catch 接住；此前 catch 体把信号「吃掉」
 * （副作用照跑、循环还不退出）。修法：控制流信号在此**重抛** ⇒ catch 体不执行、
 * 信号透传到循环捕获点（catch 体只吞真异常）。
 */
export function $catchVal(e: unknown): Abs {
  if (isNudoThrow(e)) return e.absValue;
  if (e instanceof NudoLoopSignal) throw e;
  if (e instanceof Error) {
    const name = e.name || "Error";
    const msgAbs: Abs =
      typeof e.message === "string"
        ? abs(
            { k: "prim", type: "string" },
            { op: "lit", value: e.message as unknown as import("../../term.ts").LiteralValue },
            pTrue,
            "exact",
          )
        : abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    return abs(
      {
        k: "brand",
        name,
        shape: objOf({
          name: {
            value: abs(
              { k: "prim", type: "string" },
              { op: "lit", value: name as unknown as import("../../term.ts").LiteralValue },
              pTrue,
              "exact",
            ),
          },
          message: { value: msgAbs },
        }),
      },
      undefined,
      undefined,
      "path",
    );
  }
  return unknown;
}
