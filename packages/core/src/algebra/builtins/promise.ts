/**
 * Promise 构造 / then 链 / 静态方法 + micro 队列
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, bigintLit, unknown, never } from "../abs.ts";
import { joinAbs, objOf } from "../objects.ts";
import { isMapAbs, isSetAbs } from "../collections.ts";
import { applyCallbackValue, undefAbs, asAbs, instantiateReturn } from "../hof.ts";
import { absFunction, getFnImpl } from "../abs-fn.ts";
import { pTrue } from "../pred.ts";
import { defaultLeakBudget } from "../leak.ts";
import { emptyEnv } from "../ast-env.ts";
import { isNullishLitAbs } from "../surface.ts";
import { markFreshInstance } from "../instance-id.ts";
import {
  noteAbsTruncation,
  PROMISE_MICRO_OVERFLOW_LABEL,
  PROMISE_MICRO_ERROR_LABEL,
} from "../call-budget.ts";
import { numPrim, str, boolPrim, noBody } from "./shared.ts";
import { setPropFlags } from "./invariants.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";

const promiseExecStack: number[] = [];

// N1：fork 臂 = 替代路径。臂 token（parent 指针树）用于 executor settle 的
// 路径判定——同路径（祖先链上已有 settle）顺序双 settle 是原生 first-wins
// no-op；兄弟臂 / join 后延续的 settle 不在链上 → 独立路径首个 settle，
// resolve/reject 通道都必须收集（不得静默丢 reject 臂 → 假确定 fulfilled）。
const settleArmParents = new Map<number, number>();
let settleArmCounter = 0;
let currentSettleArm = 0;

/**
 * N5：单个 executor scope 的路径面收集。arms = 本 scope 进入过的全部替代
 * 路径臂（fork/switch 臂、抽象循环条件的体臂/出口臂）；任一臂走到末端而
 * 无 settle → 存在永不 settle 的路径（原生 promise 悬挂）→ 结果必须带
 * unsettled 通道。hangSettled = 确定性死循环截断（预算硬上限处条件仍具体
 * 真）时悬挂路径是否已有 settle（token-0/臂子树 settle，且发生在截断点
 * 之前——join 后的 post-loop settle 不在悬挂路径上）。
 */
interface PromiseExecutorArms {
  arms: number[];
  hang: { settleIdx: number; arms: number[]; depth: number } | null;
  hangSettled: boolean | null;
  /** scope 深度（enter 时栈深）——settle/exit 事件按深度过滤（内层/姊妹
   * executor 的 settle 不 settle 本 promise） */
  depth: number;
}

const promiseExecArms: PromiseExecutorArms[] = [];
// settle 事件序（token × scope 深度）——hang 快照按序切前缀
const settleLogToken: number[] = [];
const settleLogDepth: number[] = [];
// N5：退出事件（fork 臂内 throw/return——延续被截断：join 后的 trailing
// settle 不在退出路径上，只有退出点之前的路径 settle 覆盖）。clock 取
// settleLog 长度（事件序单调）。
const exitLogArm: number[] = [];
const exitLogClock: number[] = [];

function notePromiseSettle(token: number): void {
  if (promiseExecStack.length === 0) return;
  settleLogToken.push(token);
  settleLogDepth.push(promiseExecStack.length);
}

/** N5：runForkArm 捕获 throw/return 时打点（executor 外零开销） */
export function notePromiseForkExit(token: number): void {
  if (promiseExecStack.length === 0) return;
  exitLogArm.push(token);
  exitLogClock.push(settleLogToken.length);
}

export function enterPromiseExecutorScope(): void {
  promiseExecStack.push(0);
  promiseExecArms.push({ arms: [], hang: null, hangSettled: null, depth: promiseExecStack.length });
}

export function leavePromiseExecutorScope(settledArms: number[]): boolean {
  const rec = promiseExecArms.pop() ?? null;
  promiseExecStack.pop();
  // 覆盖判定必须在全局 token 树清空前（外层 leave 清 settleArmParents/
  // settle/exit 事件序——快照在 rec 内，树在模块级）
  const unsettled = promiseArmsUnsettled(rec, settledArms);
  if (promiseExecStack.length === 0) {
    settleArmCounter = 0;
    currentSettleArm = 0;
    settleArmParents.clear();
    settleLogToken.length = 0;
    settleLogDepth.length = 0;
    exitLogArm.length = 0;
    exitLogClock.length = 0;
  }
  return unsettled;
}

/** executor scope 是否活跃（$fork/$switch 隐式臂打点的零开销门闩） */
export function promiseExecutorActive(): boolean {
  return promiseExecStack.length > 0;
}

/**
 * N5：确定性死循环截断（concreteExhausted——条件在硬上限处仍具体真）。
 * 悬挂路径 = 循环前的全部语句 + 死循环体；只有截断点之前、同 scope 深度
 * 的 token-0 / 臂子树 settle 能证明其已 settle。executor 外零开销。
 */
export function notePromiseExecutorHang(): void {
  if (promiseExecStack.length === 0) return;
  const rec = promiseExecArms[promiseExecArms.length - 1]!;
  // 首个 hang 即唯一可达的悬挂点（确定性死循环之后的语句不可达）
  if (!rec.hang) {
    rec.hang = { settleIdx: settleLogToken.length, arms: [...rec.arms], depth: promiseExecStack.length };
  }
}

function hangPathSettles(hang: { settleIdx: number; arms: number[]; depth: number }, scopeArms: number[]): boolean {
  const children = armChildrenOf(scopeArms);
  const subtree = new Set<number>();
  const visit = (t: number): void => {
    subtree.add(t);
    for (const c of children.get(t) ?? []) visit(c);
  };
  for (const a of hang.arms) visit(a);
  for (let i = 0; i < hang.settleIdx; i++) {
    if (settleLogDepth[i] !== hang.depth) continue;
    const t = settleLogToken[i]!;
    if (t === 0 || subtree.has(t)) return true;
  }
  return false;
}

/** 同 scope 臂的 children 表（parent → 臂列表；跨 scope 边不算——内层
 * executor 的 settle 不 settle 外层 promise） */
function armChildrenOf(scopeArms: number[]): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const a of scopeArms) {
    const p = settleArmParents.get(a) ?? 0;
    const list = children.get(p);
    if (list) list.push(a);
    else children.set(p, [a]);
  }
  return children;
}

/** $fork 在 executor 内发生时打点（多臂 resolve 需 join，不得 first-wins 假精确） */
export function notePromiseExecutorFork(): void {
  if (promiseExecStack.length > 0) {
    promiseExecStack[promiseExecStack.length - 1]!++;
  }
}

/** N1：fork 臂执行区间（runForkArm）压入新路径 token；executor 外零开销。
 * N5：token 同时记入当前 executor scope 的臂表（覆盖判定用）。 */
export function enterPromiseForkArm(): void {
  if (promiseExecStack.length === 0) return;
  settleArmCounter += 1;
  settleArmParents.set(settleArmCounter, currentSettleArm);
  currentSettleArm = settleArmCounter;
  const top = promiseExecArms[promiseExecArms.length - 1];
  if (top) top.arms.push(settleArmCounter);
}

export function leavePromiseForkArm(): void {
  if (promiseExecStack.length === 0) return;
  currentSettleArm = settleArmParents.get(currentSettleArm) ?? 0;
}

/** N1：当前路径（fork 臂祖先链）上是否已有 settle——有则本次 settle 是同
 * 路径 first-wins no-op。链走穿（防御环，token 树构造上无环）视为活——
 * 收集是过近似方向（sound）。 */
export function promiseSettlePathHas(settledArms: number[]): boolean {
  let t = currentSettleArm;
  for (let i = 0; i <= settleArmParents.size; i++) {
    if (settledArms.includes(t)) return true;
    if (t === 0) return false;
    t = settleArmParents.get(t) ?? 0;
  }
  return false;
}

