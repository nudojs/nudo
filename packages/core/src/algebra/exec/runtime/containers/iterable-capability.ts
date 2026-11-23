/**
 * 迭代能力查询：精确展开、单侧元素域、内建精确条目表。
 *
 * 从 iterate.ts 抽出；spread / rest / for-of 共用同一判据。
 */
import type { Abs } from "../../../abs.ts";
import { abs, litValue, strLit, unknown } from "../../../abs.ts";
import { joinAbs } from "../../../objects.ts";
import { $lit } from "../state.ts";
import { anyMemberResult } from "../../member-diag.ts";
import { getEvalClass } from "../../class-registry.ts";
import {
  isMapAbs,
  isSetAbs,
  mapEntriesAbs,
  setElementsAbs,
} from "../../../collections.ts";
import {
  boxedStringChars,
  typedArrayIterElems,
} from "./iterate-brand-elements.ts";
import {
  drainGenElements,
  genDrainViewOf,
  matchIterElements,
} from "../../match-iter.ts";
import { abstractSeqElementOf } from "../../../builtins/error/iterator.ts";
import { urlSearchParamsEntriesOf } from "../../../builtins/error/web.ts";
import {
  USER_ITER_MAX_STEPS,
  collectUserIterElems,
  userIteratorFn,
} from "./user-iterator.ts";

export function iterableExpandElements(x: Abs): Abs[] | null {
  // BUG-401：注解 Map/Set 的 obj 模型长度未知（元素域只在 genElements）——
  // 不得被用户迭代器协议误当精确序列。
  if (x.facets?.brand === "Map" || x.facets?.brand === "Set") return null;
  if (isSetAbs(x)) return setElementsAbs(x);
  if (isMapAbs(x)) return mapEntriesAbs(x);
  // BUG-125：URLSearchParams 自身可迭代（@@iterator === entries）——
  // 条目表精确展开（此前落 brand delegation → inner 无枚举元素 ⇒ [unknown]）。
  const urlSpEls = builtinExactIterableElems(x);
  if (urlSpEls) return urlSpEls;
  // Bug 236：boxed String 品牌——字符序列精确展开（原生 String 包装对象
  // 可迭代：String.prototype[Symbol.iterator] 按 code point 产出字符）
  const boxedChars = boxedStringChars(x);
  if (boxedChars) return boxedChars;
  // Bug 54：生成器对象是消费——从当前位取剩余（drain），此后耗尽
  const drained = drainGenElements(x);
  if (drained) return drained;
  const mi = matchIterElements(x);
  if (mi) return mi;
  // Bug 140：用户 iterable——按迭代序精确展开（GetIterator + IteratorNext）
  const ui = collectUserIterElems(x, USER_ITER_MAX_STEPS);
  if (ui) return ui.truncated ? [...ui.els, unknown] : ui.els;
  // brand 结构面在内层（issue #147）：Set/Map/match-iter brand 已在上方
  // 按名命中，此处只兜结构 delegation（内层 tuple 精确展开等）。
  // TypedArray 家族的迭代元素在内层索引槽（原型 @@iterator 产出元素值）。
  if (x.shape.k === "brand") {
    const taEls = typedArrayIterElems(x);
    if (taEls) return taEls;
    return iterableExpandElements(x.shape.shape);
  }
  // 内层 tuple 精确展开（裸 tuple 已被 $concat 顶部 tuple×tuple 分支
  // 吸收，此处只经 brand delegation 到达）：[...t1, ...brandT2] 保持
  // tuple 形状，元素域与长度均精确（此前折 arr）。
  if (x.shape.k === "tuple") return [...x.shape.elements];
  return null;
}

/** 单侧元素域（与 iterableExpandElements 侧表配套）。 */
export function iterableElementDomain(x: Abs, expanded: Abs[] | null): Abs {
  // DEC-006：空 Set/Map/match-iter 展开无元素——不得裸 reduce
  if (expanded) {
    return expanded.length
      ? expanded.reduce((u, y) => joinAbs(u, y))
      : abs({ k: "never" }, undefined, undefined, "exact");
  }
  if (x?.shape?.k === "any") return anyMemberResult();
  if (x?.shape?.k === "tuple") {
    const els = x.shape.elements;
    // 空 tuple spread 不贡献元素 → never；join(never, any) = any
    return els.length
      ? els.reduce((u, y) => joinAbs(u, y))
      : abs({ k: "never" }, undefined, undefined, "exact");
  }
  // 抽象字符串按 code point 可迭代是 total 面（iterabilityKind 同口径；
  // 字面量字符串在 $concat 顶部已特判展开）——元素域恒 string（Bug 4：
  // [...s] 折 unknown[] 的缺口）
  if (x?.shape?.k === "prim" && x.shape.type === "string") {
    return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
  }
  // arr 元素域 = 单代表元素（顶层 arr 已被函数首部分支吸收，此臂只服务
  // brand delegation 的内层）
  if (x?.shape?.k === "arr") return x.shape.element;
  // brand 结构面在内层（issue #147）：[...Array<T> brand] 元素域 = 内层
  // arr 元素，不再折 unknown（Set/Map/match-iter brand 在 expand 按名命中）。
  // expanded 在此必为 null（顶部 if (expanded) 已返回）——显式传 null。
  if (x?.shape?.k === "brand") return iterableElementDomain(x.shape.shape, null);
  // BUG-401：注解 Map/Set 的 obj 模型 + 长度未知迭代器——只贡献**元素域**
  // 单代表，不声明长度（`$concat` 得 arr，不能折成定长 tuple）。
  if (x?.facets?.brand === "Map" || x?.facets?.brand === "Set") {
    const els = x.facets.genElements;
    if (els && els.length > 0) return els.reduce((u, y) => joinAbs(u, y));
  }
  const ase = abstractSeqElementOf(x);
  if (ase !== undefined) return ase;
  return unknown;
}

