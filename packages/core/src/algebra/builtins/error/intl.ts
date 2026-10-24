/**
 * Intl 子构造器（Bug 44）：NumberFormat/DateTimeFormat 的构造器值
 * （makeIntlCtorAbs，$get 命名空间成员读产出）与 new/调用面
 * （makeIntlFormatAbs，new 省略形 ≡ new——apply 同一校验 builder）。
 *
 * Invariants:
 * - locale 校验与 CanonicalizeLocaleList 同口径：缺省/undefined → 默认
 *   locale 恒不抛；string 字面量畸形 → 硬抛 RangeError；null → TypeError
 *  （ToObject(null)）；number/bool/bigint/symbol 非 String → array-like 空
 *   表默认 locale 不抛（不经 ToString）；tuple 逐项（非 string/object 项
 *   确定 TypeError）；抽象 → may RangeError + 保守构造。
 * - BCP47 结构校验（isWellFormedIntlLocaleTag）只拒「确定不可能」形——
 *   合形未知 tag（"zz"）原生不抛（node 实测），宁可放过奇异合形不可误拒
 *   合法 tag。
 * - 实例方法面不建模（Intl.<Sub>.proto.* 维持 imprecise 台账）。
 */

import type { Abs } from "../../abs.ts";
import { abs, litValue, bool, strLit, unknown } from "../../abs.ts";
import { objOf } from "../../objects.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { absFunction } from "../../abs-fn.ts";
import { isSymbolAbs } from "../symbol.ts";
import { noBody } from "../shared.ts";

// --- Intl 命名空间构造器（Bug 44）---------------------------------------

/** Bug 44：建模的 Intl 子构造器（带 locale 校验的构造器值） */
export type IntlSubCtor = "NumberFormat" | "DateTimeFormat";

/** Intl 格式化实例 brand（方法面不建模——台账 Intl.<Sub>.proto.* 维持 imprecise） */
function intlFormatBrandAbs(sub: IntlSubCtor): Abs {
  return abs(
    { k: "brand", name: `Intl.${sub}`, shape: objOf({}) },
    undefined,
    undefined,
    "path",
  );
}

/**
 * Bug 44：BCP47 结构校验（Intl 口径，宽松）。只拒「确定不可能」形：
 * 合形但未知的 tag（如 "zz"）原生不抛（node 实测）→ 正常构造，故宁可
 * 放过奇异合形（如非法 u 扩展键），不可误拒合法 tag。
 *
 * node ground truth（NumberFormat ≡ DateTimeFormat）：
 * - 字符集 [A-Za-z0-9-]、无首尾 '-'、无 '--'（"en_US"/"zh~Hans"/"en US" 抛）；
 * - 语言子标签 2-3 或 5-8 alpha：1/4/9+ 字符与含数字均畸形（"e"/"abcd"/
 *   "abcdefghi"/"123"/"1234" 抛；"excess" 6 字符 OK）——4 字符保留给 script，
 *   且 Intl 不收 extlang（"en-abc" 抛）与纯私有用（"x-private" 抛）；
 * - [script 4alpha] [region 2alpha|3digit] 顺序固定（"en-US-Hans" 抛）；
 * - variant 5-8 alnum 或 digit+3alnum（"en-123"/"de-CH-1901" OK；
 *   "en-a1b2" 抛）；singleton 扩展后跟 2-8 alnum 子标签（"en-a-aaa-u-bbb"
 *   OK；"en-a"/"en-a-b" 抛）；puext "x-" 后 1-8 alnum（"en-x-us" OK、
 *   "en-x"/13 字符子标签抛）；
 * - 祖父标签按 grammar 覆盖：i- 系/en-GB-oed/zh-min 系等畸形子标签形全抛，
 *   art-lojban/zh-guoyu 等合法替代形按 lang+variant 合形通过（node 同）。
 */
function isWellFormedIntlLocaleTag(tag: string): boolean {
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(tag)) return false;
  const subs = tag.toLowerCase().split("-");
  const isAlpha = (s: string) => /^[a-z]+$/.test(s);
  const isAlnum = (s: string) => /^[a-z0-9]+$/.test(s);
  const isVariant = (s: string) =>
    (s.length >= 5 && s.length <= 8 && isAlnum(s)) ||
    (s.length === 4 && s.charCodeAt(0) >= 0x30 && s.charCodeAt(0) <= 0x39 && isAlnum(s));
  const n = subs.length;
  const lang = subs[0]!;
  if (
    !isAlpha(lang) ||
    (lang.length !== 2 && lang.length !== 3 && (lang.length < 5 || lang.length > 8))
  ) {
    return false;
  }
  let i = 1;
  if (i < n && isAlpha(subs[i]!) && subs[i]!.length === 4) i++; // script
  if (
    i < n &&
    ((isAlpha(subs[i]!) && subs[i]!.length === 2) || /^[0-9]{3}$/.test(subs[i]!))
  ) {
    i++; // region
  }
  while (i < n && isVariant(subs[i]!)) i++;
  // 扩展序列：singleton（非 x）+ 至少一个 2-8 alnum 子标签（可多个序列）
  while (i < n && subs[i]!.length === 1 && subs[i]! !== "x" && isAlnum(subs[i]!)) {
    i++;
    let took = 0;
    while (i < n && subs[i]!.length >= 2 && subs[i]!.length <= 8 && isAlnum(subs[i]!)) {
      i++;
      took++;
    }
    if (took === 0) return false;
  }
  // 尾部私有用：x + 至少一个 1-8 alnum 子标签
  if (i < n && subs[i]! === "x") {
    i++;
    if (i >= n) return false;
    while (i < n && subs[i]!.length <= 8 && isAlnum(subs[i]!)) i++;
  }
  return i === n;
}

