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
import { abs, absLit, strLit, litValue, bool, boolLit, numLit, unknown } from "../../abs.ts";
import { objOf, getSlot, setSlot } from "../../objects.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { isSymbolAbs } from "../symbol.ts";
import { str } from "../shared.ts";
import { undefAbs } from "../../hof.ts";
import { collectionIteratorAbs } from "./iterator.ts";

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
    // Bug 163：`host`（含端口；`hostname` 不含）是 `URL.prototype` 的
    // 真实访问器——主机面漏建模 ⇒ `u.host` 折 exact undefined（假绿）+
    // `"host" in u` 折 exact false（假红）。
    "host",
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
  // Bug 322：`searchParams` 组件槽（原生 URL 恒带）——值 = URLSearchParams
  // brand，条目表由宿主 URL 的 search 组件精确推出（原生 searchParams
  // 与 search 组件同源）。抽象 input 臂（无宿主 URL）⇒ 条目表不可知
  // （brand 缺席条目表 ⇒ 读取面 unknown）。
  slots["searchParams"] = {
    value: u
      ? urlSearchParamsBrandAbs(parseQueryEntries(u.search))
      : urlSearchParamsBrandAbs(),
  };
  return abs(
    { k: "brand", name: "URL", shape: objOf(slots) },
    undefined,
    undefined,
    u ? "exact" : "path",
  );
}

/**
 * 查询串 → 条目对（WHATWG application/x-www-form-urlencoded 解析）。
 * 宿主 `new URLSearchParams(s)` 是规范实现（node v26 与浏览器一致）⇒
 * 直接用宿主解析，避免自造解析器的偏差。
 */