export function currentPromiseSettleArm(): number {
  return currentSettleArm;
}

/**
 * N5：executor 是否存在「走到末端而无 settle」的路径（fork/switch 单臂
 * settle、抽象循环出口无 post-loop settle、确定性死循环截断）→ 原生
 * promise 可能永不 settle，结果必须带 unsettled 通道（禁止 wrong-definite）。
 *
 * 臂 A 覆盖判定（同 scope）：
 * - A 自身有 settle（首个活 settle）；
 * - 祖先链（含 token 0 = join 后主路径）有 settle——trailing settle 覆盖
 *   全部臂（`if (c) resolve(1); resolve(2);` 仍确定）；
 * - 全部同 scope 子臂覆盖——穿过 A 的每条路径都在 A 内嵌 fork 中 settle。
 * 悬挂（确定性死循环）：hangSettled 由 leavePromiseExecutorScope 按事件序
 * 判定（截断点之后的 post-loop settle 不算）。
 */
function promiseArmsUnsettled(rec: PromiseExecutorArms | null, settledArms: number[]): boolean {
  if (!rec) return false;
  if (rec.hang && rec.hangSettled === null) {
    rec.hangSettled = hangPathSettles(rec.hang, rec.arms);
  }
  if (rec.hangSettled === false) return true;
  const arms = rec.arms;
  if (arms.length === 0) return false;
  const settled = new Set(settledArms);
  const children = armChildrenOf(arms);
  // 退出臂（throw/return）：延续被截断——只有退出点之前、自身/祖先/同 scope
  // 子树内的 settle 覆盖（join 后 trailing settle 不在退出路径上）
  const exitClock = new Map<number, number>();
  for (let i = 0; i < exitLogArm.length; i++) exitClock.set(exitLogArm[i]!, exitLogClock[i]!);
  const settleBeforeOnPath = (t: number, clock: number): boolean => {
    const onPath = new Set<number>([t, 0]);
    let a = settleArmParents.get(t) ?? 0;
    while (a !== 0) {
      onPath.add(a);
      a = settleArmParents.get(a) ?? 0;
    }
    const descend = (x: number): void => {
      for (const c of children.get(x) ?? []) {
        onPath.add(c);
        descend(c);
      }
    };
    descend(t);
    for (let i = 0; i < clock; i++) {
      if (settleLogDepth[i] === rec.depth && onPath.has(settleLogToken[i]!)) return true;
    }
    return false;
  };
  const memo = new Map<number, boolean>();
  const covered = (t: number): boolean => {
    const hit = memo.get(t);
    if (hit !== undefined) return hit;
    memo.set(t, false); // 防御环（token 树构造上无环）
    let r: boolean;
    const exitAt = exitClock.get(t);
    if (exitAt !== undefined) {
      r = settled.has(t) ? true : settleBeforeOnPath(t, exitAt);
    } else if (settled.has(t) || settled.has(0)) {
      r = true;
    } else {
      r = false;
      let a = settleArmParents.get(t) ?? 0;
      while (a !== 0) {
        if (settled.has(a)) {
          r = true;
          break;
        }
        a = settleArmParents.get(a) ?? 0;
      }
      if (!r) {
        const kids = children.get(t);
        r = !!kids && kids.length > 0 && kids.every(covered);
      }
    }
    memo.set(t, r);
    return r;
  };
  return arms.some((a) => !covered(a));
}

function promiseAbs(inner: Abs, conf: Abs["conf"] = "path"): Abs {
  // R2b：每个 Promise.resolve / then 链 / 构造器调用产出新 promise 对象
  //（采纳路径——Promise.resolve(既有 promise) / unwrapThenable——返回
  // 原 Abs 引用，不经此构造）——打新鲜实例标
  return markFreshInstance(abs({ k: "eff", eff: "promise", inner }, undefined, undefined, conf));
}

/**
 * Bug 36：确定拒绝的 promise——resolved 域 never（fulfilled 臂不可能），
 * rejected 通道携带 reason（catch/两参 then 的 onRejected 实参来源）。
 * 拒绝透传（nullish handler ≡ Identity）经同款构造保持通道。
 */
function promiseRejected(reason: Abs, conf: Abs["conf"] = "path"): Abs {
  return markFreshInstance(
    abs({ k: "eff", eff: "promise", inner: never, rejected: reason }, undefined, undefined, conf),
  );
}

/** R3：state 未知 promise（unsettled 标记——catch/then 的拒绝臂保持活） */
function promiseUnsettled(inner: Abs, conf: Abs["conf"] = "path"): Abs {
  return markFreshInstance(
    abs({ k: "eff", eff: "promise", inner, unsettled: true }, undefined, undefined, conf),
  );
}

/** R3b：effectFree∧closed facet（无写 + 不读外层可变态）——同步执行与
 * 原生微任务执行无任何可观测差（promise 回调原生异步跑，只有不碰外层
 * 态的回调两个时刻求值等价）。 */
function syncFacetOf(h: Abs | undefined): boolean {
  if (!h) return false;
  const impl = getFnImpl(h);
  return impl?.effectFree === true && impl.closed === true;
}

/** R3b：同步执行的 then 回调返回值 → 结果 promise：
 * - eff(promise) → 递归采纳（inner 与 rejected/unsettled 通道随返回 promise，
 *   原生 then 回调返回 thenable 的采纳同款）；
 * - unknown 单例（可能是 thenable，采纳面不可判）→ unsettled promise<unknown>；
 * - 其余 → unwrapThenable 后 settled promise。 */
function adoptHandlerReturn(mapped: Abs | undefined, conf: Abs["conf"]): Abs {
  if (mapped && isPromiseEff(mapped)) {
    const sh = mapped.shape as { inner: Abs; rejected?: Abs; unsettled?: boolean };
    return markFreshInstance(
      abs(
        {
          k: "eff",
          eff: "promise",
          inner: sh.inner,
          ...(sh.rejected !== undefined ? { rejected: sh.rejected } : {}),
          ...(sh.unsettled ? { unsettled: true } : {}),
        },
        undefined,
        undefined,
        conf,
      ),
    );
  }
  const next = !mapped || isUnknownSingleton(mapped) ? unknown : unwrapThenable(mapped);
  return isUnknownSingleton(next) ? promiseUnsettled(next, conf) : promiseAbs(next, conf);
}

/** promise 的已知拒绝 reason（无通道 → undefined） */
function rejectedOf(recv: Abs): Abs | undefined {
  if (recv.shape.k !== "eff" || recv.shape.eff !== "promise") return undefined;
  return (recv.shape as { rejected?: Abs }).rejected;
}

function promiseUnknown(): Abs {
  return markFreshInstance(
    abs({ k: "eff", eff: "promise", inner: unknown, unsettled: true }, undefined, undefined, "partial"),
  );
}

/** unknown 单例（无 term 的 unknown——对值与 settle 均无信息） */
function isUnknownSingleton(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "unknown" && a.term === undefined;
}

/**
 * R3：值可能自带 thenable 采纳面（resolve/then 回调返回值的 settle 采纳不可
 * 判）→ promise 标 unsettled（catch/then 拒绝臂保持活）。any/unknown（无
 * term）/fn/open obj/含此类成员的 sum 都可能实现 then；闭 obj 带 then 槽同。
 */
export function thenableRiskOf(v: Abs): boolean {
  const k = v.shape.k;
  if (k === "any") return true;
  if (k === "unknown") return v.term === undefined;
  if (k === "fn") return true;
  if (k === "obj") {
    const o = v.shape as { slots: Record<string, unknown>; open?: boolean };
    return o.open === true || "then" in o.slots;
  }
  if (k === "sum") return (v.shape as { members: Abs[] }).members.some(thenableRiskOf);
  return false;
}

/** eff(promise) 形态判定（通道采纳用） */
function isPromiseEff(v: Abs): boolean {
  return v.shape.k === "eff" && v.shape.eff === "promise";
}

