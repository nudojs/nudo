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

export function matchIterElements(a: Abs): Abs[] | undefined {
  if (a.shape.k !== "brand" || a.shape.name !== "RegExpMatchIterator") {
    return undefined;
  }
  return tables.get(a as object);
}
