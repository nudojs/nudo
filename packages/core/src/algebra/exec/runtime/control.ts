/**
 * 控制流：loop/try 退出栈、$fork/$for/$while、$throw。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { bumpBForkBudget } from "../../call-budget.ts";
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, numLit, unknown, type Confidence } from "../../abs.ts";
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
  NudoThrow, isNudoThrow, noBody, undef, writeInPlace, clearStaleTermPred,
  asAbsVal, callAtFunctionBoundary, $lit, litTruth, isDefinitelyTrue, isDefinitelyFalse,
  currentExecPhi, withExecPhi, isNudoReturn, isNudoBreak, isNudoContinue,
  NudoReturn, NudoLoopSignal, loopExitsAls, throwExitsAls, tryMarksAls, softFrameActiveAls,
  runWithLoopExits, takeLoopExits, takeThrowExits, pushLoopExit, pushThrowExit, $pushLoopExit,
} from "./state.ts";
import { $unknown, $eq, $ne, $lt, $le, $gt, $ge, $add, $sub, $typeof, $not } from "./ops.ts";
import { $arr } from "./containers.ts";
import { notePromiseExecutorFork } from "../../builtins.ts";
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

/** 生成器 yield 收集：抽象分支时标记路径敏感，禁止 exact 元组出货 */
export let yieldStack: Abs[][] = [];
export let genPathSensitive = 0;
export let genJoinOverride: Abs | null = null;
export function setGenJoinOverride(v: Abs | null): void { genJoinOverride = v; }
export function bumpGenPathSensitive(): void { genPathSensitive++; }

export function withIsolatedYields<T>(fn: () => T): { v: T; ys: Abs[] | null } {
  const top = yieldStack[yieldStack.length - 1];
  // 无收集器：不换槽、不建 armYs（fork 热路径常态）
  if (!top) return { v: fn(), ys: null };
  const armYs: Abs[] = [];
  yieldStack[yieldStack.length - 1] = armYs;
  try {
    return { v: fn(), ys: armYs };
  } finally {
    yieldStack[yieldStack.length - 1] = top;
  }
}

export function mergeArmYields(armYsList: Array<Abs[] | null>): void {
  const top = yieldStack[yieldStack.length - 1];
  if (!top || armYsList.length === 0) return;
  const concrete = armYsList.filter((x): x is Abs[] => x !== null);
  if (concrete.length === 0) return;
  if (concrete.length === 1) {
    top.push(...concrete[0]!);
    return;
  }
  // 多臂：join 各臂 yield 序列，并标记路径敏感
  let joined: Abs | null = null;
  for (const ys of concrete) {
    joined = joined ? joinAbs(joined, $arr(ys)) : $arr(ys);
  }
  genPathSensitive++;
  if (joined) genJoinOverride = joined;
  // 父收集器仍并入全部臂元素（过近似），conf 由 genJoinOverride/path 敏感性压低
  for (const ys of concrete) top.push(...ys);
}

export function runForkArm(arm: () => Abs, exits: Abs[] | undefined): ForkArm {
  try {
    return { kind: "val", v: asAbsVal(arm()) };
  } catch (e) {
    if (isNudoReturn(e)) {
      exits?.push(e.absValue);
      return { kind: "ret", v: e.absValue };
    }
    if (isNudoThrow(e)) {
      pushThrowExit(e.absValue);
      return { kind: "throw", v: e.absValue };
    }
    throw e;
  }
}