/**
 * R3 settle 三分类谓词：确定 fulfilled = 无拒绝通道且无 unsettled 标记
 * （inner 无信息也算确定 fulfilled——值未知但态已知，catch 回调原生死
 * 代码）。unsettled 标记是 state 未知的唯一信号（unknown 单例 inner 不再
 * 单独隐含——executor resolve(unknown) 是确定 fulfilled·值未知）。
 */
function settledFulfilledOf(recv: Abs): boolean {
  if (recv.shape.k !== "eff" || recv.shape.eff !== "promise") return false;
  const sh = recv.shape as { rejected?: Abs; unsettled?: boolean; inner: Abs };
  return sh.rejected === undefined && sh.unsettled !== true && sh.inner.shape.k !== "never";
}

/** resolve 实参是 thenable → 展开 inner（与 Promise.resolve 同口径） */
function unwrapThenable(v: Abs): Abs {
  if (v.shape.k === "eff" && v.shape.eff === "promise") return v.shape.inner;
  return v;
}

/** JS 原始值 / null → Abs 字面量（resolveJs 等宿主回调桥） */
function litFromJs(value: unknown): Abs {
  if (value === undefined) return undefAbs();
  if (value === null) {
    return abs({ k: "unknown" }, { op: "lit", value: null }, pTrue, "exact");
  }
  if (typeof value === "number") return numLit(value);
  if (typeof value === "string") return strLit(value);
  if (typeof value === "boolean") return boolLit(value);
  if (typeof value === "bigint") return bigintLit(value);
  return unknown;
}

// then/catch 回调是微任务：不得在同步 then() 里跑（否则外层 return 前被写回）。
// 在每次求值出口（runTranspiled / callTranspiledExportFull）排空，对齐原生执行序；
// 模块级排队不得窜到后续无关文件的调用窗口。
const promiseMicros: Array<() => void> = [];

/** 队列硬上限：无界增长是 LSP 长会话泄漏点（只进不出的模块求值路径） */
export const MAX_PROMISE_MICROS = 1024;

export function queuePromiseMicro(task: () => void): void {
  if (promiseMicros.length >= MAX_PROMISE_MICROS) {
    // 背压：丢弃新任务并记录截断（不得无界累积闭包）
    noteAbsTruncation(PROMISE_MICRO_OVERFLOW_LABEL);
    return;
  }
  promiseMicros.push(task);
}

export function getPromiseMicrosLength(): number {
  return promiseMicros.length;
}

export function drainPromiseMicros(): void {
  while (promiseMicros.length > 0) {
    const task = promiseMicros.shift()!;
    try {
      task();
    } catch {
      // 微任务抛错不改写已计算的同步返回值，但必须可观测（不得静默）
      noteAbsTruncation(PROMISE_MICRO_ERROR_LABEL);
    }
  }
}

/**
 * new Promise(executor)：调用 executor(resolve, reject)，收集 resolve 实参作为
 * promise inner。原生只认第一次 settle——顺序双 resolve 取第一次；执行器内
 * $fork 分叉时各臂 settle 值 join（路径敏感，不得 first-wins 假精确）。
 * reject 不填 resolved 通道；永不 settle / 抽象 fn / 执行抛 → promise<unknown>。
 */
