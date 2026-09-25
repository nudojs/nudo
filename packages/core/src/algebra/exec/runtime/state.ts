/**
 * B 路径运行时共享状态：phi、就地写、字面量 Abs、真值、循环信号。
 * 叶子模块——不依赖 runtime 其它文件。
 */
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, numLit, unknown, type Confidence } from "../../abs.ts";
import { lit } from "../../term.ts";
import type { Phi } from "../../pred.ts";
import { pTrue, and, predEquals } from "../../pred.ts";
import { absFunction, getFnImpl } from "../../abs-fn.ts";
import { NudoThrow, isNudoThrow } from "../nudo-throw.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { errorTypeAbs, $tryMarkSoft, $tryDigestSoft, $tryReleaseSoft, popMayThrowFrame, orphanMayThrowEffects, type MayThrowEffect } from "../may-throw.ts";
import { $arr, $obj } from "./containers.ts";

export { NudoThrow, isNudoThrow };

export function writeInPlace(target: Abs, next: Abs): Abs {
  target.shape = next.shape;
  target.conf = next.conf;
  target.term = undefined;
  target.pred = undefined;
  return target;
}

/** 调用方已直接改 shape 时的 term/pred 清理 */
export function clearStaleTermPred(v: Abs): void {
  v.term = undefined;
  v.pred = undefined;
}

/** 当前路径前提 Φ（transpile 后的 fork 会压栈） */
export let phi: Phi = pTrue;

export function currentExecPhi(): Phi {
  return phi;
}

export function withExecPhi<T>(p: Phi, body: () => T): T {
  const prev = phi;
  phi = p;
  try {
    return body();
  } finally {
    phi = prev;
  }
}

/** apply 型 impl 的占位 body（AbsFnImpl.body 必需；$call 走 apply 不经 body） */
type EmptyBlock = { type: "BlockStatement"; body: never[]; directives: never[] };
export const noBody: EmptyBlock = { type: "BlockStatement", body: [], directives: [] };

/**
 * transpile 泄漏的 JS 函数值 → 一等 fn Abs。
 * B 路径把函数声明/表达式编译成真实 JS 函数；它们流进对象槽、
 * 元组、join 等 Abs 结构时不能裸存——下游（bridge/leq/join）读 `.shape`。
 * 参数名无法从运行时函数恢复（用 fn.length → argN，与 analyzer 的
 * extractParamNames 回退口径一致）；带真实参数名走 $fnVal（transpile 侧）。
 */
export function asAbsVal(v: unknown): Abs {
  if (v && typeof v === "object" && "shape" in (v as object)) return v as Abs;
  if (typeof v === "function") {
    const n = Math.max(0, v.length);
    const params = Array.from({ length: n }, (_, i) => `arg${i}`);
    return absFunction(params, {
      body: noBody,
      // 与 $fnVal / $callNamed 同边界：callee 的 NudoReturn 不得冒泡成 caller
      apply: (args) => callAtFunctionBoundary(() => (v as (...a: Abs[]) => Abs)(...args)),
    });
  }
  return $lit(v);
}

/**
 * 函数调用边界：callee 的 loop/early-return 不得冒泡成 caller 结果。
 * 每个 B 路径调用帧独立 ALS；NudoReturn 收成该调用的返回值。
 */
export function callAtFunctionBoundary<T>(body: () => T): T {
  return runWithLoopExits(() => {
    try {
      return body();
    } catch (e) {
      if (isNudoReturn(e)) return e.absValue as unknown as T;
      throw e;
    }
  });
}

/** 函数表达式 → 一等 fn Abs（transpile 侧带真实参数名；异步 body 包 $async）
 *  opts.bindThis：对象方法——$invoke 会把 receiver 作为 impl 首参注入。 */
export function $fnVal(
  params: string[],
  impl: (...args: Abs[]) => Abs,
  opts?: { bindThis?: boolean },
): Abs {
  return absFunction(params, {
    body: noBody,
    // bindThis（对象方法）：receiver 走首参注入，无宿主 this；
    // 非方法 fn：宿主 this 传递（call/apply/bind 的 thisArg 经 $rawThis 进入函数体）
    apply: opts?.bindThis
      ? (args) => callAtFunctionBoundary(() => impl(...args))
      : (args, thisVal) => callAtFunctionBoundary(() => impl.apply(thisVal as unknown as Parameters<typeof impl>[0], args)),
    ...(opts?.bindThis ? { bindThis: true } : {}),
  });
}

/**
 * 宿主 this → Abs：函数体 prologue 用它承接 call/apply/bind 传入的 thisArg。
 * Abs 原样返回；宿主 undefined（普通调用/call 缺 thisArg）→ $lit(undefined)。
 * B 路径产物是 new Function 拼接（sloppy），裸调用的宿主 this 泄漏为
 * globalThis——归一到 $lit(undefined)（strict 模块语义下的 this）。
 */