function parseQueryEntries(search: string): UrlSearchParamsEntry[] {
  try {
    return [...new URLSearchParams(search).entries()];
  } catch {
    return [];
  }
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
 * Bug 174：`new TextDecoder(label, options?)` 的 **options 位**（WebIDL
 * dictionary 转换）——此前建模函数只收 label，`args[1]` 被整段丢弃 ⇒
 * `new TextDecoder("utf-8", "x")` 宿主必抛 TypeError、引擎判不抛（假绿）。
 *
 * 宿主 node v26.10.0 实测口径：
 * - undefined / null ≡ 空字典；对象 / 数组 / 函数 → 合法（不抛）；
 * - string / number / boolean / bigint / symbol → 确定
 *   `TypeError: The "options" argument must be of type object.`；
 * - 抽象 options（any/unknown / 含对象臂的 union）→ 可能非对象 ⇒ may；
 *   **全 prim 臂的 union** → 定抛。
 * 校验顺序同宿主：label ToString（symbol TypeError）→ options 字典转换 →
 * label 查找（RangeError）。
 */
function validateTextDecoderOptions(options: Abs | undefined): void {
  if (!options) return;
  if (isSymbolAbs(options)) throw new NudoThrow(errorTypeAbs("TypeError"));
  /** 该 Abs 是否**确定**非对象（字面量 prim / prim 形态；null/undefined ≡ 空字典） */
  const definitelyNonObject = (a: Abs): boolean => {
    const v = litValue(a);
    if (v.ok) {
      return (
        v.value !== null &&
        v.value !== undefined &&
        typeof v.value !== "object" &&
        typeof v.value !== "function"
      );
    }
    return a.shape.k === "prim";
  };
  const vR = litValue(options);
  if (vR.ok) {
    if (definitelyNonObject(options)) throw new NudoThrow(errorTypeAbs("TypeError"));
    return; // null / 对象 / 函数 / 数组
  }
  const s = options.shape;
  if (s.k === "prim") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (s.k === "sum") {
    const members = (s as { members?: Abs[] }).members ?? [];
    if (members.length > 0 && members.every(definitelyNonObject)) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    recordMayThrow({
      kind: "TypeError",
      cause: 'TextDecoder options may be a non-object (WebIDL dictionary)',
    });
    return;
  }
  if (s.k === "any" || s.k === "unknown") {
    recordMayThrow({
      kind: "TypeError",
      cause: 'TextDecoder options may be a non-object (WebIDL dictionary)',
    });
    return;
  }
  // obj/brand/tuple/arr/fn/eff → 对象形态，字典转换合法
}

/**
 * new TextDecoder(label?, options?) —— label 过 ToString（symbol → TypeError）
 * 后按 WHATWG encoding label 匹配（strip ASCII 空白 + 小写）：
 * - 含 label 字符集（[A-Za-z0-9_.:()/-]）外字符（如 `$`/空格）→ 任何
 *   label 表都不含 → 确定 RangeError（node: new TextDecoder("bad-$$")）；
 * - 知名 label（utf-8/utf8/utf-16le/iso-8859-1/latin1/ascii…）→ 正常构造
 *   （encoding 槽取 canonical 名）；缺省/undefined 字面量 ≡ 默认 utf-8；
 * - 其余 ASCII 形 label（表未枚举，宿主 ICU 表有差异）→ 保守 may
 *   RangeError；非 string 字面量 ToString 折叠后同判（123 → "123"）；
 * - 抽象 label → may RangeError。
 * - Bug 174：options（第二实参）过 WebIDL 字典转换（非对象 → 确定
 *   TypeError，见 validateTextDecoderOptions）；fatal/ignoreBOM 的**值**
 *   面仍不校验（ToBoolean 不抛）。
 */
export function makeTextDecoderAbs(label: Abs | undefined, options?: Abs): Abs {
  // WebIDL 实参转换序：label ToString（symbol → TypeError）先于 options
  // 字典转换（node 实测 new TextDecoder(Symbol(), 42) → Symbol TypeError）
  if (label && isSymbolAbs(label)) throw new NudoThrow(errorTypeAbs("TypeError")); // ToString(symbol)
  validateTextDecoderOptions(options);
  // 缺省 ≡ undefined 字面量：WebIDL 默认 label = "utf-8"（node 实测
  // new TextDecoder(undefined) → encoding "utf-8"）
  if (!label || (label.term?.op === "lit" && label.term.value === undefined)) {
    return textDecoderBrandAbs("utf-8");
  }
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

/**
 * URLSearchParams brand：带**条目表**（[name, value] 对的序列）。
 *
 * Bug 322：条目表此前不建模（空 brand）⇒ `sp.get("a")` 折 unknown。原生
 * URLSearchParams 恒有可枚举的条目表（`new URLSearchParams("a=1")` → 一条
 * `["a","1"]`）⇒ 条目表可从**确定来源**精确推出：
 * - 字符串字面量 init → 按 WHATWG 查询串解析（宿主 `new URLSearchParams(s)`）；
 * - URL brand 的 searchParams → 由宿主 URL 的 search 组件解析；
 * - 二元组 tuple / record init → 元素/槽值均为字符串字面量时逐条给出。
 * 条目表缺席 = **值域不可知**（抽象 init / may 臂）⇒ 读取面折 unknown。
 *
 * 条目表存内层 obj 的 `@@entries` 槽（内部槽——原生不可枚举/不可见）。
 */
export const URL_SEARCH_PARAMS_ENTRIES_SLOT = "@@entries";

/** URLSearchParams 条目（[name, value] 字符串对） */
export type UrlSearchParamsEntry = [string, string];

/** URLSearchParams brand：entries 缺席 = 条目表不可知（unknown 域） */
function urlSearchParamsBrandAbs(entries?: UrlSearchParamsEntry[]): Abs {
  const slots: Record<string, { value: Abs; internal?: boolean }> = {};
  if (entries !== undefined) {
    // Bug 157：`@@entries` 是**内部槽**（原生不可枚举 / 不可见——
    // `Object.getOwnPropertyNames(new URLSearchParams("a=1"))` 是 `[]`）⇒
    // 必须打 `internal` 标记，否则投影面（format / denote / projection /
    // service internal-slot 都按 `internal` 剔除）把它当**必填自有属性**
    // 发布 ⇒ guard 产物对被导出函数自己的返回值**恒假**。
    slots[URL_SEARCH_PARAMS_ENTRIES_SLOT] = {
      internal: true,
      value: abs(
        {
          k: "tuple",
          elements: entries.map(
            ([n, v]) =>
              abs({ k: "tuple", elements: [strLit(n), strLit(v)] }, undefined, undefined, "exact"),
          ),
        },
        undefined,
        undefined,
        "exact",
      ),
    };
  }
  return abs(
    { k: "brand", name: "URLSearchParams", shape: objOf(slots) },
    undefined,
    undefined,
    entries !== undefined ? "exact" : "path",
  );
}

/**
 * 读取 URLSearchParams brand 的条目表（宿主无关的 [name, value] 字符串对）。
 * 缺席 = 条目表不可知（调用方按 unknown 口径）。
 */
export function urlSearchParamsEntriesOf(a: Abs): UrlSearchParamsEntry[] | undefined {
  if (a.shape.k !== "brand" || a.shape.name !== "URLSearchParams") return undefined;
  const inner = a.shape.shape;
  if (inner.shape.k !== "obj") return undefined;
  const slot = getSlot((inner.shape as { slots: Record<string, { value: Abs }> }).slots, URL_SEARCH_PARAMS_ENTRIES_SLOT);
  if (!slot) return undefined;
  const t = slot.value;
  if (t.shape.k !== "tuple") return undefined;
  const out: UrlSearchParamsEntry[] = [];
  for (const el of t.shape.elements) {
    if (el.shape.k !== "tuple" || el.shape.elements.length !== 2) return undefined;
    const n = litValue(el.shape.elements[0]!);
    const v = litValue(el.shape.elements[1]!);
    if (!n.ok || typeof n.value !== "string") return undefined;
    if (!v.ok || typeof v.value !== "string") return undefined;
    out.push([n.value, v.value]);
  }
  return out;
}

/**
 * Bug 322：URLSearchParams 的 `size` 访问器读（原生是 **getter**，非方法）——
 * 条目数；条目表不可知 ⇒ number 域（path）。
 */
export function urlSearchParamsSizeAbs(a: Abs): Abs {
  const entries = urlSearchParamsEntriesOf(a);
  if (entries === undefined) return abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  return abs(
    { k: "prim", type: "number" },
    { op: "lit", value: entries.length as never },
    undefined,
    "exact",
  );
}

/** 回写 URLSearchParams 条目表（set/append/delete 变更面） */
function urlSearchParamsSetEntries(a: Abs, entries: UrlSearchParamsEntry[]): void {
  if (a.shape.k !== "brand" || a.shape.name !== "URLSearchParams") return;
  const inner = a.shape.shape;
  if (inner.shape.k !== "obj") return;
  setSlot(
    (inner.shape as { slots: Record<string, { value: Abs }> }).slots,
    URL_SEARCH_PARAMS_ENTRIES_SLOT,
    {
      value: abs(
        {
          k: "tuple",
          elements: entries.map(
            ([n, v]) =>
              abs({ k: "tuple", elements: [strLit(n), strLit(v)] }, undefined, undefined, "exact"),
          ),
        },
        undefined,
        undefined,
        "exact",
      ),
    },
  );
}

/** 实参 ToString（URLSearchParams 的 name/value 强制字符串化） */
function urlSpArgString(a: Abs | undefined): string | undefined {
  if (!a) return undefined;
  const v = litValue(a);
  if (!v.ok) return undefined;
  if (typeof v.value === "string") return v.value;
  if (
    typeof v.value === "number" ||
    typeof v.value === "boolean" ||
    typeof v.value === "bigint"
  ) {
    return String(v.value);
  }
  return undefined; // null / undefined → 字符串 "null" / "undefined"（原生 ToString）
}

/**
 * Bug 322：URLSearchParams 品牌方法派发（条目表精确取值）。
 *
 * 原生语义（node v26 实测）：
 * - `get(name)` → 首个匹配值；**无匹配返 `null`**（不是 undefined）；
 * - `getAll(name)` → 全部匹配值数组（可为空）；
 * - `has(name)` → boolean；
 * - `size` → 条目数（**getter**，非方法）；
 * - `toString()` → 查询串（"a=1&b=2"）；
 * - `set(name, value)` → 删同名全部条目后追加一条；`append` → 追加；
 *   `delete(name)` → 删同名全部条目，返 boolean（是否删过）；
 * - `keys/values/entries` → 迭代器（条目表精确展开）。
 *
 * 条目表**不可知**（抽象 init / may 臂）⇒ 读面折 unknown（不假精确）；
 * 实参 ToString 不可判 ⇒ 同理。
 */
export function evalUrlSearchParamsMethod(
  method: string,
  recv: Abs,
  args: Abs[],
): Abs | undefined {
  const entries = urlSearchParamsEntriesOf(recv);
  switch (method) {
    case "get": {
      const name = urlSpArgString(args[0]);
      if (entries === undefined || name === undefined) return unknown;
      const hit = entries.find(([n]) => n === name);
      return hit ? strLit(hit[1]) : absLit(null);
    }
    case "getAll": {
      const name = urlSpArgString(args[0]);
      if (entries === undefined || name === undefined) return unknown;
      const vals = entries.filter(([n]) => n === name).map(([, v]) => strLit(v));
      return abs({ k: "tuple", elements: vals }, undefined, undefined, "exact");
    }
    case "has": {
      const name = urlSpArgString(args[0]);
      if (entries === undefined || name === undefined) return unknown;
      return boolLit(entries.some(([n]) => n === name));
    }
    case "size": {
      if (entries === undefined) return unknown;
      return numLit(entries.length);
    }
    case "toString": {
      if (entries === undefined) return unknown;
      return strLit(
        entries.map(([n, v]) => `${n}=${v}`).join("&"),
      );
    }
    case "set": {
      const name = urlSpArgString(args[0]);
      const value = urlSpArgString(args[1]);
      if (entries === undefined || name === undefined || value === undefined) return unknown;
      urlSearchParamsSetEntries(recv, [
        ...entries.filter(([n]) => n !== name),
        [name, value],
      ]);
      return undefAbs();
    }
    case "append": {
      const name = urlSpArgString(args[0]);
      const value = urlSpArgString(args[1]);
      if (entries === undefined || name === undefined || value === undefined) return unknown;
      urlSearchParamsSetEntries(recv, [...entries, [name, value]]);
      return undefAbs();
    }
    case "delete": {
      const name = urlSpArgString(args[0]);
      if (entries === undefined || name === undefined) return unknown;
      const kept = entries.filter(([n]) => n !== name);
      if (kept.length !== entries.length) urlSearchParamsSetEntries(recv, kept);
      // 原生 `URLSearchParams.prototype.delete(name)` 返 **undefined**
      // （WHATWG 规范：删除条目数不外露；node v26 实测确认——不是 boolean）
      return undefAbs();
    }
    case "sort": {
      if (entries === undefined) return unknown;
      urlSearchParamsSetEntries(
        recv,
        [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
      );
      return undefAbs();
    }
    case "keys":
    case "values":
    case "entries": {
      if (entries === undefined) return unknown;
      const els = entries.map(([n, v]) =>
        method === "entries"
          ? abs({ k: "tuple", elements: [strLit(n), strLit(v)] }, undefined, undefined, "exact")
          : method === "keys"
            ? strLit(n)
            : strLit(v),
      );
      return collectionIteratorAbs(els);
    }
    default:
      return undefined;
  }
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
  if (!init || isNullishLit(init)) return urlSearchParamsBrandAbs([]);
  if (isSymbolAbs(init)) throw new NudoThrow(errorTypeAbs("TypeError")); // ToString(symbol)
  const vR = litValue(init);
  // string/number/bool/bigint 字面量：ToString 后按查询串解析（恒不抛）——
  // 条目表可精确推出（native: new URLSearchParams("a=1") → 一条 ["a","1"]；
  // new URLSearchParams(42) → 一条 ["42",""]）。
  if (vR.ok) {
    const s = typeof vR.value === "string" ? vR.value : String(vR.value);
    return urlSearchParamsBrandAbs(parseQueryEntries(s));
  }
  if (init.shape.k === "tuple") {
    const entries: UrlSearchParamsEntry[] = [];
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
        // 两侧均为字符串字面量 ⇒ 条目表可精确推出
        const nv = litValue(el.shape.elements[0]);
        const vv = litValue(el.shape.elements[1]);
        if (nv.ok && typeof nv.value === "string" && vv.ok && typeof vv.value === "string") {
          entries.push([nv.value, vv.value]);
        }
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
    // 条目数与元素数一致 ⇒ 每个 pair 都是字符串字面量 ⇒ 表**完整**（exact）；
    // 否则（抽象 pair 元素）表不可知 ⇒ unknown。
    return urlSearchParamsBrandAbs(
      entries.length === init.shape.elements.length ? entries : undefined,
    );
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
    const entries: UrlSearchParamsEntry[] = [];
    let allLiteral = true;
    for (const key of Object.keys(init.shape.slots)) {
      noteBoxedCtorArg("String", init.shape.slots[key]!.value);
      const v = litValue(init.shape.slots[key]!.value);
      if (v.ok && typeof v.value === "string") entries.push([key, v.value]);
      else allLiteral = false;
    }
    return urlSearchParamsBrandAbs(allLiteral ? entries : undefined);
  }
  if (init.shape.k === "brand" && init.shape.name === "Map") {
    return urlSearchParamsBrandAbs(); // 条目恒二元组
  }
  // arr / Set brand / sum / any / unknown / 其余 brand → 保守 may TypeError
  recordMayThrow({ kind: "TypeError", cause: "URLSearchParams init may be invalid" });
  return urlSearchParamsBrandAbs();
}