export function evalPromiseCtor(args: Abs[]): Abs {
  const executor = args[0];
  // Bug 16：原生 IsCallable(executor)（"Promise resolver … is not a function"）。
  // 必须在 enterPromiseExecutorScope/try 之前校验——下方 catch 会把执行器内
  // NudoThrow 吞成 rejected promise。缺省 ≡ undefined、prim（原始值恒不可
  // 调用）、闭对象字面量、tuple/arr → 确定 TypeError（hard）；any/unknown/
  // open obj/brand/eff/含不可调成员 union → may；fn 形/JS 函数继续。
  {
    const a =
      executor && typeof executor === "object" && "shape" in (executor as object)
        ? (executor as Abs)
        : undefined;
    const callable =
      typeof executor === "function" ||
      !!a &&
        ((a.shape as { k?: string }).k === "fn" || getFnImpl(a) !== undefined);
    if (!callable) {
      // nullish 字面量（shape k:"unknown"+lit term）也确定不可调用
      const nullishLit =
        !!a && a.term?.op === "lit" && (a.term.value === null || a.term.value === undefined);
      const definitelyUncallable =
        !a ||
        nullishLit ||
        (a.shape as { k?: string }).k === "prim" ||
        (a.shape as { k?: string }).k === "tuple" ||
        (a.shape as { k?: string }).k === "arr" ||
        ((a.shape as { k?: string }).k === "obj" &&
          (a.shape as { open?: boolean }).open !== true);
      if (definitelyUncallable) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      recordMayThrow({ kind: "TypeError", cause: "Promise executor may not be callable" });
    }
  }

  const resolveValues: Abs[] = [];
  const rejectValues: Abs[] = [];
  // R3：resolve 值的 thenable 采纳面（不可判 settle → unsettled）
  const resolveRisks: boolean[] = [];
  // N1：已 settle 的路径 token（fork 臂 = 替代路径）：first-wins 只在同路径
  // 成立——祖先链上已有 settle 的后续 settle 是原生 no-op；兄弟臂 settle 是
  // 独立路径首个 settle，resolve/reject 全通道收集（不得丢 reject 臂）。
  const settledArms: number[] = [];
  // R3：eff(promise) resolve 实参（唯一活 settle → 全通道递归采纳；多活
  // settle → inner 已 unwrap 进 join 面，rejected/unsettled 通道仍并入）
  const effSettles: Abs[] = [];

  const onResolve = (value?: unknown): Abs => {
    const raw = asAbs(value) ?? litFromJs(value);
    if (promiseSettlePathHas(settledArms)) return undefAbs(); // 同路径 no-op
    const v = unwrapThenable(raw);
    const token = currentPromiseSettleArm();
    settledArms.push(token);
    notePromiseSettle(token); // N5：hang 快照按事件序切前缀
    resolveValues.push(v);
    if (isPromiseEff(raw)) {
      effSettles.push(raw);
      resolveRisks.push(true);
    } else {
      resolveRisks.push(thenableRiskOf(v));
    }
    return undefAbs();
  };
  // Bug 36：reject 通道与 resolve 对称收集（fork 臂 join；first-wins 同款）
  const onReject = (reason?: unknown): Abs => {
    const raw = asAbs(reason) ?? litFromJs(reason);
    if (promiseSettlePathHas(settledArms)) return undefAbs(); // 同路径 no-op
    const token = currentPromiseSettleArm();
    settledArms.push(token);
    notePromiseSettle(token); // N5：hang 快照按事件序切前缀
    rejectValues.push(raw);
    return undefAbs();
  };

  // 求值引擎 $callNamed("r", r, …) 对 JS 函数直调；Abs fn 走 applyCallbackValue/$call
  // 必须包成 Abs fn：裸 JS 函数当实参时 $call 认不出 apply，fork 臂里 r(1) 会掉成 unknown
  const resolveAbs = absFunction(["value"], {
    body: noBody,
    apply: (args) => onResolve(args[0]),
  }, { ctor: false }); // Bug 9：内建 resolving function 不可 new
  const rejectAbs = absFunction(["reason"], {
    body: noBody,
    apply: (args) => onReject(args[0]),
  }, { ctor: false });

  enterPromiseExecutorScope();
  // executed = executor 真跑过（抽象 fn / 不可调用 → promise<unknown>）。
  // finally 保证 scope 恒弹出：早退 return / 抛出走 catch 都不得泄漏栈帧
  //（泄漏会让后续所有 $fork 误记入已死的 executor 计数与路径 token 表）。
  let executed = true;
  // Bug 310：executor 抛出的 reason（尚无 settle 时 → promise 被拒绝）
  let threwReason: Abs | undefined;
  // N5：scope 路径面覆盖判定（leave 在 token 树清空前算好——fork/switch/
  // loop 臂 + hang + throw/return 退出臂）
  let armUnsettled = false;
  try {
    if (typeof executor === "function") {
      (executor as (...a: unknown[]) => unknown)(
        (value?: unknown) => onResolve(value),
        (reason?: unknown) => onReject(reason),
      );
    } else if (executor && typeof executor === "object" && "shape" in (executor as object)) {
      const impl = getFnImpl(executor as Abs);
      const k = (executor as Abs).shape.k;
      // 抽象 fn（无 body/apply）：不可执行，保持 promise<unknown>
      if (!impl?.body && !impl?.apply && k === "fn" && !impl?.relation) {
        executed = false;
      } else {
        applyCallbackValue(executor, [resolveAbs, rejectAbs], emptyEnv(), pTrue, defaultLeakBudget);
      }
    } else {
      executed = false;
    }
  } catch (e) {
    // Bug 310：executor 抛出 → 原生 promise **被拒绝**（reason = 抛出值），
    // catch 臂必须可达。此前只翻 executed 标志 → 短路 promiseUnknown()
    // （无 rejected 通道）→ await 永不抛 → catch 臂成死代码、try 臂成
    // 确定错值。已 settle（first-wins）时抛错是原生 no-op（resolve 先赢），
    // 故只在「尚无 settle」时把 reason 压进 reject 通道。
    threwReason = e instanceof NudoThrow ? e.absValue : errorTypeAbs("Error");
  } finally {
    armUnsettled = leavePromiseExecutorScope(settledArms);
  }
  // 执行器抛错且此前无 settle → 走「确定拒绝」分支（rejected 通道 + never 内层）
  if (threwReason !== undefined && resolveValues.length === 0 && rejectValues.length === 0) {
    if (!armUnsettled) return promiseRejected(threwReason);
    return markFreshInstance(
      abs(
        { k: "eff", eff: "promise", inner: never, rejected: threwReason, unsettled: true },
        undefined,
        undefined,
        "path",
      ),
    );
  }
  if (!executed) return promiseUnknown();

  // Bug 36：确定拒绝（唯一活 settle 是 reject）→ resolved 域 never + reason 通道；
  // 两臂都可能（fork：一臂 resolve 一臂 reject）→ inner 与 rejected 并存
  //（then/catch 两臂 join 消费）。N5：无 settle 臂存在 → 拒绝也不确定
  //（原生可能悬挂）→ unsettled 并存。
  if (resolveValues.length === 0 && rejectValues.length > 0) {
    const reason =
      rejectValues.length === 1 ? rejectValues[0]! : rejectValues.reduce((a, b) => joinAbs(a, b));
    if (!armUnsettled) return promiseRejected(reason);
    return markFreshInstance(
      abs(
        { k: "eff", eff: "promise", inner: never, rejected: reason, unsettled: true },
        undefined,
        undefined,
        "path",
      ),
    );
  }
  if (resolveValues.length === 0) return promiseUnknown();
  // R3：唯一活 settle 是 eff(promise) resolve → 递归采纳（inner 与 rejected/
  // unsettled 通道随被采纳 promise，native resolve(p) 同款）
  if (effSettles.length === 1 && rejectValues.length === 0 && resolveValues.length === 1) {
    const sh = effSettles[0]!.shape as { inner: Abs; rejected?: Abs; unsettled?: boolean };
    return markFreshInstance(
      abs(
        {
          k: "eff",
          eff: "promise",
          inner: sh.inner,
          ...(sh.rejected !== undefined ? { rejected: sh.rejected } : {}),
          ...(sh.unsettled || armUnsettled ? { unsettled: true } : {}),
        },
        undefined,
        undefined,
        "path",
      ),
    );
  }
  // 多活 settle（fork/switch 臂、join 后跨路径延续）：同通道 join（各臂
  // resolve 值 ⊔ / 各臂 reject reason ⊔）；同路径顺序双 settle 已在收集处
  // 按路径 first-wins no-op。任一臂 thenable 采纳面不可排除；eff(promise)
  // 臂的 rejected/unsettled 通道并入（resolve(p) 原生递归采纳——p 拒绝则
  // 本 promise 拒绝）
  const inner =
    resolveValues.length === 1 ? resolveValues[0]! : resolveValues.reduce((a, b) => joinAbs(a, b));
  let rejected: Abs | undefined =
    rejectValues.length === 1
      ? rejectValues[0]!
      : rejectValues.length > 1
        ? rejectValues.reduce((a, b) => joinAbs(a, b))
        : undefined;
  let unsettled = resolveRisks.some(Boolean) || armUnsettled;
  for (const eff of effSettles) {
    const sh = eff.shape as { rejected?: Abs; unsettled?: boolean };
    if (sh.rejected !== undefined) {
      rejected = rejected === undefined ? sh.rejected : joinAbs(rejected, sh.rejected);
    }
    if (sh.unsettled) unsettled = true;
  }
  if (rejected !== undefined) {
    return markFreshInstance(
      abs(
        { k: "eff", eff: "promise", inner, rejected, ...(unsettled ? { unsettled: true } : {}) },
        undefined,
        undefined,
        "path",
      ),
    );
  }
  return unsettled ? promiseUnsettled(inner) : promiseAbs(inner, "path");
}

