/**
 * 可迭代性分类：total / definite / may，以及 async 变体。
 *
 * 从 iterate.ts 抽出；能力查询见 iterable-capability。
 */
import type { Abs } from "../../../abs.ts";
import { TYPED_ARRAY_ELEMENT } from "../../../builtins/shared.ts";
import { getEvalClass } from "../../class-registry.ts";
import { brandProtoHasIterator } from "../members.ts";

export type IterabilityKind = "total" | "may" | "definite";
import { isMapAbs, isSetAbs } from "../../../collections.ts";
import { genDrainViewOf, matchIterElements } from "../../match-iter.ts";
import { typedArrayEnumKeyView } from "../../../builtins/object/enum-entries.ts";
import { abstractSeqElementOf } from "../../../builtins/error/iterator.ts";
import { classSpecOfAbs } from "../../class-registry.ts";
import { userIteratorFn } from "./user-iterator.ts";
import { builtinExactIterableElems } from "./iterable-capability.ts";

export function iterabilityKind(a: Abs): IterabilityKind {
  const s = a.shape;
  if (s.k === "sum") {
    let sawNonTotal = false;
    let allDefinite = true;
    for (const m of s.members) {
      const k = iterabilityKind(m);
      if (k !== "definite") allDefinite = false;
      if (k !== "total") sawNonTotal = true;
    }
    return s.members.length > 0 && allDefinite
      ? "definite"
      : sawNonTotal
        ? "may"
        : "total";
  }
  // lit 字面量精确判定（与 $concat 的 throwIfNonIterable 同口径）：非字符串
  // prim 字面量恒不可迭代 → definite。nullish lit 的形状是 unknown（无独立
  // nullish shape），必须先看 term 再看形状。
  if (a.term?.op === "lit") {
    const v: unknown = (a.term as { value: unknown }).value;
    if (
      v === null ||
      v === undefined ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      typeof v === "bigint" ||
      typeof v === "symbol"
    ) {
      return "definite";
    }
  }
  if (s.k === "tuple" || s.k === "arr" || s.k === "never") return "total";
  if (isSetAbs(a) || isMapAbs(a) || matchIterElements(a)) return "total";
  if (s.k === "eff") return s.eff === "generator" ? "total" : "may";
  if (s.k === "prim") return s.type === "string" ? "total" : "definite";
  if (s.k === "obj") {
    if (s.slots["@@iterator"]) return "total";
    return s.open ? "may" : "definite";
  }
  // brand 只是名义标签，不改变结构可迭代性（issue #147）：
  // 内层全量可迭代 → total；否则 may——不下 definite（内层结构不承诺
  // 原型链无 @@iterator）。
  if (s.k === "brand") {
    // Bug 236：内建 brand 的**原型面 @@iterator 存在性**（原生规范固定，可静态
    // 判定）。此前一律「内层 total → total，否则 may」⇒ **全部 brand 一律判
    // 「可能不可迭代」**：`[...new String("ab")]` 记 may-throw TypeError
    // （L1/L2 假红——原生返回 ["a","b"]），而 `new Number(1)`（原生确实不
    // 可迭代、展开定抛）也只记 may（不精确）。查原型而非内层 ⇒ 分流成立。
    const protoKind = builtinBrandProtoIterability(s.name);
    if (protoKind) return protoKind;
    // BUG-125：URLSearchParams 的 @@iterator === entries（规范固定）——
    // 条目表是否已知只影响元素域精度，不影响「恒可迭代」这一分类。
    if (s.name === "URLSearchParams" && !getEvalClass(s.name)) return "total";
    // BUG-118：用户类实例在**类体里**定义 `[Symbol.iterator]` —— 原型面
    // 就是可迭代事实（与对象字面量的 `s.slots["@@iterator"]` 同口径）。
    // 判据复用同一实现 userIteratorFn（$get 沿类链解析 + hasRealImpl）；
    // 内层只有实例字段 ⇒ 旧回落恒 may（合法自定义 iterable 判红）。
    // 用**随值携带的类规格**判身份（同名类跨模块 last-wins 不串味）。
    if (classSpecOfAbs(a) !== undefined && userIteratorFn(a)) return "total";
    return iterabilityKind(s.shape) === "total" ? "total" : "may";
  }
  return "may";
}

