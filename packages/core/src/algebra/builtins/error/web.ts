/**
 * Web API 构造器：URL（urlBrandAbs/makeUrlAbs）/ TextDecoder /
 * URLSearchParams。
 *
 * Invariants:
 * - URL 字面量真解析（宿主 try/catch，Invalid → TypeError 硬抛）；解析成功
 *   带宿主精确组件槽（href/origin/protocol/hostname/pathname/search/hash/
 *   port/username/password），may 臂组件槽取 string 域——解析成功时原生恒
 *   string（空串也是 string），不得空槽 miss 成 undefined；base 先于
 *   input 解析（绝对 input 配非法 base 仍抛，不可误 definite）。
 * - TextDecoder label 过 WHATWG 匹配（strip ASCII 空白 + 小写）：知名 label
 *   折 canonical 名；表外 ASCII 形保守 may RangeError（宿主 ICU 表有差异）；
 *   含 label 字符集外字符 → 确定 RangeError；缺省 ≡ undefined 字面量 → utf-8。
 * - URLSearchParams init 形态判定：tuple 元素非 [name,value] 二元组 / 无
 *   @@iterator 槽的闭 obj 元素 → 确定 TypeError；二元组与 record 槽值过
 *   ToString symbol 校验（noteBoxedCtorArg，boxed 域单一口径）；Map brand
 *   条目恒二元组合法；抽象 → may TypeError。
 */

import type { Abs } from "../../abs.ts";
import { abs, strLit, litValue, bool, unknown } from "../../abs.ts";
import { objOf, getSlot } from "../../objects.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { isSymbolAbs } from "../symbol.ts";
import { str } from "../shared.ts";

import { isNullishLit } from "./error-family.ts";
import { noteBoxedCtorArg } from "./boxed.ts";

/** URL brand：解析成功携带宿主精确组件槽（Bug 29 补 7 组件——hostname/
 *  pathname/search/hash/port/username/password，与 href/origin/protocol 同口径）。
 *  无宿主实例（抽象 input / 抽象 base 的 may-throw 臂）：组件槽取 string 域
 *  ——解析成功时原生各组件恒为 string（空串也是 string），不得空槽 miss 成
 *  `undefined`（fn-sig-impl URL symbolic 回归）。 */
function urlBrandAbs(u?: URL): Abs {
  const componentKeys = [
    "href",
    "origin",
    "protocol",
    "hostname",
    "pathname",
    "search",
    "hash",
    "port",
    "username",
    "password",
  ] as const;
  const slots: Record<string, { value: Abs }> = {};
  for (const key of componentKeys) {
    slots[key] = { value: u ? strLit(u[key]) : str("path") };
  }
  return abs(
    { k: "brand", name: "URL", shape: objOf(slots) },
    undefined,
    undefined,
    u ? "exact" : "path",
  );
}

/**
 * Bug 85：new URL(input, base?) —— input 过 ToString（symbol → TypeError）
 * 再 URL 解析：字符串字面量真解析（宿主 try/catch，Invalid URL → TypeError；
 * base 字面量同传——原生先解析 base，绝对 input 配非法 base 仍抛）；
 * number/bool/bigint/null/缺省的 ToString 恒不可解析 → 确定 TypeError；
 * any/unknown/对象（自定义 toString 可能合法）→ may。
 */