/** then/catch/finally：可映射回调 → 新 inner；做不到诚实 promise<unknown> */
export function evalPromiseMethod(
  name: string,
  recv: Abs,
  args: Abs[],
): Abs | undefined {
  if (recv.shape.k !== "eff" || recv.shape.eff !== "promise") return undefined;
  const inner = recv.shape.inner;
  // Bug 36/37 + review 补：handler ≡ Identity 的 IsCallable 判定（ES262
  // PerformPromiseThen：非可调用 handler 同 nullish 透传——native
  // `Promise.reject(42).then(1, 5)` 结果仍拒绝 42）。可判性与 $callDispatch
  // 同口径：非函数 prim（number/string/boolean/symbol/bigint）确定不可调用
  // → Identity；fn/any/obj/brand（可能经桥接可调）保守按可调用（结果域
  // unknown，sound）；sum 需全体成员非可调用才折 Identity。
  // Bug 313：闭 obj / arr / tuple（形状已知、**无可调用成员**）同样**确定**
  // 不可调用（原生只有函数有 [[Call]]）→ ≡ undefined（identity，透传原值）。
  // 此前它们落进「可能可调用」→ 微任务臂真去调 → TypeError → promise<never>
  // （自信错值）。口径与 evalPromiseCtor 的 executor 校验同源。
  const isIdentity = (h: Abs | undefined): boolean => {
    if (!h || isNullishLitAbs(h)) return true;
    const k = h.shape?.k;
    if (k === "prim") return true;
    if (k === "tuple" || k === "arr") return true;
    if (k === "obj") {
      // 闭 obj（open ≠ true）无 [[Call]]；带 fn impl 的 obj 走 impl 通道
      if (getFnImpl(h) !== undefined) return false;
      return (h.shape as { open?: boolean }).open !== true;
    }
    if (k === "sum") return h.shape.members.every(isIdentity);
    return false;
  };
  const confOf = (): Abs["conf"] => (recv.conf === "exact" ? "path" : recv.conf);
  // R3 settle 三分类：unsettled 标记 = state 未知；rejected 通道 = 可能拒绝；
  // 两者皆无 = 确定 fulfilled（onRejected/onFinally 原生死代码）
  const unsettled = (recv.shape as { unsettled?: boolean }).unsettled === true;
  const settledFulfilled = settledFulfilledOf(recv);
  // N1：微任务闭包读活通道——FIFO 保证上游微任务先跑完（链式注册时上游
  // join 尚未完成）；注册期捕获的 inner/rejected 是 pre-join 态（链式下游
  // 假确定值 / 缺 reason 臂的来源）。同步分支不受影响：relation/syncFacet
  // 要求 settledFulfilled，pre-join 出生带 unsettled 进不了同步分支。
  const liveRecvShape = () => recv.shape as { inner: Abs; rejected?: Abs };
  switch (name) {
    case "then": {
      const onFulfilled = args[0];
      const onRejected = args[1];
      const rejected = rejectedOf(recv);
      const definiteRejected = inner.shape.k === "never" && rejected !== undefined;
      const fulNullish = isIdentity(onFulfilled);
      const rejNullish = isIdentity(onRejected);

      // Bug 36：确定拒绝——onFulfilled（含 nullish）永不执行
      if (definiteRejected) {
        const reason = rejected!;
        if (rejNullish) {
          // 拒绝透传：nullish onRejected ≡ Identity
          return promiseRejected(reason, confOf());
        }
        const resultPromise = promiseAbs(unknown, "path");
        queuePromiseMicro(() => {
          const sh = resultPromise.shape as { inner: Abs; rejected?: Abs };
          try {
            const recovered = applyCallbackValue(onRejected, [reason], emptyEnv(), pTrue, defaultLeakBudget);
            sh.inner =
              !recovered || isUnknownSingleton(recovered) ? unknown : unwrapThenable(recovered);
          } catch (e) {
            if (e instanceof NudoThrow) {
              // 回调定抛 → 结果确定拒绝（原生 onRejected 抛错折 rejection）
              sh.inner = never;
              sh.rejected = e.absValue;
              return;
            }
            throw e;
          }
        });
        return resultPromise;
      }

      // Bug 37：nullish onFulfilled ≡ Identity 透传 settle 值
      if (fulNullish) {
        if (rejected === undefined) {
          // R3：state 未知 + 真回调 g → rejected 臂 g(unknown reason) 值 join
          //（结果保持 unsettled）；确定 fulfilled（g 死代码）或 g 缺席 → 透传
          if (!rejNullish && unsettled) {
            const resultPromise = promiseUnsettled(unwrapThenable(inner), "path");
            queuePromiseMicro(() => {
              const sh = resultPromise.shape as { inner: Abs; rejected?: Abs };
              try {
                const recovered = applyCallbackValue(onRejected, [unknown], emptyEnv(), pTrue, defaultLeakBudget);
                const next =
                  !recovered || isUnknownSingleton(recovered) ? unknown : unwrapThenable(recovered);
                sh.inner = joinAbs(unwrapThenable(liveRecvShape().inner), next);
              } catch (e) {
                if (e instanceof NudoThrow) {
                  sh.rejected = e.absValue;
                  return;
                }
                throw e;
              }
            });
            return resultPromise;
          }
          return unsettled
            ? promiseUnsettled(unwrapThenable(inner), confOf())
            : promiseAbs(unwrapThenable(inner), confOf());
        }
        // 拒绝通道在场但 settle 未定（fork 双臂）：两臂 join——fulfilled 臂
        // 透传 inner；rejected 臂 g(reason) 或（nullish g）拒绝透传
        if (rejNullish) {
          return markFreshInstance(
            abs(
              { k: "eff", eff: "promise", inner: unwrapThenable(inner), rejected },
              undefined,
              undefined,
              confOf(),
            ),
          );
        }
        // N1：出生 unsettled——fulfilled 透传 inner 在微任务 join 回收臂前
        // 不得呈现为确定 fulfilled（链式 .then 会同步映射 pre-join 态 →
        // 假确定 promise<inner>）；join 后清除（recovered 未知单例 = 采纳面
        // 不可判，保持 unsettled）
        const resultPromise = promiseUnsettled(unwrapThenable(inner), "path");
        queuePromiseMicro(() => {
          const sh = resultPromise.shape as { inner: Abs; rejected?: Abs; unsettled?: boolean };
          const live = liveRecvShape();
          try {
            const recovered = applyCallbackValue(onRejected, [live.rejected ?? rejected], emptyEnv(), pTrue, defaultLeakBudget);
            const next =
              !recovered || isUnknownSingleton(recovered) ? unknown : unwrapThenable(recovered);
            sh.inner = joinAbs(unwrapThenable(live.inner), next);
            if (!isUnknownSingleton(recovered) && recovered !== undefined) delete sh.unsettled;
          } catch (e) {
            if (e instanceof NudoThrow) {
              sh.rejected = e.absValue;
              delete sh.unsettled;
              return;
            }
            throw e;
          }
        });
        return resultPromise;
      }

      // 纯 relation 回调：同步收窄 inner（analyze 路径立刻可读；R3 门收紧为
      // 确定 fulfilled——state 未知走微任务，与 rejected 臂 join）
      const fnImpl = getFnImpl(onFulfilled);
      const rel = fnImpl?.relation;
      if (rel && !fnImpl?.body && !fnImpl?.apply && settledFulfilled) {
        const mapped = instantiateReturn(onFulfilled, [inner]);
        return promiseAbs(unwrapThenable(mapped), confOf());
      }

      // R3b：确定 fulfilled + effectFree∧closed 回调 → 同步映射 promise<h(v)>
      //（原生 onFulfilled 只在 fulfilled 臂执行一次；无写 + 不读外层可变态
      // ⇒ 同步执行与微任务执行无观测差——await p.then(h) 不再塌 unknown）。
      // 回调定抛 → 结果确定拒绝（then 回调抛错原生折 rejection，不同步穿透
      // 调用点）。无 facet（副作用/读外层态回调）保持微任务路径——同步窗口
      // 副作用序不可破（外层 return 前写回 = 假精确）。
      if (settledFulfilled && syncFacetOf(onFulfilled)) {
        try {
          const mapped = applyCallbackValue(onFulfilled, [inner], emptyEnv(), pTrue, defaultLeakBudget);
          return adoptHandlerReturn(mapped, confOf());
        } catch (e) {
          if (e instanceof NudoThrow) return promiseRejected(e.absValue, confOf());
          throw e;
        }
      }

      // 微任务路径（state 未知 / fork 双臂 / 无 facet——回调执行时刻对齐原生
      // 微任务序）。两臂折叠：fulfilled 臂 f(inner)（定抛 → 拒绝通道）；rejected
      // 臂——fork：g(reason) 或（nullish g）拒绝透传；state 未知：g(unknown
      // reason) 值臂 join（结果保持 unsettled）。定抛只置拒绝通道不定 never
      //（另一臂仍可能 fulfilled——除确定 fulfilled 接收者的 f 臂）。
      const resultPromise = unsettled ? promiseUnsettled(unknown, "path") : promiseAbs(unknown, "path");
      queuePromiseMicro(() => {
        const sh = resultPromise.shape as { inner: Abs; rejected?: Abs };
        const live = liveRecvShape();
        const liveRejected = live.rejected ?? rejected;
        const rejectArms: Abs[] = [];
        const runArm = (h: Abs | undefined, arg: Abs): Abs => {
          const r = applyCallbackValue(h, [arg], emptyEnv(), pTrue, defaultLeakBudget);
          return !r || isUnknownSingleton(r) ? unknown : unwrapThenable(r);
        };
        let fulfilled: Abs = unknown;
        let fThrew = false;
        try {
          fulfilled = runArm(onFulfilled, live.inner);
        } catch (e) {
          if (e instanceof NudoThrow) {
            rejectArms.push(e.absValue);
            fThrew = true;
          } else {
            throw e;
          }
        }
        if (liveRejected !== undefined) {
          if (rejNullish) {
            rejectArms.push(liveRejected); // 拒绝透传臂
          } else {
            try {
              fulfilled = joinAbs(fulfilled, runArm(onRejected, liveRejected));
            } catch (e) {
              if (e instanceof NudoThrow) rejectArms.push(e.absValue);
              else throw e;
            }
          }
        } else if (unsettled && !rejNullish) {
          // state 未知的 rejected 臂：g(unknown reason) 值臂 join
          try {
            fulfilled = joinAbs(fulfilled, runArm(onRejected, unknown));
          } catch (e) {
            if (e instanceof NudoThrow) rejectArms.push(e.absValue);
            else throw e;
          }
        }
        // f 臂定抛且接收者确定 fulfilled（唯一臂）→ 确定拒绝（inner never）
        sh.inner = fThrew && settledFulfilled ? never : fulfilled;
        if (rejectArms.length > 0) {
          sh.rejected = rejectArms.reduce((a, b) => joinAbs(a, b));
        }
      });
      return resultPromise;
    }
    case "catch": {
      const onRejected = args[0];
      const rejected = rejectedOf(recv);
      // Bug 36：确定拒绝——回调实参 = 拒绝 reason；结果只取回调值
      //（fulfilled 臂不可能，不得 join 原 inner 凭空多臂）
      if (inner.shape.k === "never" && rejected !== undefined) {
        if (isIdentity(onRejected)) {
          // nullish catch handler ≡ 拒绝透传（Identity）
          return promiseRejected(rejected, confOf());
        }
        const resultPromise = promiseAbs(unknown, "path");
        queuePromiseMicro(() => {
          const sh = resultPromise.shape as { inner: Abs; rejected?: Abs };
          try {
            const recovered = applyCallbackValue(onRejected, [rejected], emptyEnv(), pTrue, defaultLeakBudget);
            sh.inner =
              !recovered || isUnknownSingleton(recovered) ? unknown : unwrapThenable(recovered);
          } catch (e) {
            if (e instanceof NudoThrow) {
              // 回调定抛 → 结果确定拒绝（原生 catch 回调抛错折 rejection）
              sh.inner = never;
              sh.rejected = e.absValue;
              return;
            }
            throw e;
          }
        });
        return resultPromise;
      }
      // R3a：确定 fulfilled——catch 回调原生死代码（fulfilled 接收者的
      // onRejected 永不进队）：不执行、不 join 回调值，值原样透传。此前把
      // h(unknown reason) 并进值域（Promise.resolve(1).catch(() => 2) →
      // promise<1|2> 假臂，原生 promise<1>）。unsettled / 拒绝通道在场时
      // 回调臂保持（下方 join）。
      if (settledFulfilled) {
        return promiseAbs(inner, confOf());
      }
      // Bug 37：nullish catch handler ≡ Identity——resolved 透传 / 拒绝透传
      if (isIdentity(onRejected)) {
        if (rejected !== undefined) {
          // settle 未定（fork 双臂）：resolved 透传 inner ∪ 拒绝透传 reason
          return markFreshInstance(
            abs(
              { k: "eff", eff: "promise", inner: unwrapThenable(inner), rejected },
              undefined,
              undefined,
              confOf(),
            ),
          );
        }
        // state 未知（unsettled）：透传值，保持 unsettled（拒绝臂仍可能）
        return promiseUnsettled(inner, confOf());
      }
      // 拒绝通道在场但 settle 未定：两臂 join（resolved: inner；rejected:
      // g(R)；g 定抛 → 结果可能拒绝——只置拒绝通道，fulfilled 臂保留）
      if (rejected !== undefined) {
        // N1：出生 unsettled——fulfilled 透传 inner 在微任务 join 回收臂前
        // 不得呈现为确定 fulfilled（链式 .then 会同步映射 pre-join 态 →
        // 假确定 promise<inner>）；join 后清除（recovered 未知单例 = 采纳面
        // 不可判，保持 unsettled）
        const resultPromise = promiseUnsettled(unwrapThenable(inner), "path");
        queuePromiseMicro(() => {
          const sh = resultPromise.shape as { inner: Abs; rejected?: Abs; unsettled?: boolean };
          const live = liveRecvShape();
          try {
            const recovered = applyCallbackValue(onRejected, [live.rejected ?? rejected], emptyEnv(), pTrue, defaultLeakBudget);
            const next =
              !recovered || isUnknownSingleton(recovered) ? unknown : unwrapThenable(recovered);
            sh.inner = joinAbs(unwrapThenable(live.inner), next);
            if (!isUnknownSingleton(recovered) && recovered !== undefined) delete sh.unsettled;
          } catch (e) {
            if (e instanceof NudoThrow) {
              sh.rejected = e.absValue;
              delete sh.unsettled;
              return;
            }
            throw e;
          }
        });
        return resultPromise;
      }
      // state 未知（unsettled）：onRejected 对未知 reason 可能执行——值臂
      // join（结果保持 unsettled）；定抛 → may-reject 通道。回调进微任务，
      // 不污染同步返回路径。
      const resultPromise = promiseUnsettled(inner, "path");
      queuePromiseMicro(() => {
        const sh = resultPromise.shape as { inner: Abs; rejected?: Abs };
        try {
          const recovered = applyCallbackValue(onRejected, [unknown], emptyEnv(), pTrue, defaultLeakBudget);
          if (!recovered || isUnknownSingleton(recovered)) {
            sh.inner = unknown;
            return;
          }
          sh.inner = joinAbs(liveRecvShape().inner, unwrapThenable(recovered));
        } catch (e) {
          if (e instanceof NudoThrow) {
            sh.rejected = e.absValue;
            return;
          }
          throw e;
        }
      });
      return resultPromise;
    }
    case "finally": {
      // finally 不改变 settled value（回调返回值丢弃——返回 thenable 的采纳
      // 面不建模）；Bug 36：拒绝通道透传（Promise.reject(1).finally(g) 仍以 1
      // 拒绝）。R3 audit：effectFree∧closed 回调真执行一次（原生 finally 回调
      // 恒执行，无论 settle 态）：定抛 → 结果确定拒绝且 reason 替换（原生
      // Promise.reject(1).finally(() => { throw 9 }) 拒绝 9）。无 facet（副作用
      // 回调）不执行——抛错面不建模，通道透传。
      const rejected = rejectedOf(recv);
      const handler = args[0];
      if (!isIdentity(handler) && syncFacetOf(handler)) {
        try {
          applyCallbackValue(handler, [], emptyEnv(), pTrue, defaultLeakBudget);
        } catch (e) {
          if (e instanceof NudoThrow) return promiseRejected(e.absValue, confOf());
          throw e;
        }
      }
      if (rejected !== undefined) {
        return markFreshInstance(
          abs(
            {
              k: "eff",
              eff: "promise",
              inner,
              rejected,
              ...(unsettled ? { unsettled: true } : {}),
            },
            undefined,
            undefined,
            confOf(),
          ),
        );
      }
      return unsettled ? promiseUnsettled(inner, confOf()) : promiseAbs(inner, confOf());
    }
    default:
      return undefined;
  }
}