export function $rawThis(v: unknown): Abs {
  if (v === undefined || v === globalThis) return $lit(undefined);
  if (v && typeof v === "object" && "shape" in (v as object)) return v as Abs;
  return $lit(v);
}

/**
 * strict 模块语义下写不可变目标（frozen/sealed 新键/nonext 新键/
 * writable:false/getter-only/non-configurable 删）→ hard TypeError。
 * 抛 NudoThrow 由 catch 转译吸收为 TypeError 绑定；无 catch 时函数中断
 * （never + throws），callTranspiledExportFull 上报 L2 entry-may-throw。
 */
export function throwStrictWrite(): never {
  throw new NudoThrow(errorTypeAbs("TypeError"));
}

/** 字面量 → Abs（transpile 侧数字/字符串/布尔/null/undefined） */
export function $lit(v: unknown): Abs {
  if (v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object)) {
    return v as Abs;
  }
  return litAbsFromJs(v);
}

export function litAbsFromJs(v: unknown, depth = 0): Abs {
  if (v === null || v === undefined) {
    return abs({ k: "unknown" }, { op: "lit", value: v as unknown as import("../../term.ts").LiteralValue }, pTrue, "exact");
  }
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean" || t === "bigint") {
    return abs(
      { k: "prim", type: t as "number" | "string" | "boolean" | "bigint" },
      { op: "lit", value: v as unknown as import("../../term.ts").LiteralValue },
      pTrue,
      "exact",
    );
  }
  // JS 数组/纯对象字面量 → tuple/obj（与源码 $arr/$obj 同构）；
  // 循环引用/过深/非 plain 对象（Date/Map/Set/RegExp…）诚实 unknown。
  if (depth < 8) {
    if (Array.isArray(v)) {
      return $arr(v.map((x) => litAbsFromJs(x, depth + 1)));
    }
    if (t === "object") {
      const proto = Object.getPrototypeOf(v);
      if (proto === Object.prototype || proto === null) {
        const slots: Record<string, Abs> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          slots[k] = litAbsFromJs(val, depth + 1);
        }
        return $obj(slots);
      }
    }
  }
  return unknown;
}

/** JS 真值：字面量按 Boolean(v)；对象形恒真；不可判 → undefined */
export function litTruth(a: Abs): boolean | undefined {
  if (a.term?.op === "lit") {
    // lit(undefined) 与「无 lit」都经 litValue 折叠成 undefined，须先看 term
    return Boolean(a.term.value);
  }
  switch (a.shape.k) {
    case "obj":
    case "arr":
    case "tuple":
    case "fn":
    case "brand":
    case "eff":
      return true;
    case "prim":
      return a.shape.type === "symbol" || a.shape.type === "bigint" ? true : undefined;
    case "never":
      return false;
    default:
      return undefined;
  }
}

export function isDefinitelyTrue(a: Abs): boolean {
  return litTruth(a) === true;
}

export function isDefinitelyFalse(a: Abs): boolean {
  const t = litTruth(a);
  if (t === false) return true;
  if (a.shape.k === "never") return true;
  return false;
}

export function undef(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: undefined }, pTrue, "exact");
}

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

/** B 路径「函数提前 return」信号（区别于 throw） */
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
 * break/continue 信号：transpile 在循环体内生成 $loopBreak/$loopContinue，
 * $for/$whileSeq/$forOf 在 body 调用点捕获。带标签信号只被同标签循环吸收，
 * 不匹配继续冒泡到外层循环（`break outer` / `continue outer` 语义）。
 */
export class NudoLoopSignal extends Error {
  readonly kind: "break" | "continue";
  readonly label: string | undefined;
  constructor(kind: "break" | "continue", label?: string) {
    super("nudo:loop");
    this.name = "NudoLoopSignal";
    this.kind = kind;
    this.label = label;
  }
}

export function $loopBreak(label?: string): never {
  throw new NudoLoopSignal("break", label || undefined);
}

export function $loopContinue(label?: string): never {
  throw new NudoLoopSignal("continue", label || undefined);
}

/** 无标签信号匹配任何循环；带标签信号仅匹配同名循环 */
export function loopSignalMatches(e: NudoLoopSignal, label: string | undefined): boolean {
  return e.label === undefined || e.label === label;
}

export function isNudoBreak(e: unknown, label?: string): boolean {
  return e instanceof NudoLoopSignal && e.kind === "break" && loopSignalMatches(e, label);
}

export function isNudoContinue(e: unknown, label?: string): boolean {
  return e instanceof NudoLoopSignal && e.kind === "continue" && loopSignalMatches(e, label);
}

/** 非循环 labeled block：判断 break 信号是否指向本标签（transpile 生成代码用） */
export function $isBreakTo(e: unknown, label: string): boolean {
  return e instanceof NudoLoopSignal && e.kind === "break" && e.label === label;
}

/** catch 转译辅助：控制流信号透传（生成代码只注入 `$` 前缀符号） */
export function $rethrowIfNudoReturn(e: unknown): void {
  if (isNudoReturn(e)) throw e;
}
