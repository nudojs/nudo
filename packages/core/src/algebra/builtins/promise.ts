/**
 * Promise 构造 / then 链 / 静态方法 + micro 队列
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, bigintLit, unknown, never } from "../abs.ts";
import { joinAbs } from "../objects.ts";
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

export function enterPromiseExecutorScope(): void {
  promiseExecStack.push(0);
}

export function leavePromiseExecutorScope(): number {
  const forks = promiseExecStack.pop() ?? 0;
  if (promiseExecStack.length === 0) {
    settleArmCounter = 0;
    currentSettleArm = 0;
    settleArmParents.clear();
  }
  return forks;
}

/** $fork 在 executor 内发生时打点（多臂 resolve 需 join，不得 first-wins 假精确） */
export function notePromiseExecutorFork(): void {
  if (promiseExecStack.length > 0) {
    promiseExecStack[promiseExecStack.length - 1]!++;
  }
}

/** N1：fork 臂执行区间（runForkArm）压入新路径 token；executor 外零开销 */
export function enterPromiseForkArm(): void {
  if (promiseExecStack.length === 0) return;
  settleArmCounter += 1;
  settleArmParents.set(settleArmCounter, currentSettleArm);
  currentSettleArm = settleArmCounter;
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
    settledArms.push(currentPromiseSettleArm());
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
    settledArms.push(currentPromiseSettleArm());
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
  // executed = executor 真跑过（早退/抽象 fn/抛出 → promise<unknown>）。
  // finally 保证 scope 恒弹出：早退 return / 抛出走 catch 都不得泄漏栈帧
  //（泄漏会让后续所有 $fork 误记入已死的 executor 计数与路径 token 表）。
  let executed = true;
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
  } catch {
    // executor 抛出 → rejected promise；resolved 通道不假装 settle
    executed = false;
  } finally {
    leavePromiseExecutorScope();
  }
  if (!executed) return promiseUnknown();

  // Bug 36：确定拒绝（唯一活 settle 是 reject）→ resolved 域 never + reason 通道；
  // 两臂都可能（fork：一臂 resolve 一臂 reject）→ inner 与 rejected 并存
  //（then/catch 两臂 join 消费）
  if (resolveValues.length === 0 && rejectValues.length > 0) {
    return promiseRejected(
      rejectValues.length === 1 ? rejectValues[0]! : rejectValues.reduce((a, b) => joinAbs(a, b)),
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
          ...(sh.unsettled ? { unsettled: true } : {}),
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
  let unsettled = resolveRisks.some(Boolean);
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
  const isIdentity = (h: Abs | undefined): boolean => {
    if (!h || isNullishLitAbs(h)) return true;
    const k = h.shape?.k;
    if (k === "prim") return true;
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

/** race/any 的元素联合（tuple → join；arr → element；string → char）；不可判 → undefined */
function iterableElementOf(a: Abs | undefined): Abs | undefined {
  if (!a) return undefined;
  const k = a.shape.k;
  if (k === "tuple") {
    const els = (a.shape as { elements: Abs[] }).elements;
    if (els.length === 0) return undefined; // race([]) 原生永远 pending
    return els.reduce((x, y) => joinAbs(x, y));
  }
  if (k === "arr") return (a.shape as { element: Abs }).element;
  if (k === "prim" && (a.shape as { type: string }).type === "string") {
    return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
  }
  return undefined;
}

export function evalPromiseStatic(name: string, args: Abs[]): Abs | undefined {
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
      if (a0?.shape.k === "arr" && a0.shape.element.shape.k === "eff") {
        // 元素 promise 的拒绝会拒绝 all → settle 不可判（采纳通道在 join 中
        // 丢失）→ unsettled
        const el = a0.shape.element.shape as {
          inner: Abs;
          rejected?: Abs;
          unsettled?: boolean;
        };
        const base = abs({ k: "arr", element: el.inner }, undefined, undefined, "path");
        return el.rejected !== undefined || el.unsettled === true
          ? promiseUnsettled(base)
          : promiseAbs(base, "path");
      }
      // 字面量 tuple：逐元素展开 thenable（[Promise.resolve(1), 2] → [1, 2]，
      // 与 race/any 的元素投影同口径）；任一元素 promise 携带拒绝通道/风险
      // → all 结果 unsettled
      if (a0?.shape.k === "tuple") {
        let risky = false;
        const els = a0.shape.elements.map((el) => {
          if (el.shape.k === "eff" && el.shape.eff === "promise") {
            const p = el.shape as { inner: Abs; rejected?: Abs; unsettled?: boolean };
            if (p.rejected !== undefined || p.unsettled === true) risky = true;
            return p.inner;
          }
          if (thenableRiskOf(el)) risky = true;
          return el;
        });
        const base = abs({ k: "tuple", elements: els }, undefined, undefined, "path");
        return risky ? promiseUnsettled(base) : promiseAbs(base, "path");
      }
      return promiseUnsettled(
        abs({ k: "arr", element: unknown }, undefined, undefined, "partial"),
        "partial",
      );
    }
    case "race":
    case "any": {
      // Bug 64：node v26 实测迭代器获取**不同步抛**——TypeError 折为返回
      // promise 的 rejection（race(1) 同步侧返回正常 promise）。故此处不
      // 做 throws 记录（与 all 分叉：all 的 GetIterator 在PerformPromiseAll
      // 同步段），值域按元素联合投影。
      const el = iterableElementOf(args[0]);
      if (!el) {
        // 元素不可判（含非可迭代接收者——原生折为 rejection，非同步抛）
        return promiseUnknown();
      }
      // race/any：任一元素 promise 的拒绝可能赢 → 采纳通道在元素联合中
      // 丢失 → unsettled（纯原始值元素 settled）
      const a0 = args[0];
      const risky =
        a0?.shape.k === "tuple"
          ? a0.shape.elements.some((e) => isPromiseEff(e) || thenableRiskOf(e))
          : a0?.shape.k === "arr"
            ? isPromiseEff(a0.shape.element) || thenableRiskOf(a0.shape.element)
            : thenableRiskOf(el);
      return risky ? promiseUnsettled(el) : promiseAbs(el, "path");
    }
    case "allSettled": {
      // Bug 64：同 race/any——同步不抛；值域 arr<{status; value}|{status; reason}>。
      // 定非可迭代接收者（原生折为 rejection）→ 保守 promise<unknown>。
      if (classifyIterableArg(args[0]) === "bad") return promiseUnknown();
      const el = iterableElementOf(args[0]) ?? unknown;
      const entry = (value: Abs): Abs =>
        abs(
          {
            k: "obj",
            slots: {
              status: { value: joinAbs(strLit("fulfilled"), strLit("rejected")) },
              value: { value },
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
      const element = joinAbs(entry(el), rejected);
      return promiseAbs(
        abs({ k: "arr", element }, undefined, undefined, "path"),
        "path",
      );
    }
    default:
      return undefined;
  }
}