/**
 * Bug 47/54：iterable 实参分类（Promise.all/race/allSettled/any 与
 * AggregateError errors 槽共用）。三档（node v26 实测）：
 * - "bad"（定非可迭代）：缺省（≡ undefined not iterable）/ nullish 字面量 /
 *   非 string 的 prim 形态（number/boolean/bigint/symbol——lit 或抽象
 *   refined 均非可迭代）
 * - "ok"（合法）：string prim（可迭代）/ tuple / arr / Map·Set brand
 * - "may"：any/unknown/obj/fn/其余 brand/eff/sum（iterability 不可判）
 *
 * 落地口径按调用方分叉（node v26 实测）：AggregateError 的 IterableToList
 * **同步抛**（enforceIterableStaticArg 硬抛）；Promise 静态的迭代器获取
 * 全部**折为返回 promise 的 rejection**（不同步抛）——Promise 面只用分类
 * 定值域（bad → 恒 rejection → promise<unknown>），不记 throws。
 */
export function classifyIterableArg(a: Abs | undefined): "bad" | "ok" | "may" {
  if (!a) return "bad"; // 缺省 → undefined not iterable
  if (a.term?.op === "lit" && (a.term.value === null || a.term.value === undefined)) {
    return "bad"; // null/undefined 不可迭代
  }
  const k = a.shape.k;
  if (k === "prim") {
    return (a.shape as { type: string }).type === "string" ? "ok" : "bad";
  }
  if (k === "tuple" || k === "arr") return "ok";
  if (isMapAbs(a) || isSetAbs(a)) return "ok";
  return "may";
}

