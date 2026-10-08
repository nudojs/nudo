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
import {
  noteAbsTruncation,
  PROMISE_MICRO_OVERFLOW_LABEL,
  PROMISE_MICRO_ERROR_LABEL,
} from "../call-budget.ts";
import { numPrim, str, boolPrim, noBody } from "./shared.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";

const promiseExecStack: number[] = [];

export function enterPromiseExecutorScope(): void {
  promiseExecStack.push(0);
}

export function leavePromiseExecutorScope(): number {
  return promiseExecStack.pop() ?? 0;
}

/** $fork 在 executor 内发生时打点（多臂 resolve 需 join，不得 first-wins 假精确） */
export function notePromiseExecutorFork(): void {
  if (promiseExecStack.length > 0) {
    promiseExecStack[promiseExecStack.length - 1]!++;
  }
}

function promiseAbs(inner: Abs, conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "eff", eff: "promise", inner }, undefined, undefined, conf);
}

/**
 * Bug 36：确定拒绝的 promise——resolved 域 never（fulfilled 臂不可能），
 * rejected 通道携带 reason（catch/两参 then 的 onRejected 实参来源）。
 * 拒绝透传（nullish handler ≡ Identity）经同款构造保持通道。
 */
function promiseRejected(reason: Abs, conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "eff", eff: "promise", inner: never, rejected: reason }, undefined, undefined, conf);
}

/** promise 的已知拒绝 reason（无通道 → undefined） */
function rejectedOf(recv: Abs): Abs | undefined {
  if (recv.shape.k !== "eff" || recv.shape.eff !== "promise") return undefined;
  return (recv.shape as { rejected?: Abs }).rejected;
}