/**
 * Bug 44：Intl.NumberFormat / Intl.DateTimeFormat 构造（locale 校验与
 * CanonicalizeLocaleList 同口径，node ground truth）：
 * - 缺省 / undefined → 默认 locale，恒不抛；
 * - string 字面量畸形（不可能字符 / 空串 / 不合 BCP47 形）→ 硬抛
 *   RangeError；合形（含未知 tag "zz"）→ 正常构造；
 * - null 字面量 → 确定 TypeError（ToObject(null)）；
 * - 其余原始值字面量（number/boolean/bigint/symbol）非 String → 按
 *   array-like 空 locale 表 → 默认 locale，原生不抛（node 实测
 *   new Intl.NumberFormat(123) OK——不经 ToString，"123" 字符串才抛）；
 * - tuple 字面量 → 逐项：string 项同判；非 string/object 项确定
 *   TypeError（"Language ID should be string or object"）；抽象项保守 may；
 * - 抽象（any/unknown/obj/arr/sum 等）→ may RangeError + 保守构造。
 * options（第二参）不校验（任务口径：仅 locale 面）。
 */
export function makeIntlFormatAbs(sub: IntlSubCtor, locales: Abs | undefined): Abs {
  if (!locales || (locales.term?.op === "lit" && locales.term.value === undefined)) {
    return intlFormatBrandAbs(sub);
  }
  if (locales.term?.op === "lit" && locales.term.value === null) {
    throw new NudoThrow(errorTypeAbs("TypeError")); // ToObject(null)
  }
  const vR = litValue(locales);
  if (vR.ok && typeof vR.value === "string") {
    if (!isWellFormedIntlLocaleTag(vR.value)) {
      throw new NudoThrow(errorTypeAbs("RangeError")); // Invalid language tag
    }
    return intlFormatBrandAbs(sub);
  }
  if (vR.ok) return intlFormatBrandAbs(sub); // number/bool/bigint：array-like 空表
  // symbol：非 String → array-like 空表（ToObject 包装后无 length）→ 默认
  // locale，原生不抛（node 实测；symbol Abs 无 lit 项，须按形状判）
  if (isSymbolAbs(locales)) return intlFormatBrandAbs(sub);
  if (locales.shape.k === "tuple") {
    for (const el of locales.shape.elements) {
      const eR = litValue(el);
      if (eR.ok) {
        if (typeof eR.value === "string") {
          if (!isWellFormedIntlLocaleTag(eR.value)) {
            throw new NudoThrow(errorTypeAbs("RangeError"));
          }
          continue;
        }
        throw new NudoThrow(errorTypeAbs("TypeError")); // 非 string/object 的语言 ID 项
      }
      recordMayThrow({ kind: "RangeError", cause: `Intl.${sub} locale entry may be invalid` });
      return intlFormatBrandAbs(sub);
    }
    return intlFormatBrandAbs(sub);
  }
  recordMayThrow({ kind: "RangeError", cause: `Intl.${sub} locale may be invalid` });
  return intlFormatBrandAbs(sub);
}

/**
 * Bug 44：Intl.NumberFormat / Intl.DateTimeFormat 构造器值（$get 命名空间
 * 成员读产出）。fn shape name "Intl.<Sub>" → $new 按名派发 evalBuiltinNew；
 * 调用面（原生 new 省略形 Intl.NumberFormat("en") ≡ new）走 apply 同一
 * 校验 builder。ctor facet true（typeof "function"、可 new）。
 *
 * Bug 332：fn **name** 属性原生是**子构造器名**（`Intl.NumberFormat.name`
 * → "NumberFormat"，非 "Intl.NumberFormat"）。shape.name 是 $new 的**派发
 * 键**（declare.ts 按 `cs.name` 派发 evalBuiltinNew——"Intl.NumberFormat"
 * 命中 dispatch 的 case），不能改；改走**自有 name 槽**——member.ts 的
 * dual-facet fn 静态槽臂（自有槽优先）在 shape.name 面之前 ⇒ 读面折
 * "NumberFormat"，派发键仍是 "Intl.NumberFormat"（两口径互不干扰）。
 */
export function makeIntlCtorAbs(sub: IntlSubCtor): Abs {
  return absFunction(
    ["locales", "options"],
    {
      body: noBody,
      apply: (args) => makeIntlFormatAbs(sub, args[0]),
    },
    {
      name: `Intl.${sub}`,
      ctor: true,
      slots: { name: { value: strLit(sub) } },
    },
  );
}