/** 只有长度确定的容器才允许走精确展开（否则 tuple 形会假装长度）。 */
export function iterableExactElements(x: Abs): Abs[] | null {
  if (x.facets?.brand === "Map" || x.facets?.brand === "Set") return null;
  if (
    isSetAbs(x) ||
    isMapAbs(x) ||
    matchIterElements(x) !== undefined ||
    genDrainViewOf(x) !== undefined
  ) {
    return iterableExpandElements(x);
  }
  // URLSearchParams / match 迭代器等**内建精确条目表**（可能挂在 obj
  // 模型上，不能先落用户迭代器协议的 truncated 兜底）。
  const builtinEls = builtinExactIterableElems(x);
  if (builtinEls) return builtinEls;
  // 内层 / 裸 tuple 是精确序列（[...brandTuple] 保持 tuple 形状）。
  if (x.shape.k === "tuple") return [...x.shape.elements];
  // 字面量字符串按 code point 精确展开（$arrRest 的 `const [a,...r] = "ab"`
  // 走这里；$concat 在进入能力函数前已特判字符串）。抽象字符串长度不可知 ⇒
  // 仍返回 null，由调用方走元素域。
  const svR = litValue(x);
  if (svR.ok && typeof svR.value === "string") {
    return [...svR.value].map((c) => $lit(c));
  }
  // 用户 iterable 只有在**本轮能走到 done** 时才是精确长度；抽象 done /
  // 截断 ⇒ 交给 sideEl 的单代表元素域（不得折定长 tuple）。brand（用户类
  // 实例）也先走这条：类链上的 `[Symbol.iterator]` 是原型面事实。
  if (userIteratorFn(x)) {
    const ui = collectUserIterElems(x, USER_ITER_MAX_STEPS);
    return ui && !ui.truncated ? ui.els : null;
  }
  // brand 的结构面：boxed String / URLSearchParams / TypedArray 的精确
  // 序列由 expand 侧表提供；内层 tuple 仍是精确序列；内层 arr 长度未知。
  if (x.shape.k === "brand") {
    const expanded = iterableExpandElements(x);
    if (expanded) return expanded;
    return iterableExactElements(x.shape.shape);
  }
  return null;
}

/** 迭代消费（原生 GetIterator）的可迭代性分类：
 *  - total：string prim（任意取值恒可迭代）/ tuple / arr / Set / Map /
 *    matchAll 迭代器 / generator eff / never —— 原生全量
 *  - definite：非 string prim（num/bool/bigint/symbol/null/undefined——这些
 *    prim 的任何取值都没有 @@iterator，含字面量与抽象 prim）与闭 obj
 *    （无 @@iterator 槽；Object.prototype 原型链亦无）
 *  - may：any / unknown / open obj（未知键可能含 @@iterator）/ fn /
 *    promise eff —— 抽象面可能非可迭代
 *  brand：名义标签，结构面在内层——内层 total 则 total（env/harvest 的
 *    Array<T> brand 整族，issue #147）；其余 may，绝不下 definite 结论
 *    （TypedArray/Buffer 等内层空 obj，原型链 @@iterator 不在内层建模）。
 *  sum：逐臂归约（全臂 definite → definite；任一臂非 total → may） */
type IterabilityKind = "total" | "may" | "definite";

/** 可迭代性三档判定（$elems/$iterCheck/$concat 共享；Bug 110 起 Array.from
 *  的 obj 臂同槽复用——@@iterator 槽即 total，两个消费者口径一致）。 */

export function builtinExactIterableElems(a: Abs): Abs[] | undefined {
  if (a.shape.k !== "brand" || a.shape.name !== "URLSearchParams") return undefined;
  if (getEvalClass("URLSearchParams")) return undefined; // 用户类同名 → 自定义迭代面
  const entries = urlSearchParamsEntriesOf(a);
  if (!entries) return undefined;
  return entries.map(([n, v]) =>
    abs(
      { k: "tuple", elements: [strLit(n), strLit(v)] },
      undefined,
      undefined,
      "exact",
    ),
  );
}

/**
 * Bug 236：boxed String 品牌（`new String("ab")` / `Object("ab")`）的字符
 * 序列——内层 obj 带 "0".."n-1" 字符槽（原生 String 包装对象的自有索引
 * 属性）+ length 槽；原生 String.prototype[Symbol.iterator] 按 code point
 * 展开 ⇒ 元素域 = 字符序列（非 literal 抽象串 → undefined，交给上层降级）。
 */


/** Bug 236：boxed String 品牌的长度（原生 String 包装对象 length 自有槽） */


/** for await（GetIterator hint=async）：@@asyncIterator 槽即全量（异步可迭代）；
 *  其余口径与同步迭代一致（数字等 prim definite、闭 obj 无任何迭代器槽
 *  definite、any/unknown/open obj may；数组/字符串走同步回退故仍 total）。 */
