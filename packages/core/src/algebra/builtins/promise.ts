/**
 * Promise 构造 / then 链 / 静态方法 + micro 队列
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, bigintLit, unknown } from "../abs.ts";
import { joinAbs } from "../objects.ts";
import { applyCallbackValue, undefAbs, asAbs, instantiateReturn } from "../hof.ts";
import { absFunction, getFnImpl } from "../abs-fn.ts";
import { pTrue } from "../pred.ts";
import { defaultLeakBudget } from "../leak.ts";
import { emptyEnv } from "../ast-env.ts";
import { numPrim, str, boolPrim, noBody } from "./shared.ts";

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
    return abs({ k: "unknown" }, { op: "lit", value: null as never }, pTrue, "exact");
  }
  if (typeof value === "number") return numLit(value);
  if (typeof value === "string") return strLit(value);
  if (typeof value === "boolean") return boolLit(value);
  if (typeof value === "bigint") return bigintLit(value);
  return unknown;
}

// then/catch 回调是微任务：不得在同步 then() 里跑（否则外层 return 前被写回）。
// 在 callTranspiledExportFull 出口排空，对齐原生执行序。
const promiseMicros: Array<() => void> = [];

export function queuePromiseMicro(task: () => void): void {
  promiseMicros.push(task);
}

export function drainPromiseMicros(): void {
  while (promiseMicros.length > 0) {
    const task = promiseMicros.shift()!;
    try {
      task();
    } catch {
      /* 微任务抛错不改写已计算的同步返回值 */
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
  if (!executor) return promiseUnknown();

  let hasSettle = false;
  let hasResolve = false;
  const resolveValues: Abs[] = [];

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
  const onReject = (_reason?: unknown): Abs => {
    if (!hasSettle) hasSettle = true;
    return undefAbs();
  };

  // B 路径 $callNamed("r", r, …) 对 JS 函数直调；Abs fn 走 applyCallbackValue/$call
  // 必须包成 Abs fn：裸 JS 函数当实参时 $call 认不出 apply，fork 臂里 r(1) 会掉成 unknown
  const resolveAbs = absFunction(["value"], {
    body: noBody,
    apply: (args) => onResolve(args[0]),
  });
  const rejectAbs = absFunction(["reason"], {
    body: noBody,
    apply: (args) => onReject(args[0]),
  });

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

  if (!hasResolve || resolveValues.length === 0) return promiseUnknown();
  // 无 fork：顺序双 resolve 取第一次（原生 no-op）；有 fork：各臂 join
  const inner =
    forks === 0 || resolveValues.length === 1
      ? resolveValues[0]!
      : resolveValues.reduce((a, b) => joinAbs(a, b));
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
  switch (name) {
    case "then": {
      const onFulfilled = args[0];
      if (!onFulfilled) return promiseAbs(inner, recv.conf === "exact" ? "path" : recv.conf);
      // 纯 relation 回调：同步收窄 inner（analyze 路径立刻可读）
      const rel = getFnImpl(onFulfilled)?.relation;
      if (rel && !getFnImpl(onFulfilled)?.body && !getFnImpl(onFulfilled)?.apply) {
        const mapped = instantiateReturn(onFulfilled, [inner]);
        return promiseAbs(unwrapThenable(mapped), recv.conf === "exact" ? "path" : recv.conf);
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
      // 只建模 resolved 通道：onRejected 映射 reject reason（unknown）→ 可能 resolve
      // 回调同样进微任务，不污染同步返回路径
      const onRejected = args[0];
      if (!onRejected) return promiseAbs(inner, recv.conf === "exact" ? "path" : recv.conf);
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
      // finally 不改变 settled value（回调返回值丢弃）
      return promiseAbs(inner, recv.conf === "exact" ? "path" : recv.conf);
    }
    default:
      return undefined;
  }
}

export function evalPromiseStatic(name: string, args: Abs[]): Abs | undefined {
  switch (name) {
    case "resolve": {
      const inner = args[0] ?? unknown;
      // Promise.resolve(thenable) 展开
      if (inner.shape.k === "eff" && inner.shape.eff === "promise") return inner;
      return promiseAbs(inner, "path");
    }
    case "reject":
      return promiseUnknown();
    case "all": {
      const a0 = args[0];
      if (a0?.shape.k === "arr" && a0.shape.element.shape.k === "eff") {
        return promiseAbs(
          abs({ k: "arr", element: a0.shape.element.shape.inner }, undefined, undefined, "path"),
          "path",
        );
      }
      return promiseAbs(
        abs({ k: "arr", element: unknown }, undefined, undefined, "partial"),
        "partial",
      );
    }
    default:
      return undefined;
  }
}