export function makeUrlAbs(input: Abs | undefined, base: Abs | undefined): Abs {
  if (!input) throw new NudoThrow(errorTypeAbs("TypeError")); // 缺省：原生 "url" 参数必填
  if (isSymbolAbs(input)) throw new NudoThrow(errorTypeAbs("TypeError"));
  const vR = litValue(input);
  if (vR.ok && typeof vR.value === "string") {
    // base：字符串字面量同传（原生先解析 base——绝对 input 配非法 base 仍抛）；
    // undefined 字面量/缺省 ≡ 无 base；其余字面量（null/number/…）的 ToString
    // 恒不可作 base → 确定 TypeError；抽象/对象 base 无法判定 → 只记 may
    // （相对 input 配合法 base 原生可解析，不得误 definite）
    const bR = base ? litValue(base) : undefined;
    const baseStr = bR?.ok && typeof bR.value === "string" ? bR.value : undefined;
    const baseAbsent =
      !base || (base.term?.op === "lit" && base.term.value === undefined);
    if (!baseAbsent && baseStr === undefined) {
      if (base && (isSymbolAbs(base) || litValue(base).ok)) {
        throw new NudoThrow(errorTypeAbs("TypeError")); // 非法 base 字面量
      }
      recordMayThrow({ kind: "TypeError", cause: "URL base may be invalid" });
      return urlBrandAbs();
    }
    try {
      const u = baseStr !== undefined ? new URL(vR.value, baseStr) : new URL(vR.value);
      return urlBrandAbs(u);
    } catch {
      throw new NudoThrow(errorTypeAbs("TypeError")); // Invalid URL
    }
  }
  if (vR.ok) {
    // number/boolean/bigint/null/undefined 字面量：ToString 无 scheme 恒不可解析
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  recordMayThrow({ kind: "TypeError", cause: "URL input may be invalid" });
  return urlBrandAbs();
}

/**
 * TextDecoder 知名 encoding label → canonical 名（node 实测口径；全部
 * WHATWG label 表的子集——表外 ASCII 形 label 走保守 may RangeError，
 * 不枚举全表）。匹配前 strip ASCII 空白 + 小写（WHATWG label 算法）。
 */
const TEXT_DECODER_KNOWN_LABELS: Record<string, string> = {
  "utf-8": "utf-8",
  utf8: "utf-8",
  "unicode-1-1-utf-8": "utf-8",
  unicode11utf8: "utf-8",
  unicode20utf8: "utf-8",
  "x-unicode20utf8": "utf-8",
  "utf-16le": "utf-16le",
  "utf-16": "utf-16le",
  "utf-16be": "utf-16be",
  unicodefffe: "utf-16be",
  "iso-8859-1": "windows-1252",
  "iso8859-1": "windows-1252",
  "iso_8859-1": "windows-1252",
  iso88591: "windows-1252",
  "iso-ir-100": "windows-1252",
  latin1: "windows-1252",
  l1: "windows-1252",
  cp819: "windows-1252",
  ibm819: "windows-1252",
  "windows-1252": "windows-1252",
  cp1252: "windows-1252",
  "x-cp1252": "windows-1252",
  ascii: "windows-1252",
  "us-ascii": "windows-1252",
  "ansi_x3.4-1968": "windows-1252",
};

/** TextDecoder brand：encoding 槽（may 臂取 string 域——构造成功时原生恒 string） */
function textDecoderBrandAbs(encoding?: string): Abs {
  const slots: Record<string, { value: Abs }> = {
    encoding: { value: encoding !== undefined ? strLit(encoding) : str("path") },
  };
  return abs(
    { k: "brand", name: "TextDecoder", shape: objOf(slots) },
    undefined,
    undefined,
    encoding !== undefined ? "exact" : "path",
  );
}

/**
 * new TextDecoder(label?) —— label 过 ToString（symbol → TypeError）后按
 * WHATWG encoding label 匹配（strip ASCII 空白 + 小写）：
 * - 含 label 字符集（[A-Za-z0-9_.:()/-]）外字符（如 `$`/空格）→ 任何
 *   label 表都不含 → 确定 RangeError（node: new TextDecoder("bad-$$")）；
 * - 知名 label（utf-8/utf8/utf-16le/iso-8859-1/latin1/ascii…）→ 正常构造
 *   （encoding 槽取 canonical 名）；缺省/undefined 字面量 ≡ 默认 utf-8；
 * - 其余 ASCII 形 label（表未枚举，宿主 ICU 表有差异）→ 保守 may
 *   RangeError；非 string 字面量 ToString 折叠后同判（123 → "123"）；
 * - 抽象 label → may RangeError。options（fatal/ignoreBOM）布尔面不校验。
 */
export function makeTextDecoderAbs(label: Abs | undefined): Abs {
  // 缺省 ≡ undefined 字面量：WebIDL 默认 label = "utf-8"（node 实测
  // new TextDecoder(undefined) → encoding "utf-8"）
  if (!label || (label.term?.op === "lit" && label.term.value === undefined)) {
    return textDecoderBrandAbs("utf-8");
  }
  if (isSymbolAbs(label)) throw new NudoThrow(errorTypeAbs("TypeError")); // ToString(symbol)
  const vR = litValue(label);
  let labelStr: string | undefined;
  if (vR.ok) labelStr = String(vR.value); // 非 string 字面量按 ToString 折叠
  if (labelStr !== undefined) {
    // WHATWG label 匹配：strip 首尾 ASCII 空白（TAB/LF/FF/CR/SPACE）后判
    const stripped = labelStr.replace(/^[ \t\n\f\r]+/, "").replace(/[ \t\n\f\r]+$/, "");
    if (/[^A-Za-z0-9_.:()/-]/.test(stripped)) {
      throw new NudoThrow(errorTypeAbs("RangeError")); // 不可能出现在任何 label 中
    }
    const canonical = TEXT_DECODER_KNOWN_LABELS[stripped.toLowerCase()];
    if (canonical !== undefined) return textDecoderBrandAbs(canonical);
    // ASCII 形未知 label：宿主 label 表有差异（node 实测 iso-8859-1:1987
    // 即抛）→ 保守 may RangeError
    recordMayThrow({ kind: "RangeError", cause: "TextDecoder encoding label may be unsupported" });
    return textDecoderBrandAbs();
  }
  recordMayThrow({ kind: "RangeError", cause: "TextDecoder encoding label may be invalid" });
  return textDecoderBrandAbs();
}

/** URLSearchParams brand（条目表不建模——与 WeakMap/WeakSet 空 brand 同口径） */
function urlSearchParamsBrandAbs(): Abs {
  return abs(
    { k: "brand", name: "URLSearchParams", shape: objOf({}) },
    undefined,
    undefined,
    "path",
  );
}

/**
 * new URLSearchParams(init?) —— init 形态判定（node ground truth：
 * ("a=1") 解析构造 / ([["a"]]) TypeError "Each query pair must be an
 * iterable [name, value] tuple" / (42) → ToString 后按查询串解析 [["42",""]]）：
 * - 缺省/nullish/symbol 以外字面量 → 原生恒 total（null 解析出 "null" 条目）；
 * - tuple 字面量元素非 [name,value] 二元组（非 tuple / 长度 ≠ 2）→ 确定
 *   TypeError；闭 obj 元素无 @@iterator 槽（非可迭代 pair，如 [{}]）→ 确定
 *   TypeError；二元组元素走 ToString symbol 校验（noteBoxedCtorArg 同口径）；
 * - 开放数组（arr）/ sum / 抽象 / Set brand → may TypeError；
 * - Map brand 条目恒二元组 → 正常构造；对象 init（record 路径）槽值走
 *   ToString symbol 校验。
 */
export function makeUrlSearchParamsAbs(init: Abs | undefined): Abs {
  if (!init || isNullishLit(init)) return urlSearchParamsBrandAbs();
  if (isSymbolAbs(init)) throw new NudoThrow(errorTypeAbs("TypeError")); // ToString(symbol)
  const vR = litValue(init);
  if (vR.ok) return urlSearchParamsBrandAbs(); // string/number/bool/bigint：ToString 解析恒不抛
  if (init.shape.k === "tuple") {
    for (const el of init.shape.elements) {
      // 元素必须是 [name,value] 二元组：prim 恒非 entry（node: (["a"]) TypeError）
      if (el.shape.k === "prim") throw new NudoThrow(errorTypeAbs("TypeError"));
      if (el.shape.k === "tuple") {
        if (el.shape.elements.length !== 2) {
          throw new NudoThrow(errorTypeAbs("TypeError")); // ([["a"]]) / ([["a","b","c"]])
        }
        // name/value ToString：symbol 确定 TypeError、any → may
        noteBoxedCtorArg("String", el.shape.elements[0]);
        noteBoxedCtorArg("String", el.shape.elements[1]);
        continue;
      }
      // 闭 obj 且无 @@iterator 槽 → 非可迭代 pair 元素，确定 TypeError
      //（node：new URLSearchParams([{}]) / ([{0:"a",1:"b"}]) 均抛；
      // 带 @@iterator 槽 / open obj 可能自定义迭代 → 落下方 may）
      if (
        el.shape.k === "obj" &&
        (el.shape as { open?: boolean }).open !== true &&
        !getSlot((el.shape as { slots: Record<string, { value: Abs }> }).slots, "@@iterator")
      ) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // arr/obj/sum/brand…元素无法确定是二元组 → may TypeError
      recordMayThrow({
        kind: "TypeError",
        cause: "URLSearchParams init entries may not be [name, value] pairs",
      });
    }
    return urlSearchParamsBrandAbs();
  }
  if (init.shape.k === "obj") {
    if (init.shape.open === true) {
      // 开放对象：未枚举槽值可能为 symbol（ToString 抛）或携带自定义迭代
      recordMayThrow({
        kind: "TypeError",
        cause: "URLSearchParams record values may be symbols",
      });
      return urlSearchParamsBrandAbs();
    }
    // record 路径：槽值 ToString（symbol 确定/any → may）
    for (const key of Object.keys(init.shape.slots)) {
      noteBoxedCtorArg("String", init.shape.slots[key]!.value);
    }
    return urlSearchParamsBrandAbs();
  }
  if (init.shape.k === "brand" && init.shape.name === "Map") {
    return urlSearchParamsBrandAbs(); // 条目恒二元组
  }
  // arr / Set brand / sum / any / unknown / 其余 brand → 保守 may TypeError
  recordMayThrow({ kind: "TypeError", cause: "URLSearchParams init may be invalid" });
  return urlSearchParamsBrandAbs();
}