/** 分类落地：bad → NudoThrow(TypeError)；may → recordMayThrow */
export function enforceIterableStaticArg(a: Abs | undefined, what: string): void {
  const c = classifyIterableArg(a);
  if (c === "bad") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (c === "may") {
    recordMayThrow({ kind: "TypeError", cause: `${what} argument may not be iterable` });
  }
}

/**
 * Bug 293/312：组合子（all / race / any / allSettled）的元素域。
 * - tuple → 逐元素；arr → 元素域（单元素）；string prim → 字符域
 * - 不可判（any/unknown/obj/brand…）→ undefined（调用方回落保守值域）
 */
function comboElements(a: Abs | undefined): Abs[] | undefined {
  if (!a) return undefined;
  const k = a.shape.k;
  if (k === "tuple") return (a.shape as { elements: Abs[] }).elements;
  if (k === "arr") return [(a.shape as { element: Abs }).element];
  if (k === "prim" && (a.shape as { type: string }).type === "string") {
    return [abs({ k: "prim", type: "string" }, undefined, undefined, "path")];
  }
  return undefined;
}

/** Bug 293：组合子元素的 settle 通道（fulfilled 值 / 拒绝 reason / 状态未知） */
interface ElementSettle {
  /** fulfilled 臂的值（元素 promise → inner；确定拒绝 → never） */
  value: Abs;
  /** 拒绝 reason（无通道 → undefined） */
  reason?: Abs;
  /** 状态未知（元素可能永不 settle / thenable 采纳面不可判） */
  unknownState: boolean;
}

/**
 * Bug 293：组合子元素按 PromiseResolve 口径 unwrap——元素是 eff(promise) 时
 * 取其 inner（**不是 promise 本身**；原生 race/any 的结算值是元素 promise
 * 的值），并保留其 rejected 通道（组合子的拒绝域来源）。非 promise 元素按
 * 原生 PromiseResolve 包装（值 = 元素本身；thenable 采纳面不可判 → 状态未知）。
 */
function elementSettle(el: Abs): ElementSettle {
  if (isPromiseEff(el)) {
    const sh = el.shape as { inner: Abs; rejected?: Abs; unsettled?: boolean };
    return { value: sh.inner, reason: sh.rejected, unknownState: sh.unsettled === true };
  }
  return { value: el, reason: undefined, unknownState: thenableRiskOf(el) };
}

/** 元素域 join（空集 → unknown；never 由 joinAbs 吸收） */
function joinOf(values: Abs[]): Abs {
  if (values.length === 0) return unknown;
  return values.reduce((a, b) => joinAbs(a, b));
}

/**
 * Bug 312：allSettled 元素投影（判别联合）。
 * - promise 元素且状态**确定** → 单臂：fulfilled {status:"fulfilled", value:
 *   <解包值>} / rejected {status:"rejected", reason:<真 reason>}
 *   （原生 allSettled 的 status 恒定；两臂 join 成无区分 sum 会让读 reason
 *   命中 fulfilled 臂的缺槽 → undefined → .message 定抛假错）
 * - 非 promise 元素 / 状态未知 → 两臂并集（非 promise 元素是既有钉测试
 *   eval-namespace-statics-wave11 钉住的「status 两态并集 + value/reason
 *   双槽」口径；状态未知时两臂都可能）
 */
function settledEntry(el: Abs): Abs {
  const s = elementSettle(el);
  if (isPromiseEff(el)) {
    const fulfilledArm = abs(
      {
        k: "obj",
        slots: {
          status: { value: strLit("fulfilled") },
          value: { value: s.value },
        },
      },
      undefined,
      undefined,
      "path",
    );
    const rejectedArm = abs(
      {
        k: "obj",
        slots: {
          status: { value: strLit("rejected") },
          reason: { value: s.reason ?? unknown },
        },
      },
      undefined,
      undefined,
      "path",
    );
    if (s.value.shape.k === "never" && s.reason !== undefined) return rejectedArm;
    if (s.reason === undefined && !s.unknownState) return fulfilledArm;
    return joinAbs(fulfilledArm, rejectedArm);
  }
  const fulfilled = abs(
    {
      k: "obj",
      slots: {
        status: { value: joinAbs(strLit("fulfilled"), strLit("rejected")) },
        value: { value: s.value },
      },
    },
    undefined,
    undefined,
    "path",
  );
  const rejected = abs(
    {
      k: "obj",
      slots: {
        status: { value: strLit("rejected") },
        reason: { value: unknown },
      },
    },
    undefined,
    undefined,
    "path",
  );
  return joinAbs(fulfilled, rejected);
}

/**
 * Bug 293：Promise.any 全拒 → AggregateError reason（原生：errors 数组 =
 * 各元素 reason，message = "All promises were rejected"）。
 * 本地构造（不引 error-family.ts——它已引本文件，闭环会成环），槽位口径与
 * errorBrandAbs 同款（name 走原型链槽、stack/message/errors 不可枚举）。
 */
function aggregateErrorAbs(reasons: Abs[]): Abs {
  const inner = objOf({
    stack: { value: str("path") },
    name: { value: strLit("AggregateError"), inherited: true },
    message: { value: strLit("All promises were rejected") },
    errors: { value: abs({ k: "tuple", elements: reasons }, undefined, undefined, "path") },
  });
  for (const k of ["stack", "name", "message", "errors"]) {
    setPropFlags(inner, k, { enumerable: false });
  }
  return abs({ k: "brand", name: "AggregateError", shape: inner }, undefined, undefined, "path");
}

/**
 * Bug 311：Promise 静态方法的 this 绑定（ES262 PromiseResolve /
 * NewPromiseCapability：this 必须 IsConstructor，否则 TypeError）。
 * thisVal 缺席 = 直接命名空间调用（this ≡ Promise 构造器 → 合法）。
 */
function checkPromiseStaticThis(thisVal: Abs | undefined): void {
  if (thisVal === undefined) return;
  // nullish this（Promise.resolve.call(null, 1)）→ 原生 TypeError（非对象）
  if (isNullishLitAbs(thisVal)) throw new NudoThrow(errorTypeAbs("TypeError"));
  const k = thisVal.shape.k;
  // 不可判（any/unknown/sum）→ 记 may-throw（不硬抛——避免假抛）
  if (k === "any" || k === "unknown" || k === "sum") {
    recordMayThrow({ kind: "TypeError", cause: "Promise static method this may not be a constructor" });
    return;
  }
  // 构造器判定：fn / brand 且 ctor:true（宿主 Promise 的 Abs 面即 fn+ctor）
  const isCtor =
    (k === "fn" || k === "brand") && (thisVal.shape as { ctor?: boolean }).ctor === true;
  if (!isCtor) throw new NudoThrow(errorTypeAbs("TypeError"));
}

/** Bug 311：受 this 绑定约束的 Promise 静态方法（ES262：均以 this 为接收者） */
const PROMISE_THIS_BOUND_STATICS = new Set([
  "resolve",
  "reject",
  "all",
  "race",
  "allSettled",
  "any",
  "withResolvers",
]);

/**
 * Bug 311：Promise 静态派发。thisVal = 静态方法值的 this 绑定（成员读出
 * 的静态方法被单独调用时的接收者）；缺席 = 直接命名空间调用（this ≡
 * Promise 构造器，合法）。非构造器接收者按原生抛 TypeError。
 */
