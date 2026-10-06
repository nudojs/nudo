/**
 * RegExpStringIterator（matchAll 结果）内容侧表。
 * matchAll 返回迭代器**对象**（无 .length、不可下标），不是元组——
 * 但 spread/Array.from/for-of 需要按匹配项精确展开。
 * 形状：brand "RegExpMatchIterator"（inner 空 obj），元素挂本模块侧表；
 * 消费端（$concat/$elems/Array.from）经 matchIterElements 读取。
 * 独立叶子模块避免 runtime ↔ class 循环依赖。
 */
import type { Abs } from "../abs.ts";

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