/**
 * Bug 236：内建 brand 的原型链 @@iterator 存在性（原生规范固定 ⇒ 静态可判）。
 *
 * - String：String.prototype[Symbol.iterator] 存在 ⇒ **可迭代**（total）
 * - Number / Boolean：原型无 @@iterator ⇒ **不可迭代**（definite——展开
 *   定抛 TypeError，与原生一致）
 *
 * 只对**未被用户类占用**的品牌名生效：用户 `class Number { *[Symbol.iterator](){} }`
 * 是自定义可迭代家族，不得套内建结论（回落 may）。其余内建 brand 不在表内
 * （TypedArray 家族原型确有 @@iterator，但内层空 obj 不承诺 ⇒ 保守 may，
 * 与 Bug 236 前的口径一致，无回归）。
 */
function builtinBrandProtoIterability(name: string): IterabilityKind | undefined {
  // TypedArray 家族 / Map / Set / URLSearchParams：原型链确实有 @@iterator
  // （与 $get 值读面同一张 ITERABLE_BRANDS 表）。此前只认 String/Number/
  // Boolean ⇒ TA 的 spread / for-of 走 may 分支记 TypeError（合法代码
  // strict profile 下 exit 1），而同一接收者的 `typeof u8[Symbol.iterator]`
  // 已折 "function"。
  if (brandProtoHasIterator(name)) return "total";
  if (name !== "String" && name !== "Number" && name !== "Boolean") return undefined;
  if (getEvalClass(name)) return undefined; // 用户类同名 → 不可套内建结论
  return name === "String" ? "total" : "definite";
}

/**
 * BUG-125：内建 brand 的**精确可迭代元素序列**（目前仅 URLSearchParams）。
 *
 * `URLSearchParams` 的 `@@iterator` 是 `entries`（WHATWG）——条目表由
 * `urlSearchParamsEntriesOf`（web.ts 单一真值源）给出时，spread / for-of /
 * 数组解构 / `Array.from` 都可精确展开。此前 `iterabilityKind` 的 brand
 * 分支只认 String/Number/Boolean 原型面 ⇒ URLSearchParams 落 may（假
 * TypeError），且 `elemsOf` / `$concat.expand` 无条目表分支 ⇒ 元素域
 * `[unknown]`。用户类同名（`class URLSearchParams`）时不套内建结论。
 */


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
export function asyncIterabilityKind(a: Abs): IterabilityKind {
  const s = a.shape;
  if (s.k === "sum") {
    let sawNonTotal = false;
    let allDefinite = true;
    for (const m of s.members) {
      const k = asyncIterabilityKind(m);
      if (k !== "definite") allDefinite = false;
      if (k !== "total") sawNonTotal = true;
    }
    return s.members.length > 0 && allDefinite
      ? "definite"
      : sawNonTotal
        ? "may"
        : "total";
  }
  if (
    s.k === "obj" &&
    !s.slots["@@iterator"] &&
    s.slots["@@asyncIterator"]
  ) {
    return "total";
  }
  // brand 同步口径（issue #147）：内层仅异步可迭代（只有 @@asyncIterator 槽）
  // → total；其余委派 iterabilityKind（其 brand 臂按内层结构面判）。
  if (s.k === "brand") {
    const ish = s.shape.shape;
    if (
      ish.k === "obj" &&
      !ish.slots["@@iterator"] &&
      ish.slots["@@asyncIterator"]
    ) {
      return "total";
    }
  }
  return iterabilityKind(a);
}

/** 迭代消费守卫：definite 非可迭代 → 原生 TypeError（hard NudoThrow）；
 *  抽象面可能非可迭代 → recordMayThrow（值域投影不变）。
 *  $elems（for-of / spread 实参）与 $iterCheck（数组解构）共用。 */