export function settleForkArms(a: ForkArm, b: ForkArm, exits: Abs[] | undefined): Abs {
  // 避开 filter 数组分配：两臂直判
  const aThrow = a.kind === "throw";
  const bThrow = b.kind === "throw";
  if (aThrow && bThrow) {
    // 全 throw：兄弟臂已探索完，再抛 join（调用边界收成 throws）
    throw new NudoThrow(joinAbs(a.v, b.v));
  }
  // 混合 throw + val/ret：throws 已在 throwExits；继续处理非 throw 臂
  const first = aThrow ? b : a;
  const second = aThrow ? a : b;
  if (first.kind === "ret" && second.kind === "ret") {
    throw new NudoReturn(joinAbs(first.v, second.v));
  }
  if (aThrow !== bThrow) {
    // 恰一臂 throw：只携带非 throw 臂
    if (first.kind === "ret") {
      if (!exits) throw new NudoReturn(first.v);
      return undef();
    }
    return first.v;
  }
  if (first.kind === "ret") {
    if (!exits) throw new NudoReturn(first.v);
    return second.kind === "val" ? second.v : undef();
  }
  if (second.kind === "ret") {
    if (!exits) throw new NudoReturn(second.v);
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
  // 截断已由 bumpBForkBudget → noteBForkTruncation 上报（nudo:fork-truncated）
  if (!bumpBForkBudget()) return unknown;
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
  const armYsList: Array<Abs[] | null> = [];
  let a: ForkArm;
  let b: ForkArm;
  try {
    pushCollectionArm();
    try {
      const r = withExecPhi(phiTrue, () =>
        withIsolatedYields(() => runForkArm(consequent, exits)),
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
          withIsolatedYields(() => runForkArm(alternate, exits)),
        );
        b = r.v;
        armYsList.push(r.ys);
      } finally {
        arms.push(popCollectionArm());
      }
    } else {
      // 隐式 else：无写也必须占一臂，否则条件写入会被 merge 成必然（P0）
      pushCollectionArm();
      try {
        b = { kind: "val", v: undef() };
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

export const DEFAULT_MAX_LOOP_ITERS = 8;

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
  },
): Abs {
  let state = init;
  let exitJoin: Abs | undefined;
  let extJoin: Abs | undefined;
  const pack = opts?.pack;
  const unpack = opts?.unpack;
  const snapCounter = (): void => {
    exitJoin = exitJoin ? joinAbs(exitJoin, state) : state;
  };
  const snapExt = (): void => {
    if (!pack) return;
    const p = pack();
    extJoin = extJoin ? joinAbs(extJoin, p) : p;
  };
  const applyExtJoin = (): void => {
    if (!extJoin || !pack || !unpack) return;
    unpack(joinAbs(extJoin, pack()));
  };

  for (let i = 0; i < maxIters; i++) {
    const t = test(state);
    if (isDefinitelyFalse(t)) {
      snapCounter();
      snapExt();
      applyExtJoin();
      return exitJoin ?? state;
    }

    const abstractTest = !isDefinitelyTrue(t);
    if (abstractTest) {
      snapCounter();
      snapExt();
    }

    let afterBody: Abs;
    try {
      afterBody = body(state);
    } catch (e) {
      // break 吸收 → 本轮为最终态后退出；continue 吸收 → 体提前完成，
      // 用 pack 收集已发生的绑定写（continue 前语句的副作用保留）
      if (isNudoBreak(e, opts?.label)) {
        snapCounter();
        snapExt();
        applyExtJoin();
        return exitJoin ?? state;
      }
      if (isNudoContinue(e, opts?.label)) {
        // 体未走完 return；循环变量已发生的写无法从调用点闭包读取
        // （init 以字面量入参，JS 作用域无该绑定）——以 state 近似
        afterBody = state;
      } else if (isNudoReturn(e) || isNudoThrow(e)) {
        throw e;
      } else {
        throw e;
      }
    }
    const next = step(afterBody);
    // 抽象条件：本轮 body 完成后的绑定也是合法出口（下一轮 test 可能为假）
    if (abstractTest) {
      state = afterBody;
      snapExt();
    }

    if (i > 0) {
      const nv = litValue(next);
      const sv = litValue(state);
      const stuck =
        (nv !== undefined && sv !== undefined && nv === sv) ||
        (nv === undefined && sv === undefined && leqAbs(next, state).ok);
      if (stuck) {
        state = next;
        snapCounter();
        snapExt();
        applyExtJoin();
        return exitJoin ?? next;
      }
    }
    state = next;
  }

  snapCounter();
  snapExt();
  applyExtJoin();
  return exitJoin ?? state;
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

  for (let i = 0; i < maxIters; i++) {
    const t = test(state);
    if (isDefinitelyFalse(t)) {
      return exitJoin ? joinAbs(exitJoin, state) : state;
    }
    if (!isDefinitelyTrue(t)) {
      exitJoin = exitJoin ? joinAbs(exitJoin, state) : state;
    }
    const next = step(state);
    if (i > 0) {
      const nv = litValue(next);
      const sv = litValue(state);
      const stuck =
        (nv !== undefined && sv !== undefined && nv === sv) ||
        (nv === undefined && sv === undefined && leqAbs(next, state).ok);
      if (stuck) {
        return exitJoin ? joinAbs(exitJoin, next) : next;
      }
    }
    state = next;
  }
  return exitJoin ? joinAbs(exitJoin, state) : state;
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
  const snapExit = (): void => {
    if (!pack) return;
    const s = pack();
    exitJoin = exitJoin ? joinAbs(exitJoin, s) : s;
  };
  const applyExitJoin = (): void => {
    if (!exitJoin || !pack || !unpack) return;
    unpack(joinAbs(exitJoin, pack()));
  };
  for (let i = 0; i < maxIters; i++) {
    const t = test();
    if (isDefinitelyFalse(t)) {
      applyExitJoin();
      return;
    }
    // 抽象条件：当前绑定是合法出口之一，先 snapshot 再进 body
    if (!isDefinitelyTrue(t)) snapExit();
    try {
      body();
    } catch (e) {
      if (isNudoBreak(e, opts?.label)) {
        applyExitJoin();
        return;
      }
      if (isNudoContinue(e, opts?.label)) continue; // 体提前结束，副作用已在绑定
      if (isNudoReturn(e) || isNudoThrow(e)) throw e;
      throw e;
    }
  }
  // 预算耗尽：最后一轮条件仍可能为真 → 当前态也是出口
  snapExit();
  applyExitJoin();
}

// $switch（fork 臂隔离）
export function $switch(
  disc: Abs,
  cases: Array<{ test: Abs; run: () => Abs }>,
  dflt?: () => Abs,
): Abs {
  const dv = litValue(disc);
  if (dv !== undefined) {
    for (const c of cases) {
      const tv = litValue(c.test);
      // switch case 匹配是严格相等（===）：NaN 不匹配 NaN case；0 与 -0 互配。
      // Object.is 是 SameValue（NaN 相等），会假匹配 NaN case（假精确）。
      if (tv !== undefined && tv === dv) return asAbsVal(c.run());
    }
    return dflt ? asAbsVal(dflt()) : undef();
  }

  const exits = loopExitsAls.getStore();
  beginCollectionFork();
  const armOverlays: Array<ReturnType<typeof popCollectionArm>> = [];
  const armYsList: Array<Abs[] | null> = [];
  const runArm = (fn: () => Abs): ForkArm => {
    pushCollectionArm();
    try {
      const r = withIsolatedYields(() => runForkArm(fn, exits));
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
      // 隐式 no-match 臂：全 case 不命中时 fall-through（P0-2）
      pushCollectionArm();
      try {
        results.push({ kind: "val", v: undef() });
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
  // 混合：ret/throw 臂已进 exits；语句位只携带 val 臂值继续
  const valParts = nonThrow.filter((r) => r.kind === "val").map((r) => r.v);
  if (valParts.length === 0) return undef();
  return valParts.reduce((a, b) => joinAbs(a, b));
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

/** catch 参数：从 NudoThrow 取出 Abs；宿主 Error 补 name/message；否则 unknown */
export function $catchVal(e: unknown): Abs {
  if (isNudoThrow(e)) return e.absValue;
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
