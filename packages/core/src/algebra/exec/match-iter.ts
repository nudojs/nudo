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
import { getSlot } from "../objects.ts";
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

/** 生成器消费视图（Bug 54）：迭代消费（spread / for-of / Array.from /
 *  解构 / yield*）从当前位取剩余元素并推进生成器状态——与 next() 同步，
 *  侧表不再从 0 重放已消费元素。drain 返回剩余快照并排空（迭代耗尽
 *  语义）；peek 供数组解构逐项投影按消费位读（不推进）。 */
interface GenIterView {
  drain: () => Abs[];
  peek: (i: number) => Abs | undefined;
  peekAll: () => Abs[];
}
const genDrainTables = new WeakMap<object, GenIterView>();

export function registerGenDrain(val: Abs, view: GenIterView): void {
  genDrainTables.set(val as object, view);
}

export function drainGenElements(a: Abs): Abs[] | undefined {
  const d = genDrainTables.get(a as object);
  return d ? d.drain() : undefined;
}

/** 生成器对象的消费位视图（无条目 → undefined）：$idx 数字下标按
 *  live 视图读（解构 `const [a] = it` 在部分消费后取当前位元素）。 */
export function peekGenElement(a: Abs, i: number): Abs | undefined {
  const d = genDrainTables.get(a as object);
  return d ? d.peek(i) : undefined;
}

/** 生成器对象消费位判定（$idx 分派） */
export function hasGenView(a: Abs): boolean {
  return genDrainTables.has(a as object);
}

/** 消费位剩余快照（不推进）——$idx 抽象下标 join 用 */
export function peekAllGenElements(a: Abs): Abs[] {
  const d = genDrainTables.get(a as object);
  return d ? d.peekAll() : [];
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

// --- Proxy 对象侧表（Bug 57/71）------------------------------------------
// makeProxyAbs 的 brand "Proxy"（inner = target Abs）只承载靶形态；
// target/handler 引用挂本表——get/has/set 陷阱派发（$get/$set/$in）与
// 无陷阱回退读靶用。独立于 error.ts（leaf 模块，无环）。

export interface ProxyParts {
  target: Abs;
  handler: Abs | undefined;
}

const proxyTables = new WeakMap<object, ProxyParts>();

export function registerProxyParts(val: Abs, parts: ProxyParts): void {
  proxyTables.set(val as object, parts);
}

export function proxyPartsOf(a: Abs): ProxyParts | undefined {
  return proxyTables.get(a as object);
}

/**
 * Proxy handler 陷阱判定（Bug 71）：GetMethod(handler, trap) 的三值投影。
 * - fn：陷阱可调用（$call 派发，receiver = handler）
 * - dead：有槽但不可调用（原生每次触达抛 TypeError——降级 sound）
 * - opaque：handler 形态不可判（any/open obj…）——结果域按 unknown 近似
 * - absent：无陷阱（回退靶语义）
 */
export type ProxyTrap = { k: "fn"; fn: Abs } | { k: "dead" } | { k: "opaque" } | { k: "absent" };

export function proxyTrapOf(
  handler: Abs | undefined,
  name: "get" | "has" | "set",
): ProxyTrap {
  if (!handler) return { k: "opaque" };
  const s = handler.shape;
  if (s.k === "any" || s.k === "unknown" || s.k === "sum") return { k: "opaque" };
  const objShape =
    s.k === "obj"
      ? s
      : s.k === "brand" && s.shape.shape.k === "obj"
        ? s.shape.shape
        : undefined;
  if (!objShape) return { k: "opaque" };
  const slot = getSlot(objShape.slots, name);
  if (!slot) return objShape.open ? { k: "opaque" } : { k: "absent" };
  if (slot.optional) return { k: "opaque" };
  const v = slot.value;
  // undefined 字面量陷阱 ≡ 缺省（原生 GetMethod 只排除 undefined/null）
  if (v.term?.op === "lit" && (v.term.value === undefined || v.term.value === null)) {
    return { k: "absent" };
  }
  if (v.shape.k === "fn") return { k: "fn", fn: v };
  return { k: "dead" };
}

/**
 * $copy 快照迁移（fork/switch 臂重绑）：生成器对象经
 * `$copy(__fkN_it)` 换新身份后，迭代元素 / 延迟异常侧表
 * 必须随副本迁移——否则臂内消费（for-of / spread / yield*）
 * 重放点查不到副本，definite 体异常被静默丢弃（L2 假阴）。
 * 无条目时零开销（WeakMap miss 即返回）。
 */
export function copyMatchIterTables(src: Abs, dst: Abs): void {
  const s = src as object;
  const d = dst as object;
  if (tables.has(s)) tables.set(d, tables.get(s)!);
  if (tplIterTables.has(s)) tplIterTables.set(d, tplIterTables.get(s)!);
  if (genIterTables.has(s)) genIterTables.set(d, genIterTables.get(s)!);
  if (genDrainTables.has(s)) genDrainTables.set(d, genDrainTables.get(s)!);
  if (genDeferredTables.has(s)) genDeferredTables.set(d, genDeferredTables.get(s)!);
  if (proxyTables.has(s)) proxyTables.set(d, proxyTables.get(s)!);
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