export function evalPromiseStatic(
  name: string,
  args: Abs[],
  thisVal?: Abs,
): Abs | undefined {
  if (PROMISE_THIS_BOUND_STATICS.has(name)) checkPromiseStaticThis(thisVal);
  switch (name) {
    case "withResolvers": {
      // Bug 24：ES2024 Promise.withResolvers() —— 恒返回三槽对象。promise
      // 槽域 promise<unknown>（resolve 实参未知），resolve/reject 一等函数
      //（无 body 最小面：调用返回 unknown；this 不敏感）。
      return abs(
        {
          k: "obj",
          slots: {
            promise: { value: promiseUnsettled(unknown) },
            resolve: { value: absFunction([], { body: noBody }, { ctor: false }) },
            reject: { value: absFunction([], { body: noBody }, { ctor: false }) },
          },
        },
        undefined,
        undefined,
        "path",
      );
    }
    case "resolve": {
      // R3：缺省 ≡ resolve(undefined)（确定 fulfilled·值 undefined，非 unknown）
      const inner = args.length > 0 ? (args[0] ?? unknown) : undefAbs();
      // Promise.resolve(thenable) 采纳（通道/标记随原 promise）
      if (inner.shape.k === "eff" && inner.shape.eff === "promise") return inner;
      // 值可能自带 thenable 采纳面（any/unknown/fn/open obj/带 then 槽 obj）
      // → settle 不可判，标 unsettled（catch/then 拒绝臂保持活）
      if (thenableRiskOf(inner)) return promiseUnsettled(inner);
      return promiseAbs(inner, "path");
    }
    case "reject":
      // Bug 36：拒绝通道携带 reason（resolved 域 never——fulfilled 臂不可能）
      return promiseRejected(args[0] ?? undefAbs(), "path");
    case "all": {
      // Bug 47（node v26 实测校正）：非可迭代实参**不同步抛**——TypeError
      // 折为返回 promise 的 rejection（all(1)/all(null)/all()/all(Symbol())
      // 实测均同步返回 promise、异步 reject；bug 文本「? GetIterator 同步
      // 定抛」按 node v26 否决，与 race/allSettled/any 同口径）。定非可迭代
      // → 恒 rejection 永不 resolve → 保守 promise<unknown>；ok/may 走既有
      // 投影（fast path / promise<unknown[]>）。
      if (classifyIterableArg(args[0]) === "bad") return promiseUnknown();
      const a0 = args[0];
      // Bug 293：逐元素取 settle 通道（元素 promise 解包 inner + 保留
      // rejected）——all 的**拒绝域**来自任一元素的 rejected 通道（原生：任一
      // 元素拒绝即 all 拒绝，reason = 该元素 reason）。
      const els = comboElements(a0);
      if (!els) {
        return promiseUnsettled(
          abs({ k: "arr", element: unknown }, undefined, undefined, "partial"),
          "partial",
        );
      }
      const settles = els.map(elementSettle);
      const values = settles.map((s) => s.value);
      const reasons = settles.map((s) => s.reason).filter((r): r is Abs => r !== undefined);
      const reason =
        reasons.length === 0
          ? undefined
          : reasons.length === 1
            ? reasons[0]!
            : reasons.reduce((a, b) => joinAbs(a, b));
      // 确定拒绝：某元素 inner=never 且带 reason → all 必拒绝（fulfilled 域
      // 不可能）→ 内层 never + reason 通道（$await 抛 → catch 臂可达）
      const definiteReject = settles.some(
        (s) => s.value.shape.k === "never" && s.reason !== undefined,
      );
      if (definiteReject) return promiseRejected(reason!, "path");
      const base =
        a0?.shape.k === "tuple"
          ? abs({ k: "tuple", elements: values }, undefined, undefined, "path")
          : abs(
              { k: "arr", element: values.length === 1 ? values[0]! : joinOf(values) },
              undefined,
              undefined,
              "path",
            );
      // 拒绝域存在（某元素可能拒绝）→ 结果可能拒绝 → rejected 通道 + unsettled
      if (reason !== undefined) {
        return markFreshInstance(
          abs(
            { k: "eff", eff: "promise", inner: base, rejected: reason, unsettled: true },
            undefined,
            undefined,
            "path",
          ),
        );
      }
      return settles.some((s) => s.unknownState) ? promiseUnsettled(base) : promiseAbs(base, "path");
    }
    case "race":
    case "any": {
      // Bug 64：node v26 实测迭代器获取**不同步抛**——TypeError 折为返回
      // promise 的 rejection（race(1) 同步侧返回正常 promise）。故此处不
      // 做 throws 记录（与 all 分叉：all 的 GetIterator 在PerformPromiseAll
      // 同步段），值域按元素联合投影。
      // Bug 293：元素按 PromiseResolve 口径 unwrap（元素 promise → inner，
      // **不是 promise 本身**——原生 race/any 的结算值是元素 promise 的值），
      // 拒绝侧进 rejected 域。
      const els = comboElements(args[0]);
      if (!els || els.length === 0) {
        // 元素不可判（含非可迭代接收者——原生折为 rejection，非同步抛）；
        // 空集合 → 原生永远 pending
        return promiseUnknown();
      }
      const settles = els.map(elementSettle);
      const value = joinOf(settles.map((s) => s.value));
      const reasons = settles.map((s) => s.reason).filter((r): r is Abs => r !== undefined);
      const unknownState = settles.some((s) => s.unknownState);
      if (name === "any") {
        // any：首个 fulfilled 赢 → fulfilled 域 = 各元素 fulfilled 值 join；
        // 全拒 → AggregateError（原生 errors = 各 reason）
        const allReject = settles.every(
          (s) => s.value.shape.k === "never" && s.reason !== undefined,
        );
        if (allReject) return promiseRejected(aggregateErrorAbs(reasons), "path");
        if (reasons.length === 0) {
          return unknownState ? promiseUnsettled(value) : promiseAbs(value, "path");
        }
        // 部分元素可能拒绝 → 结果可能以 AggregateError 拒绝（errors 含已知
        // reason + 未判元素的 unknown）
        const errs = reasons.concat(
          settles.filter((s) => s.reason === undefined).map(() => unknown),
        );
        return markFreshInstance(
          abs(
            {
              k: "eff",
              eff: "promise",
              inner: value,
              rejected: aggregateErrorAbs(errs),
              unsettled: true,
            },
            undefined,
            undefined,
            "path",
          ),
        );
      }
      // race：首个 settle 赢 → fulfilled ∪ rejected 两域并存（原生：谁先
      // settle 谁赢；引擎不建模时序 → 两域并集）
      const reason =
        reasons.length === 0
          ? undefined
          : reasons.length === 1
            ? reasons[0]!
            : reasons.reduce((a, b) => joinAbs(a, b));
      if (reason !== undefined) {
        return markFreshInstance(
          abs(
            {
              k: "eff",
              eff: "promise",
              inner: value,
              rejected: reason,
              ...(unknownState ? { unsettled: true } : {}),
            },
            undefined,
            undefined,
            "path",
          ),
        );
      }
      return unknownState ? promiseUnsettled(value) : promiseAbs(value, "path");
    }
    case "allSettled": {
      // Bug 64：同 race/any——同步不抛；值域 arr<{status; value}|{status; reason}>。
      // 定非可迭代接收者（原生折为 rejection）→ 保守 promise<unknown>。
      if (classifyIterableArg(args[0]) === "bad") return promiseUnknown();
      const a0 = args[0];
      // Bug 312：元素投影成**判别联合**（promise 元素状态确定 → 单臂；否则
      // 两臂并集）——不再把元素 promise 原样塞进 value 槽。
      const els = comboElements(a0);
      if (!els) return promiseUnknown();
      const entries = els.map(settledEntry);
      const base =
        a0?.shape.k === "tuple"
          ? abs({ k: "tuple", elements: entries }, undefined, undefined, "path")
          : abs(
              { k: "arr", element: entries.length === 1 ? entries[0]! : joinOf(entries) },
              undefined,
              undefined,
              "path",
            );
      return promiseAbs(base, "path");
    }
    default:
      return undefined;
  }
}

