/**
 * 容器入口守卫层：BUG-173 this 访问门 / BUG-215 迭代槽守卫 / BUG-217 访问器分流。
 * 此前这五个同构 wrapper+Inner 两层样板内联在 containers.ts barrel 里
 * （$idx/$iterCheck/$get/$set/$idxSet：非-Abs 判定 → 守卫 → 委派 Inner）；
 * 收敛为一个 guardedEntry 工厂后 barrel 回归纯 re-export。行为与诊断
 * 逐字不变：守卫只对 Abs 入参生效（判定面单源 isAbsLike，含 conf 检查），
 * 宿主值直通 Inner——DEC-006 退路（透传原值 / unknown / 硬抛）由各 Inner 自带。
 */
import type { Abs } from "../../../abs.ts";
import { litValue, isAbsLike } from "../../../abs.ts";
import { getSlot } from "../../../objects.ts";
import { getFnImpl } from "../../../abs-fn.ts";
import { NudoThrow } from "../../nudo-throw.ts";
import { errorTypeAbs } from "../../may-throw.ts";
import { $idx as $idxInner, $idxSet as $idxSetInner } from "./arr-index.ts";
import {
  $elems as $elemsInner,
  $forOf as $forOfInner,
  $iterCheck as $iterCheckInner,
} from "./iterate.ts";
import { $get as $getInner, $set as $setInner, hasOwnAccessorOf } from "./member.ts";
import { assertThisAccessible } from "../../super-access.ts";

/**
 * 同构守卫入口工厂：Abs 入参先过守卫再委派 Inner；非 Abs（宿主值 / 缺参
 * undefined）直通 Inner。守卫统一拿 `Abs`（isAbsLike 收窄后传入）。
 */
function guardedEntry<A, Args extends unknown[], R>(
  guard: (a: Abs) => void,
  inner: (a: A, ...args: Args) => R,
): (a: A, ...args: Args) => R {
  return (a, ...args) => {
    if (isAbsLike(a)) guard(a);
    return inner(a, ...args);
  };
}

/**
 * 同构守卫入口工厂（**序言短路形**，Bug 219 / #12）：in/delete 族入口
 * （members.ts 的 `$in` / `$del` / `$delRes`）的接收者守卫序言——
 *
 * - 非 Abs 宿主接收者按 `failClosed` 折（Bug 219/DEC-006 B/C：转译层把
 *   `globalThis` / `Math` 等自由标识符原样当接收者发射；序言直读
 *   `.shape.k` 会炸宿主 ⇒ 整模块 fail-closed）。各入口折值不同
 *   （$in/$delRes → unknown；$del 写回通道 → 原样透传），故 failClosed
 *   是参数。
 * - Abs 上的序言（nullish/never 硬抛、prim/sum/any 的域折 + may-throw
 *   记录）可**短路返回**；返回 undefined（PASS）才委派 Inner——与
 *   {@link guardedEntry} 的 void 守卫互补（那边守卫只断言不折值）。
 * - `receiverIdx` 指接收者实参位（`$in(key, o)` 的接收者在第二位）。
 *
 * isAbsLike 判定面单源在本工厂（与 guardedEntry 同格）。
 */
export function guardedPrologueEntry<Args extends unknown[], R>(
  receiverIdx: number,
  failClosed: (o: unknown) => R,
  prologue: (o: Abs, args: Args) => R | undefined,
  inner: (...args: Args) => R,
): (...args: Args) => R {
  return (...args: Args) => {
    const o = args[receiverIdx];
    if (!isAbsLike(o)) return failClosed(o);
    const r = prologue(o as Abs, args);
    if (r !== undefined) return r;
    return inner(...args);
  };
}

/**
 * BUG-217：计算键成员读（`o[k]`）此前走 `$idx`，而 `$idx` **只读数据槽**、
 * 不查访问器侧表 / 类访问器 ⇒ `{ get n(){return 42} }` 的 `o[k]` 折占位
 * `undefined`（自信的错值；`o[k] === undefined` 恒真）。修复面**收窄到
 * 「该键上确实有访问器」**：访问器真值不在槽里（transpile 只落
 * `$lit(void 0)` 占位），只有这种读必须走 `$get` 的求值口径；其余
 * （数据槽 / 原型链名 / 数组下标 / 符号键 / TypedArray 元素域）保持
 * `$idx` 的槽读语义——整键委派 `$get` 会把闭 shape 的 `o["toString"]`
 * 折成继承来的原型函数（BUG-001 的自信错值），并吃掉 TypedArray 的
 * 「长度未建模 ⇒ 元素 ∪ undefined」诚实臂。
 */