function promiseUnknown(): Abs {
  return promiseAbs(unknown, "partial");
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

  let hasSettle = false;
  let hasResolve = false;
  let hasReject = false;
  const resolveValues: Abs[] = [];
  const rejectValues: Abs[] = [];

  const onResolve = (value?: unknown): Abs => {
    const raw = asAbs(value) ?? litFromJs(value);
    const v = unwrapThenable(raw);
    if (!hasSettle) {
      hasSettle = true;
      hasResolve = true;
      resolveValues.push(v);
    } else if (hasResolve) {
      // 后续 resolve：顺序 no-op（first-wins）或另一 fork 臂（稍后 join）
      resolveValues.push(v);
    }
    return undefAbs();
  };
  // Bug 36：reject 通道与 resolve 对称收集（fork 臂 join；first-wins 同款）
  const onReject = (reason?: unknown): Abs => {
    const raw = asAbs(reason) ?? litFromJs(reason);
    if (!hasSettle) {
      hasSettle = true;
      hasReject = true;
      rejectValues.push(raw);
    } else if (hasReject) {
      rejectValues.push(raw);
    }
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
        return promiseUnknown();
      }
      applyCallbackValue(executor, [resolveAbs, rejectAbs], emptyEnv(), pTrue, defaultLeakBudget);
    } else {
      return promiseUnknown();
    }
  } catch {
    // executor 抛出 → rejected promise；resolved 通道不假装 settle
    return promiseUnknown();
  }
  const forks = leavePromiseExecutorScope();

  // Bug 36：确定拒绝（仅 reject 臂 settle）→ resolved 域 never + reason 通道；
  // 两臂都可能（fork：一臂 resolve 一臂 reject）→ inner 与 rejected 并存
  //（then/catch 两臂 join 消费）
  if (!hasResolve && rejectValues.length > 0) {
    return promiseRejected(
      rejectValues.length === 1 ? rejectValues[0]! : rejectValues.reduce((a, b) => joinAbs(a, b)),
    );
  }
  if (!hasResolve || resolveValues.length === 0) return promiseUnknown();
  // 无 fork：顺序双 resolve 取第一次（原生 no-op）；有 fork：各臂 join
  const inner =
    forks === 0 || resolveValues.length === 1
      ? resolveValues[0]!
      : resolveValues.reduce((a, b) => joinAbs(a, b));
  if (rejectValues.length > 0) {
    const rej = rejectValues.length === 1 ? rejectValues[0]! : rejectValues.reduce((a, b) => joinAbs(a, b));
    return abs(
      { k: "eff", eff: "promise", inner, rejected: rej },
      undefined,
      undefined,
      "path",
    );
  }
  return promiseAbs(inner, "path");
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
          const recovered = applyCallbackValue(onRejected, [reason], emptyEnv(), pTrue, defaultLeakBudget);
          const next =
            !recovered || (recovered.shape.k === "unknown" && recovered.term === undefined)
              ? unknown
              : unwrapThenable(recovered);
          (resultPromise.shape as { inner: Abs }).inner = next;
        });
        return resultPromise;
      }

      // Bug 37：nullish onFulfilled ≡ Identity 透传 settle 值
      if (fulNullish) {
        if (rejected === undefined) {
          // 无拒绝通道信息：then(null) / then(null, null) → 透传 inner
          //（settle 未知面只在 inner 为 unknown 时两臂 join——onRejected
          // 可能对未知 reason 跑，join 后仍被 unknown 吸收）
          if (!rejNullish && inner.shape.k === "unknown" && inner.term === undefined) {
            const resultPromise = promiseAbs(unknown, "path");
            queuePromiseMicro(() => {
              const recovered = applyCallbackValue(onRejected, [unknown], emptyEnv(), pTrue, defaultLeakBudget);
              const next =
                !recovered || (recovered.shape.k === "unknown" && recovered.term === undefined)
                  ? unknown
                  : unwrapThenable(recovered);
              (resultPromise.shape as { inner: Abs }).inner = joinAbs(unwrapThenable(inner), next);
            });
            return resultPromise;
          }
          return promiseAbs(unwrapThenable(inner), confOf());
        }
        // 拒绝通道在场但 settle 未定（fork 双臂）：两臂 join——fulfilled 臂
        // 透传 inner；rejected 臂 g(reason) 或（nullish g）拒绝透传
        if (rejNullish) {
          return abs(
            { k: "eff", eff: "promise", inner: unwrapThenable(inner), rejected },
            undefined,
            undefined,
            confOf(),
          );
        }
        const resultPromise = promiseAbs(unwrapThenable(inner), "path");
        queuePromiseMicro(() => {
          const recovered = applyCallbackValue(onRejected, [rejected], emptyEnv(), pTrue, defaultLeakBudget);
          const next =
            !recovered || (recovered.shape.k === "unknown" && recovered.term === undefined)
              ? unknown
              : unwrapThenable(recovered);
          (resultPromise.shape as { inner: Abs }).inner = joinAbs(unwrapThenable(inner), next);
        });
        return resultPromise;
      }

      // 纯 relation 回调：同步收窄 inner（analyze 路径立刻可读）
      const rel = getFnImpl(onFulfilled)?.relation;
      if (rel && !getFnImpl(onFulfilled)?.body && !getFnImpl(onFulfilled)?.apply) {
        const mapped = instantiateReturn(onFulfilled, [inner]);
        return promiseAbs(unwrapThenable(mapped), confOf());
      }
      // 先建 promise 占位，回调在微任务里填 inner（原生 then 不同步跑回调）
      const resultPromise = promiseAbs(unknown, "path");
      queuePromiseMicro(() => {
        const mapped = applyCallbackValue(
          onFulfilled,
          [inner],
          emptyEnv(),
          pTrue,
          defaultLeakBudget,
        );
        // 调用失败：无 term 的 unknown 单例。回调返回 undefined（undefAbs）合法。
        const next =
          !mapped || (mapped.shape.k === "unknown" && mapped.term === undefined)
            ? unknown
            : unwrapThenable(mapped);
        (resultPromise.shape as { inner: Abs }).inner = next;
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
          const recovered = applyCallbackValue(onRejected, [rejected], emptyEnv(), pTrue, defaultLeakBudget);
          if (!recovered || (recovered.shape.k === "unknown" && recovered.term === undefined)) {
            (resultPromise.shape as { inner: Abs }).inner = unknown;
            return;
          }
          (resultPromise.shape as { inner: Abs }).inner = unwrapThenable(recovered);
        });
        return resultPromise;
      }
      // Bug 37：nullish catch handler ≡ Identity——resolved 透传 / 拒绝透传
      if (isIdentity(onRejected)) {
        if (rejected !== undefined) {
          // settle 未定（fork 双臂）：resolved 透传 inner ∪ 拒绝透传 reason
          return abs(
            { k: "eff", eff: "promise", inner: unwrapThenable(inner), rejected },
            undefined,
            undefined,
            confOf(),
          );
        }
        return promiseAbs(inner, confOf());
      }
      // 拒绝通道在场但 settle 未定：两臂 join（resolved: inner；rejected: g(R)）
      if (rejected !== undefined) {
        const resultPromise = promiseAbs(unwrapThenable(inner), "path");
        queuePromiseMicro(() => {
          const recovered = applyCallbackValue(onRejected, [rejected], emptyEnv(), pTrue, defaultLeakBudget);
          const next =
            !recovered || (recovered.shape.k === "unknown" && recovered.term === undefined)
              ? unknown
              : unwrapThenable(recovered);
          (resultPromise.shape as { inner: Abs }).inner = joinAbs(unwrapThenable(inner), next);
        });
        return resultPromise;
      }
      // 只建模 resolved 通道：onRejected 映射 reject reason（unknown）→ 可能 resolve
      // 回调同样进微任务，不污染同步返回路径
      const resultPromise = promiseAbs(inner, "path");
      queuePromiseMicro(() => {
        const recovered = applyCallbackValue(
          onRejected,
          [unknown],
          emptyEnv(),
          pTrue,
          defaultLeakBudget,
        );
        if (!recovered || (recovered.shape.k === "unknown" && recovered.term === undefined)) {
          (resultPromise.shape as { inner: Abs }).inner = unknown;
          return;
        }
        (resultPromise.shape as { inner: Abs }).inner = joinAbs(
          inner,
          unwrapThenable(recovered),
        );
      });
      return resultPromise;
    }
    case "finally": {
      // finally 不改变 settled value（回调返回值丢弃）；Bug 36：拒绝通道
      // 透传（Promise.reject(1).finally(g) 仍以 1 拒绝）
      if (rejectedOf(recv) !== undefined) {
        return abs(
          { k: "eff", eff: "promise", inner, rejected: rejectedOf(recv) },
          undefined,
          undefined,
          confOf(),
        );
      }
      return promiseAbs(inner, confOf());
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
            promise: { value: promiseAbs(unknown, "path") },
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
      const inner = args[0] ?? unknown;
      // Promise.resolve(thenable) 展开
      if (inner.shape.k === "eff" && inner.shape.eff === "promise") return inner;
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
        return promiseAbs(
          abs({ k: "arr", element: a0.shape.element.shape.inner }, undefined, undefined, "path"),
          "path",
        );
      }
      // 字面量 tuple：逐元素展开 thenable（[Promise.resolve(1), 2] → [1, 2]，
      // 与 race/any 的元素投影同口径）
      if (a0?.shape.k === "tuple") {
        const els = a0.shape.elements.map(unwrapThenable);
        return promiseAbs(abs({ k: "tuple", elements: els }, undefined, undefined, "path"), "path");
      }
      return promiseAbs(
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
      return promiseAbs(el, "path");
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

