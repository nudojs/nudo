/**
 * RegExpStringIterator（matchAll 结果）内容侧表。
 * matchAll 返回迭代器**对象**（无 .length、不可下标），不是元组——
 * 但 spread/Array.from/for-of 需要按匹配项精确展开。
 * 形状：brand "RegExpMatchIterator"（inner 空 obj），元素挂本模块侧表；
 * 消费端（$concat/$elems/Array.from）经 matchIterElements 读取。
 * 独立叶子模块避免 runtime ↔ class 循环依赖。
 */
import type { Abs } from "../abs.ts";
import type { MayThrowEffect } from "../may-throw.ts";
import { recordMayThrow } from "../may-throw.ts";
import { NudoThrow } from "./nudo-throw.ts";

const tables = new WeakMap<object, Abs[]>();

export function registerMatchIter(val: Abs, elements: Abs[]): void {
  tables.set(val as object, elements);
}

/** 模板标签对象（$tpl，Bug 34）的元素侧表：obj 形状 + @@iterator 槽 +
 *  已知 cooked 元素——spread / for-of / Array.from / join 精确展开
 *  （否则元素折 unknown，`[...s].join()` 假 may-symbol）。 */
const tplIterTables = new WeakMap<object, Abs[]>();

export function registerTplElements(val: Abs, elements: Abs[]): void {
  tplIterTables.set(val as object, elements);
}

/** 生成器对象（$gen，Bug 22）元素侧表：obj 形状 + next/return/throw 方法
 *  槽 + @@iterator——yield 元素挂本表，for-of / spread / Array.from /
 *  yield* / 数组解构按序精确展开（迭代路径从新表示取出元素域）。 */
const genIterTables = new WeakMap<object, Abs[]>();

export function registerGenElements(val: Abs, elements: Abs[]): void {
  genIterTables.set(val as object, elements);
}

/** 生成器体内延迟异常（Bug 34）：$gen eager 体执行捕获的异常载荷
 *  （definite）+ 吞帧保留的 soft may-throw 效果——延迟到消费点重放。
 *  native：体异常属首个触达抛点的 next()（此后 done），g() 构造期不表面。 */
export interface GenDeferred {
  throw: Abs | undefined;
  soft: MayThrowEffect[];
}
const genDeferredTables = new WeakMap<object, GenDeferred>();

export function registerGenDeferred(val: Abs, deferred: GenDeferred): void {
  genDeferredTables.set(val as object, deferred);
}

/** 消费点重放（Bug 34）：迭代路径（for-of / spread / yield* / 解构 /
 *  Array.from）触达即——soft 效果重记进当前帧（gate 面：`yield* x`
 *  （x:any）体内 may-throw 不再被丢弃式帧吞掉），definite 载荷抛
 *  NudoThrow（迭代截断点）。仅构造不消费不重放（Bug 58 口径保持）。 */
export function replayGenDeferred(a: Abs): void {
  const d = genDeferredTables.get(a as object);
  if (!d) return;
  for (const e of d.soft) recordMayThrow(e);
  if (d.throw !== undefined) throw new NudoThrow(d.throw);
}

export function matchIterElements(a: Abs): Abs[] | undefined {
  if (a.shape.k === "obj" && a.shape.slots["@@iterator"]) {
    const ge = genIterTables.get(a as object);
    if (ge) return ge;
    const els = tplIterTables.get(a as object);
    if (els) return els;
  }
  if (a.shape.k !== "brand" || a.shape.name !== "RegExpMatchIterator") {
    return undefined;
  }
  return tables.get(a as object);
}