export const $idx: (a: Abs, i: Abs, opts?: { silent?: boolean }) => Abs = guardedEntry(
  assertThisAccessible,
  function idxAccessorSplit(a: Abs, i: Abs, opts?: { silent?: boolean }): Abs {
    const sh = (a as Abs)?.shape;
    if (sh && (sh.k === "obj" || sh.k === "brand")) {
      const lv = litValue(i);
      if (lv.ok && (typeof lv.value === "string" || typeof lv.value === "number")) {
        const key = String(lv.value);
        if (hasOwnAccessorOf(a as Abs, key)) {
          return $getInner(a as Abs, key, opts?.silent ? { silent: true } : undefined);
        }
      }
    }
    return $idxInner(a, i, opts);
  },
);

/**
 * BUG-215：`@@iterator` 槽**存在但确定不可调用**（`{ [Symbol.iterator]: 5 }`
 * / `null` / `undefined`）时，原生 `GetMethod` 取到非可调用值 ⇒ 迭代定抛
 * TypeError。迭代分类只看「槽是否存在」⇒ 判成完全可迭代、循环体按 0 个
 * 元素消费（假绿）。守卫在下游消费入口统一执行（for-of / spread 实参 /
 * 数组解构），语义与原生 GetMethod 一致。
 *
 * 例外：引擎自建的迭代器占位（`body === noBody` 的 absFunction）**有** impl
 * ⇒ 不走「确定不可调用」臂（否则会把引擎迭代器误判成原生 TypeError）。
 */
function definitelyBrokenIteratorSlot(a: Abs): boolean {
  if (!isAbsLike(a)) return false;
  const sh = (a as Abs).shape;
  const inner = sh.k === "brand" ? (sh as { shape?: Abs }).shape : (a as Abs);
  if (!inner || inner.shape.k !== "obj") return false;
  const slot = getSlot(inner.shape.slots, "@@iterator");
  if (!slot) return false;
  const v = slot.value;
  if (v.shape.k === "fn") return false;
  if (getFnImpl(v) !== undefined) return false;
  if (v.shape.k === "any" || v.shape.k === "sum") return false;
  if (v.shape.k === "unknown") return !!v.term && v.term.op === "lit";
  return true;
}

function guardIteratorSlot(a: Abs): void {
  if (definitelyBrokenIteratorSlot(a)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
}

/** spread 实参 / for-of / yield* 的元素消费入口（BUG-215 守卫）。 */
export function $elems(a: Abs): Abs[] {
  guardIteratorSlot(a);
  return $elemsInner(a);
}

/** `for..of` 入口（BUG-215 守卫；`for await` 同入口）。 */
export function $forOf(
  iterable: Abs,
  body: (item: Abs, index: Abs) => void,
  maxIters?: number,
  opts?: Parameters<typeof $forOfInner>[3],
): void {
  guardIteratorSlot(iterable);
  return $forOfInner(iterable, body, maxIters, opts);
}

/** 数组解构入口（BUG-215 守卫）。 */
export const $iterCheck = guardedEntry(guardIteratorSlot, $iterCheckInner);

/**
 * BUG-173：`this` 访问门（派生构造器 super() 之前访问 ⇒ 原生 ReferenceError）。
 * `$get` / `$set` 是成员读写的主通道；构造器体的 this 未被 super() 标记时
 * 在此硬抛（`constructClass` 在派生类构造器体执行期间登记）。
 * （显式函数类型注解：api 文档签名面——工厂产物无注解时生成器只能给裸 const。）
 */
export const $get: (
  o: Abs,
  key: string,
  opts?: Parameters<typeof $getInner>[2],
  receiver?: Parameters<typeof $getInner>[3],
) => ReturnType<typeof $getInner> = guardedEntry(assertThisAccessible, $getInner);

export const $set: (
  o: Abs,
  key: string,
  value: Abs,
  opts?: Parameters<typeof $setInner>[3],
) => ReturnType<typeof $setInner> = guardedEntry(assertThisAccessible, $setInner);

/** BUG-173：计算键写入口的 `this` 访问门（`this[k] = v` 不走 `$set`）。 */
export const $idxSet: (
  o: Abs,
  i: Abs,
  v: Abs,
) => ReturnType<typeof $idxSetInner> = guardedEntry(assertThisAccessible, $idxSetInner);
