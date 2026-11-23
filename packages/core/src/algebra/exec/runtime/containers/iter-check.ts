/**
 * 数组解构用的用户迭代器读取器（GetIterator）。
 *
 * 从 iterate.ts 抽出；依赖 iterate 的可迭代性守卫与内建精确条目表。
 */
import { builtinExactIterableElems, guardIterable } from "./iterate.ts";
import type { Abs } from "../../../abs.ts";
import { litValue, strLit, unknown } from "../../../abs.ts";
import {
  matchIterElements,
  replayGenDeferred,
  userIterOf,
} from "../../match-iter.ts";
import { $arr } from "./arr-make.ts";
import { $get } from "./member.ts";
import { $call } from "../../call.ts";
import { asAbsVal, litTruth, undef } from "../state.ts";
import { errorTypeAbs } from "../../may-throw.ts";
import {
  USER_ITER_MAX_STEPS,
  collectUserIterElems,
  iteratorClose,
  type UserIterReader,
} from "./user-iterator.ts";

export function $iterCheck(a: unknown, maxElements?: number): UserIterReader | null {
  const v = asAbsVal(a);
  guardIterable(v, "array destructuring");
  // Bug 34：体内抛错的生成器（延迟异常挂对象侧表）——解构消费触达抛点
  replayGenDeferred(v);
  const bounded = maxElements !== undefined && maxElements >= 0;
  // BUG-125：URLSearchParams 的数组解构按条目表读取（与 @@iterator === entries
  // 同源）——必须先于用户迭代协议采集：brand 的 @@iterator 是内建符号成员
  // （可调用派发），collectUserIterElems 只会采到 unknown 兜底。
  {
    const urlSpEls = builtinExactIterableElems(v);
    if (urlSpEls) {
      return {
        get: (i: number): Abs => (i < urlSpEls.length ? urlSpEls[i]! : undef()),
        rest: (i: number): Abs => $arr(urlSpEls.slice(i)),
      };
    }
  }
  const r = collectUserIterElems(
    v,
    maxElements === undefined || maxElements < 0 ? USER_ITER_MAX_STEPS : maxElements,
  );
  if (!r) {
    // Bug 4：数组解构对**字符串**接收者按 code point 迭代（原生
    // GetIterator + String.prototype[Symbol.iterator]）。此前 $iterCheck 对
    // 字符串返回 null ⇒ emit.ts 的 readAt 回落 `$idx(str, i)`（UTF-16 码元
    // 下标）⇒ "𠮷" 解出孤立高/低代理项。值可判的字面量串在此按码点给
    // 读取器；抽象 string 域仍返回 null（回落路径不折假精确）。
    const sv = v.shape.k === "prim" && (v.shape as { type?: string }).type === "string"
      ? litValue(v)
      : undefined;
    if (sv?.ok && typeof sv.value === "string") {
      const cps = Array.from(sv.value, (cp) => strLit(cp));
      return {
        get: (i: number): Abs => (i < cps.length ? cps[i]! : undef()),
        rest: (i: number): Abs => $arr(cps.slice(i)),
      };
    }
    return null;
  }
  const { els, truncated } = r;
  // Bug 199：模式填满（无 rest）而迭代器未耗尽 ⇒ IteratorClose（原生调
  // `return()`——`const [a,b] = it` 也会触发）。模式带 rest（取到 done）
  // 或迭代器已耗尽 ⇒ 不调用（原生同）。
  if (bounded && els.length >= maxElements! && !truncated) {
    iteratorClose(userIterOf(v));
  }
  return {
    get: (i: number): Abs => (i < els.length ? els[i]! : truncated ? unknown : undef()),
    rest: (i: number): Abs => (truncated ? unknown : $arr(els.slice(i))),
  };
}

/** 元素列表（tuple 展开；arr 抽象；C1 Set/Map 逐条目；matchAll 迭代器逐匹配项；
 *  字符串按 code points）。Map 迭代语义是 entry `[key, value]` 元组，不是裸 value。
 *  消费前先过可迭代性守卫（Bug 6）：prim 字面量接收者 → 原生 definite
 *  TypeError；any/unknown → may。$forOf 与 call/new spread 实参路径继承。
 *  Bug 34：生成器对象的体内延迟异常（definite 抛 / soft may-throw 重记）
 *  在消费点重放——迭代不再静默截断成前缀。 */
