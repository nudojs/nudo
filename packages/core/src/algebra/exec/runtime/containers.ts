import type { Abs } from "../../abs.ts";
import { litValue } from "../../abs.ts";
import { getSlot } from "../../objects.ts";
import { getFnImpl } from "../../abs-fn.ts";
import { NudoThrow } from "../nudo-throw.ts";
import { errorTypeAbs } from "../may-throw.ts";
import { $idx as $idxInner, $idxSet as $idxSetInner } from "./containers/arr-index.ts";
import {
  $elems as $elemsInner,
  $forOf as $forOfInner,
  $iterCheck as $iterCheckInner,
} from "./containers/iterate.ts";
import { $get as $getInner, $set as $setInner, hasOwnAccessorOf } from "./containers/member.ts";
import { assertThisAccessible } from "../super-access.ts";

/**
 * 数组 / 对象运行时：$arr/$idx/$len/$arrMutContainer 与 $obj/$get/$set/$spread。
 *
 * 按域拆分（barrel 保持原导入面不变）：
 * - arr-make    元组/数组构造与宽化（$arr/$arguments/rest 哨兵/widenTupleToArr）
 * - arr-methods 就地 mutator 族（push/pop/splice/sort/copyWithin/fill）
 * - arr-index   下标读写与长度（$idx/$idxSet/$len + abstractLen memo）
 * - obj         对象构造/展开/rest + 容器快照（$obj/$spread/$copy）
 * - iterate     迭代协议与 spread/rest 投影（$elems/$forOf/$concat/$arrRest）
 * - member      成员读写与命名空间/原型派发（$get/$set/NAMESPACE_GLOBALS）
 */
export {
  privateNameGuard,
  $copy,
  $obj,
  $setProto,
  $spread,
  $objRest,
} from "./containers/obj.ts";
export {
  tupleOrWiden,
  $arr,
  $arguments,
  $arrWithHoles,
  makeSymbolicRestAbs,
  isSymbolicRestAbs,
  $restBind,
  widenTupleToArr,
} from "./containers/arr-make.ts";
export {
  ARR_MUTATORS,
  isArrMutator,
  toIOI,
  clampWindow,
  copyWithinTuple,
  fillTuple,
  sortTupleAbs,
  $arrMutContainer,
} from "./containers/arr-methods.ts";
export {
  $len,
} from "./containers/arr-index.ts";
export {
  $arrRest,
  $concat,
  $yieldStarElems,
  $tpl,
  $forInKeys,
  $collectionForEach,
} from "./containers/iterate.ts";
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
export function $idx(
  a: Abs,
  i: Abs,
  opts?: { silent?: boolean },
): Abs {
  if (a && typeof a === "object" && "shape" in (a as object)) {
    assertThisAccessible(a as Abs);
  }
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
}

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
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return false;
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
export function $iterCheck(
  a: unknown,
  maxElements?: number,
): ReturnType<typeof $iterCheckInner> {
  if (a && typeof a === "object" && "shape" in (a as object)) {
    guardIteratorSlot(a as Abs);
  }
  return $iterCheckInner(a, maxElements);
}

/**
 * BUG-173：`this` 访问门（派生构造器 super() 之前访问 ⇒ 原生 ReferenceError）。
 * `$get` / `$set` 是成员读写的主通道；构造器体的 this 未被 super() 标记时
 * 在此硬抛（`constructClass` 在派生类构造器体执行期间登记）。
 */
export function $get(
  o: Abs,
  key: string,
  opts?: Parameters<typeof $getInner>[2],
  receiver?: Parameters<typeof $getInner>[3],
): ReturnType<typeof $getInner> {
  if (o && typeof o === "object" && "shape" in (o as object)) assertThisAccessible(o);
  return $getInner(o, key, opts, receiver);
}

export function $set(
  o: Abs,
  key: string,
  value: Abs,
  opts?: Parameters<typeof $setInner>[3],
): ReturnType<typeof $setInner> {
  if (o && typeof o === "object" && "shape" in (o as object)) assertThisAccessible(o);
  return $setInner(o, key, value, opts);
}

/** BUG-173：计算键写入口的 `this` 访问门（`this[k] = v` 不走 `$set`）。 */
export function $idxSet(o: Abs, i: Abs, v: Abs): Abs {
  if (o && typeof o === "object" && "shape" in (o as object)) assertThisAccessible(o);
  return $idxSetInner(o, i, v);
}

export {
  NAMESPACE_GLOBALS,
  namespaceNameOf,
  $regex,
  setProtoMethodDispatch,
  protoMethodValueAbs,
} from "./containers/member.ts";
