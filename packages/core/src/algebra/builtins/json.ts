/**
 * JSON.parse / JSON.stringify
 *
 * Invariants:
 * - **brand 折叠是递归的**（Bug 327）：内建 brand（Date / Map / Set / RegExp /
 *   Error 族 / TypedArray / 装箱 prim…）的 JSON 值域在**任意深度**折叠——
 *   顶层与对象/数组成员同款（此前白名单只对顶层接收者生效 ⇒ 嵌套 brand 一律
 *   落「may carry BigInt / circular / throwing toJSON」⇒ L1/L2 假红）。
 * - **total ≠ 精确**：值不可知但恒不抛的 brand（TypedArray 家族：元素值未
 *   建模）折 total（值域 partial），**不**折成 "{}"——那会造出自信的错值。
 * - bigint 元素家族（BigInt64Array / BigUint64Array）原生**定抛** TypeError
 *   ⇒ 不在 total 集（保持 may-throw 记账）。
 * - reviver（parse）与 replacer（stringify）**两侧口径对称**（Bug 298）：
 *   callable 回调**真执行**（副作用通道不丢），返回值域保守（unknown）。
 */
import type { Abs } from "../abs.ts";
import { abs, numLit, strLit, boolLit, unknown, litValue } from "../abs.ts";
import { getSlot, setSlot } from "../objects.ts";
import { undefAbs, applyCallbackAbs } from "../hof.ts";
import { defaultLeakBudget } from "../leak.ts";
import { getFnImpl } from "../abs-fn.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { isSymbolAbs } from "../symbol-id.ts";
import { classNameOfValue } from "../class-mark.ts";
import { pTrue } from "../pred.ts";
import { str, isBigintPrimAbs, mayCoerceThrowOperand, TYPED_ARRAY_ELEMENT } from "./shared.ts";
import { getPropFlags } from "./invariants.ts";
import { isMatchArrayView } from "./regexp.ts";
import { classInstanceInnerOf, classChainHasJsonUserFace } from "../exec/class-registry.ts";
import { readProperty } from "./object.ts";
import { accessorTable } from "../accessors.ts";
import { boxedPrimitiveValue } from "./error/boxed.ts";

const NOT_LITERAL = Symbol("nudo:not-literal");
/** value 模式下 fn/symbol 子树：JSON 值域省略（obj 槽跳过 / 数组槽 null） */
const OMIT = Symbol("nudo:json-omit");

/**
 * Bug 17：闭内建 brand 白名单——toJSON/ToPrimitive 原型面引擎已知（固定
 * 表、无用户 valueOf/@@toPrimitive）、无枚举自有属性、非循环 → 原生
 * JSON.stringify 恒 total。Proxy/用户 brand 不豁免（handler 用户面）。
 * 装箱 Number/String/Boolean 不在此列（经 [[PrimitiveValue]] 折 prim 后
 * 走通用通道，亦可 total）。
 */
const JSON_TOTAL_BRANDS = new Set([
  "RegExp",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
]);
const JSON_TOTAL_ERROR_BRANDS = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "EvalError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "AggregateError",
]);

/**
 * Bug 327：内建 brand 的 JSON 折叠三档。
 * - exact：JSON 值**精确可知**（可嵌入父对象/数组）——RegExp/Map/Set 族/
 *   Error 族 → {}；Date → toISOString 串（Invalid → null）；URL → href 串；
 *   装箱 Number/String/Boolean → [[PrimitiveValue]] 折 prim。
 * - total：恒不抛但**值不可知**——TypedArray 家族（整数索引属性对象的元素
 *   值未建模；BigInt64/BigUint64 除外，见 opaque）。
 * - opaque：不可折——用户 toJSON 面 / BigInt 元素家族（原生定抛 TypeError）。
 *
 * opts.plainObject：**replacer 路径**用（原生 SerializeJSONProperty 步骤 4
 * ——toJSON 步已在其前做过）⇒ Date/URL 不再折 ISO/href，而是按零可枚举
 * 自有属性折 {}（原生 SerializeJSONObject 的结果）。
 */
type JsonBrandFold = { k: "exact"; value: unknown } | { k: "total" } | { k: "opaque" };

/**
 * Bug 327：内建 brand 的 JSON 值域折叠（**单一事实源**——顶层接收者与
 * 对象/数组**成员**共用；此前白名单只喂顶层 ⇒ 嵌套 brand 一律走保守
 * may-throw 记账 ⇒ L1/L2 假红）。
 *
 * 原生事实（node 实测）：
 * - RegExp / Map / Set / WeakMap / WeakSet / ArrayBuffer 族 / DataView /
 *   Error 族 → "{}"（零可枚举自有属性、无 toJSON）；
 * - Date → toJSON ≡ toISOString（Invalid Date → null）；
 * - URL → toJSON ≡ href；
 * - 装箱 Number/String/Boolean → 拆箱后的原始值（原生序列化 prim）；
 * - TypedArray 家族 → 整数索引属性对象（元素值未建模 ⇒ 值域不可知，
 *   但**恒不抛**）；
 * - BigInt64Array / BigUint64Array → 元素是 bigint ⇒ 原生**定抛**
 *   TypeError（"Do not know how to serialize a BigInt"）。
 */
function jsonBrandFold(a: Abs, opts?: { plainObject?: boolean }): JsonBrandFold | undefined {
  if (a.shape.k !== "brand") return undefined;
  const name = (a.shape as { name: string }).name;
  const inner = (a.shape as { shape: Abs }).shape;
  // 用户在 brand 上挂过 toJSON 槽（$set 写入内层）→ 用户面，不折
  if (
    inner &&
    inner.shape.k === "obj" &&
    getSlot((inner.shape as { slots: Record<string, { value: Abs }> }).slots, "toJSON")
  ) {
    return { k: "opaque" };
  }
  if (name === "URL") {
    if (opts?.plainObject) return { k: "exact", value: {} }; // toJSON 步已做 → 普通对象
    const href =
      inner && inner.shape.k === "obj"
        ? getSlot((inner.shape as { slots: Record<string, { value: Abs }> }).slots, "href")?.value
        : undefined;
    const hv = href ? litValue(href) : undefined;
    if (hv?.ok && typeof hv.value === "string") return { k: "exact", value: hv.value };
    return { k: "total" }; // 抽象 href → ISO/href 串域，恒 total
  }
  if (name === "Date") {
    if (opts?.plainObject) return { k: "exact", value: {} }; // toJSON 步已做 → 普通对象
    const tv = (a.shape as { tv?: number }).tv;
    if (tv !== undefined) {
      // toJSON ≡ toISOString；Invalid Date（NaN）→ null
      if (Number.isNaN(tv)) return { k: "exact", value: null };
      try {
        return { k: "exact", value: new Date(tv).toISOString() };
      } catch {
        return { k: "opaque" }; // 越界 epoch → 原生 toISOString 抛 RangeError
      }
    }
    return { k: "total" }; // 无 epoch 槽：ISO 串域，恒 total
  }
  if (name === "String" || name === "Number" || name === "Boolean") {
    // 装箱 prim → [[PrimitiveValue]] 拆箱（原生序列化拆箱后的原始值）
    const pv = boxedPrimitiveValue(a);
    const v = pv ? litValue(pv) : undefined;
    if (v?.ok && v.value !== undefined) return { k: "exact", value: v.value };
    return { k: "total" }; // 抽象装箱值 → prim 值域，恒 total
  }
  if (JSON_TOTAL_BRANDS.has(name) || JSON_TOTAL_ERROR_BRANDS.has(name)) {
    return { k: "exact", value: {} };
  }
  // TypedArray 家族：表项**自有**取（裸 table[name] 会命中
  // Object.prototype.constructor / toString ⇒ 自信的错值）
  const taEl = Object.prototype.hasOwnProperty.call(TYPED_ARRAY_ELEMENT, name)
    ? TYPED_ARRAY_ELEMENT[name]
    : undefined;
  // TypedArray 家族：元素值未建模 ⇒ 值域不可知，但恒不抛（total）。
  // bigint 元素家族（BigInt64/BigUint64）原生定抛 TypeError ⇒ opaque。
  if (taEl === "number") return { k: "total" };
  if (taEl === "bigint") return { k: "opaque" };
  return { k: "opaque" };
}

/**
 * Bug 327：内建 brand 的 **toJSON 步**（原生 SerializeJSONProperty 步骤 2
 * ——toJSON **先于** replacer）。只有 Date / URL 有原生 toJSON（其余 brand
 * 无 ⇒ replacer 收到 brand 本体）；Date 的 toJSON ≡ toISOString（Invalid
 * Date → null）、URL 的 toJSON ≡ href。
 */
function jsonBrandToJsonAbs(a: Abs): Abs | undefined {
  if (a.shape.k !== "brand") return undefined;
  const name = (a.shape as { name: string }).name;
  const inner = (a.shape as { shape: Abs }).shape;
  if (name === "Date") {
    const tv = (a.shape as { tv?: number }).tv;
    if (tv === undefined) return undefined; // 抽象 epoch → 不可折
    if (Number.isNaN(tv)) return jsonValueToAbs(null);
    try {
      return strLit(new Date(tv).toISOString());
    } catch {
      return undefined; // 越界 epoch → 原生 toISOString 抛 RangeError（不折）
    }
  }
  if (name === "URL") {
    const href =
      inner && inner.shape.k === "obj"
        ? getSlot((inner.shape as { slots: Record<string, { value: Abs }> }).slots, "href")?.value
        : undefined;
    const hv = href ? litValue(href) : undefined;
    if (hv?.ok && typeof hv.value === "string") return strLit(hv.value);
    return undefined;
  }
  return undefined;
}

/**
 * Bug 17：闭内建 brand 的精确折叠（顶层接收者专用——值已是 JSON 文本）。
 * 成员位的 brand 走 absToJsonNative 的 brand 臂（折 JSON **值**，非文本）。
 * - RegExp/Map/Set 族/Error 族 → "{}"
 * - URL → '"' + href + '"'（URL.prototype.toJSON ≡ href，槽已携带）
 * - Date → toJSON ≡ toISOString（tv 槽精确折叠；Invalid → "null"）
 * 无折叠（用户 brand/未知名）→ undefined（调用方保持 may-throw 记账）。
 */
function foldJsonTotalBrand(a: Abs): Abs | undefined {
  const fold = jsonBrandFold(a);
  if (!fold) return undefined;
  if (fold.k === "opaque") return undefined;
  if (fold.k === "total") return str("path"); // 值不可知但恒 total：JSON 文本恒为串
  try {
    const s = JSON.stringify(fold.value);
    return s === undefined ? undefined : strLit(s);
  } catch {
    return undefined; // 防御：bigint 载荷 → 原生 TypeError（调用方记 may-throw）
  }
}

/**
 * Bug 20：NOT_LITERAL 臂形状准入——三由头（BigInt 成员 / 循环引用 /
 * 抛错 toJSON）对给定 shape 是否**均不可能**。与 absToJsonNative 的树
 * 结构对齐：fn/symbol 子树已折 OMIT（值域省略、不抛）→ 视为 total；
 * bigint prim 无 lit 项已在 absToJsonNative 定抛（不达此判定）；
 * 其余抽象 prim（number/string/boolean）、闭 obj 全 total 槽、arr
 * open obj/index 键、rest tuple、访问器
 * （getter 用户面）、非 lit toJSON 槽 → 不 total。环（$set 就地写槽的
 * 引用语义，`o.self = o` 产出真 Abs 环）→ 原生定抛 cyclic TypeError
 * → 不 total（Bug 20：seen 集防无限递归栈溢出，与 absToJsonNative
 * 同构）。
 */
function jsonStringifyTotal(a: Abs, seen: Set<object> = new Set()): boolean {
  const s = a.shape;
  if (a.term?.op === "lit") return true;
  if (s.k === "fn") return true; // OMIT（值域省略，不抛）
  if (s.k === "eff") return true; // Promise / 生成器对象 → "{}"，恒不抛
  if (s.k === "prim") {
    const t = (s as { type?: string }).type;
    return t !== "bigint" && t !== "symbol"; // symbol → OMIT；bigint 已定抛
  }
  if (s.k === "tuple") {
    if ((s as { rest?: Abs }).rest) return false;
    if (seen.has(a as object)) return false; // 环 → 原生定抛 cyclic TypeError
    seen.add(a as object);
    return s.elements.every((el) => jsonStringifyTotal(el, seen));
  }
  if (s.k === "arr") return jsonStringifyTotal((s as { element: Abs }).element, seen);
  if (s.k === "brand") {
    // Bug 327：内建 brand 的总性——精确可折（{} / ISO 串 / href / 拆箱 prim）
    // 与「值不可知但恒不抛」（TypedArray 家族）皆 total；用户 toJSON 面 /
    // bigint 元素家族（原生定抛）不 total。
    const fold = jsonBrandFold(a);
    return fold !== undefined && fold.k !== "opaque";
  }
  if (s.k === "obj") {
    // Bug「match/exec 结果 JSON 视图」：match/exec 结果按数组序列化——
    // total 性只看下标元素（侧槽不进枚举面）
    if (isMatchArrayView(a)) {
      const els = matchArrayViewElements(a);
      if (!els) return false;
      if (seen.has(a as object)) return false;
      seen.add(a as object);
      return els.every((el) => jsonStringifyTotal(el, seen));
    }
    const os = s as { open?: boolean; index?: unknown; slots: Record<string, { value: Abs }> };
    if (os.open || os.index) return false;
    if (accessorTable.get(a as object)) return false; // getter 用户面（Bug 57 同源）
    if (seen.has(a as object)) return false; // 环 → 原生定抛 cyclic TypeError
    seen.add(a as object);
    const flags = getPropFlags(a);
    for (const [k, sv] of Object.entries(os.slots)) {
      if (flags?.get(k)?.enumerable === false) continue;
      // Bug 84：internal 私有槽不进序列化（内部槽对 JSON 不可见）
      if ((sv as { internal?: boolean }).internal === true) continue;
      // Bug 73：symbol 键槽（投影 "@@X"）原生不序列化
      if ((sv as { symbolKey?: boolean }).symbolKey === true) continue;
      if (k === "toJSON" && sv.value.term?.op !== "lit") return false;
      if (!jsonStringifyTotal(sv.value, seen)) return false;
    }
    return true;
  }
  return false;
}

/**
 * stringifyObj 单层枚举键（absToJsonNative 对象臂与 callable replacer
 * 逐项桥接共用）：
 * - enumerable:false（defineProperty 描述符）→ JSON.stringify 跳过；
 * - internal 私有槽（Bug 84）——内部槽对序列化不可见；
 * - symbol 键槽（Bug 73，投影 "@@X" 带 Slot.symbolKey 标记）原生不
 *   序列化——标记来自投影期，字面量字符串键 "{@@lit:1}" 不受影响；
 * - toJSON 槽：callable（fn 形）/抽象 → 原生先调用再序列化其返回值，
 *   不可折（{toJSON(){return 'x'}} → "\"x\""）——返回 undefined（保守）；
 * - Bug 57：[[Get]] 语义——访问器属性经 accessorTable getter 求值
 *   （此前直接序列化占位数据槽 → 字面量 getter 键整个丢失、defineProperty
 *   getter 占位 unknown → 假 may-throw）。
 * open/index 键不可判 → undefined。
 */
function jsonEnumerableEntries(a: Abs): Array<[string, Abs]> | undefined {
  const s = a.shape;
  if (s.k !== "obj" || s.open || s.index) return undefined;
  const flags = getPropFlags(a);
  const out: Array<[string, Abs]> = [];
  for (const [k, sv] of Object.entries(s.slots as Record<string, { value: Abs }>)) {
    if (flags?.get(k)?.enumerable === false) continue;
    if ((sv as { internal?: boolean }).internal === true) continue;
    if ((sv as { symbolKey?: boolean }).symbolKey === true) continue;
    if (k === "toJSON" && sv.value.term?.op !== "lit") return undefined;
    out.push([k, readProperty(a, k)]);
  }
  return out;
}

/**
 * Bug「match/exec 结果 JSON 视图」：match/exec 结果（isMatchArrayView 标注
 * 的闭 obj）的下标元素序列——length 槽字面量定长，元素取 "0".."n-1" 槽。
 * 原生 RegExpExecArray 是 Array：SerializeJSONArray 只产下标元素（["b"]）
 * ——index/input/groups 虽可枚举但非数组下标、length 非枚举，均不进 JSON
 * 面。length 非字面量 / 槽缺 → undefined（调用方按不可折处理）。
 */
function matchArrayViewElements(a: Abs): Abs[] | undefined {
  const s = a.shape;
  if (s.k !== "obj") return undefined;
  const slots = s.slots as Record<string, { value: Abs }>;
  const lenA = slots["length"]?.value;
  const lenR = lenA ? litValue(lenA) : undefined;
  if (!lenR?.ok || typeof lenR.value !== "number") return undefined;
  const els: Abs[] = [];
  for (let i = 0; i < lenR.value; i++) {
    const el = slots[String(i)]?.value;
    if (!el) return undefined;
    els.push(el);
  }
  return els;
}

/**
 * Abs 字面量树 → JS 值（JSON.stringify 折叠输入）；非字面量子树不提取。
 * valueMode（序列化语义，Bug 46）：
 * - bigint prim（无 lit——BigInt(x)/运算产物）任何位置 → 原生定抛
 *   「Do not know how to serialize a BigInt」（与字面量宿主抛同面）；
 * - fn / symbol prim 子树 → OMIT（node 实测 stringify({a:Symbol()}) → "{}"、
 *   stringify([Symbol()]) → "[null]"——值域省略，不抛）。
 * extract 模式（replacer 白名单提取）：仅纯字面量折叠，symbol prim 键
 * ToString 定抛（原生 TypeError），其余非字面量 NOT_LITERAL。
 */
function absToJsonNative(
  a: Abs,
  seen: Set<object>,
  valueMode: boolean,
): unknown | typeof NOT_LITERAL | typeof OMIT {
  if (seen.has(a as object)) {
    // Bug 60：seen 现为「在栈」集（子树收尾出栈）——重入即真环
    // （$set 就地写槽的引用语义，`o.self = o` 产出真 Abs 环）。序列化
    // 语义下原生定抛「Converting circular structure to JSON」；extract
    // 模式（replacer 白名单提取）环不抛（原生 propertyList 展开自带
    // 去重）→ 保守 NOT_LITERAL
    if (valueMode) throw new NudoThrow(errorTypeAbs("TypeError"));
    return NOT_LITERAL;
  }
  const t = a.term;
  if (t?.op === "lit") return t.value; // 含 bigint/symbol/undefined/null
  const s = a.shape;
  if (s.k === "prim" && s.type === "symbol") {
    if (!valueMode) throw new NudoThrow(errorTypeAbs("TypeError"));
    return OMIT;
  }
  if (valueMode && isBigintPrimAbs(a)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (valueMode && s.k === "fn") return OMIT;
  if (s.k === "eff") {
    // Bug 327 顺带：Promise / 生成器**对象**（eff 形状）——原生既无自有
    // 可枚举属性也无 toJSON ⇒ JSON.stringify 恒得 "{}" 且**恒不抛**
    // （`JSON.stringify({p: Promise.resolve(1)})` → '{"p":{}}'）。此前 eff
    // 无臂 ⇒ 落 NOT_LITERAL ⇒ 父层记 may-throw ⇒ **L1/L2 假红**。
    // （内建 brand 臂只覆盖 brand 形状；Promise 是 eff 形状。）
    return {};
  }
  if (s.k === "brand") {
    // Bug 327：内建 brand 的 JSON 值（**成员位同款**——此前白名单只对顶层
    // 接收者生效 ⇒ 嵌套 brand 落 NOT_LITERAL ⇒ 父层 may-throw 假红）。
    // 精确可折 → 直接给 JSON 值；total 但值不可知（TypedArray 家族）→
    // NOT_LITERAL（父层按不可折处理；总性由 jsonStringifyTotal 判定 ⇒
    // 不记 may-throw）；opaque（用户 toJSON / bigint 元素）→ NOT_LITERAL
    // ⇒ 保守 may-throw 记账。
    const fold = jsonBrandFold(a);
    if (fold?.k === "exact") return fold.value;
    return NOT_LITERAL;
  }
  if (s.k === "tuple") {
    // rest 槽有 0..n 个未知额外元素：折叠固定位会产出缺尾数组（非字面量）
    if ((a.shape as { rest?: Abs }).rest) return NOT_LITERAL;
    seen.add(a as object);
    const holes = (a.shape as { holes?: number[] }).holes ?? [];
    const out: unknown[] = [];
    try {
      for (let i = 0; i < s.elements.length; i++) {
        // hole 与 undefined 元素提取同为 undefined——JSON.stringify 数组槽都输出 null
        if (holes.includes(i)) {
          out.push(undefined);
          continue;
        }
        const v = absToJsonNative(s.elements[i]!, seen, valueMode);
        if (v === NOT_LITERAL) return NOT_LITERAL;
        out.push(v === OMIT ? null : v);
      }
      return out;
    } finally {
      seen.delete(a as object);
    }
  }
  if (s.k === "obj" && isMatchArrayView(a)) {
    // Bug「match/exec 结果 JSON 视图」：match/exec 结果原生是 Array——按下标
    // 槽序列化（["b"]），index/input/groups 非数组下标、length 非枚举，均
    // 不进 JSON 面（undefined 元素经宿主 JSON.stringify 输出 null，与原生
    // 一致）
    const els = matchArrayViewElements(a);
    if (!els) return NOT_LITERAL;
    seen.add(a as object);
    try {
      const out: unknown[] = [];
      for (const el of els) {
        const v = absToJsonNative(el, seen, valueMode);
        if (v === NOT_LITERAL) return NOT_LITERAL;
        out.push(v === OMIT ? null : v);
      }
      return out;
    } finally {
      seen.delete(a as object);
    }
  }
  if (s.k === "obj") {
    const entries = jsonEnumerableEntries(a);
    if (!entries) return NOT_LITERAL;
    seen.add(a as object);
    try {
      const out: Record<string, unknown> = {};
      for (const [k, child] of entries) {
        const v = absToJsonNative(child, seen, valueMode);
        if (v === NOT_LITERAL) return NOT_LITERAL;
        if (v !== OMIT) out[k] = v;
      }
      return out;
    } finally {
      seen.delete(a as object);
    }
  }
  return NOT_LITERAL;
}

/** JS 值 → Abs（JSON.parse 字面量折叠；JSON 值域无 bigint/symbol/undefined/function） */
function jsonValueToAbs(v: unknown): Abs {
  if (v === null) return abs({ k: "unknown" }, { op: "lit", value: null }, pTrue, "exact");
  if (typeof v === "number") return numLit(v);
  if (typeof v === "string") return strLit(v);
  if (typeof v === "boolean") return boolLit(v);
  if (Array.isArray(v)) {
    return abs({ k: "tuple", elements: v.map(jsonValueToAbs) }, undefined, undefined, "exact");
  }
  const slots: Record<string, { value: Abs }> = Object.create(null);
  for (const [k, sv] of Object.entries(v as Record<string, unknown>)) {
    setSlot(slots, k, { value: jsonValueToAbs(sv) });
  }
  return abs({ k: "obj", slots }, undefined, undefined, "exact");
}

/**
 * 顶层非 JSON 值（function / symbol）：JSON.stringify 返回 undefined 值。
 * 嵌套 function/symbol 仍走 NOT_LITERAL→partial（可接受超集）。
 */
function isNonJsonTopLevel(a: Abs): boolean {
  if (a.shape.k === "fn") return true;
  if (a.shape.k === "prim" && a.shape.type === "symbol") return true;
  return false;
}

/** replacer 回调执行环境（methods.ts callbackEnv 同口径） */
function replacerEnv(): unknown {
  return { vars: new Map(), fns: new Map(), hofCollect: undefined };
}

/** space 实参折叠：number/string 原样；缺省/null/undefined → 紧凑；
 *  其余（非字面量/对象等）→ "partial" 哨兵（值域不可折） */
function foldJsonSpace(spaceArg: Abs | undefined): number | string | undefined | "partial" {
  if (!spaceArg) return undefined;
  const t = spaceArg.term;
  if (t?.op !== "lit") return "partial";
  const sv = t.value;
  if (typeof sv === "number" || typeof sv === "string") return sv;
  if (sv !== undefined && sv !== null) return "partial";
  return undefined;
}

/**
 * Bug 59：callable replacer 逐项桥接（原生 SerializeJSONProperty 语义：
 * 每个键——含根 ""——先调 replacer.call(holder, key, value)，再对返回值
 * 递归序列化）。逐层剥离（而非整树预提取）保证原生调用序：
 * - 抛错 replacer → NudoThrow 定抛传播（catch 可吸收）；
 * - replacer 返回值不可折（抽象）→ 值域 partial（注册 skip），其深层
 *   键的 replacer 调用不可见 → may-throw 记账（条件抛 replacer）；
 * - replacer 返回非 lit bigint prim / 环回值 → 原生定抛 TypeError
 *  （bigint 序列化抛 / Converting circular structure to JSON）；
 * - replacer 把（子）值变成 undefined → 键省略（数组槽 null）、变成
 *   fn/symbol → 键省略（数组槽 null）、根变 fn/symbol → 返回 undefined。
 */
function stringifyFnReplacer(
  root: Abs,
  rep: Abs,
  space: number | string | undefined,
): Abs {
  let partial = false;
  let unseen = false;
  // 序列化路径栈（原生 InternalJSONTrack 同构）：replacer 返回在栈祖先
  // → 环 → 定抛
  const path = new Set<object>();
  const walk = (key: string, val: Abs): { kind: "val" | "omit" | "nonlit"; v?: unknown } => {
    // Bug 327：内建 brand 的 **toJSON 步**（原生 SerializeJSONProperty 步骤 2
    // ——toJSON **先于** replacer）：Date → ISO 串、URL → href 串；其余 brand
    // 无原生 toJSON（replacer 收到 brand 本体）。
    const toJson = jsonBrandToJsonAbs(val);
    const r = applyCallbackAbs(
      rep,
      [strLit(key), toJson ?? val],
      replacerEnv(),
      pTrue,
      defaultLeakBudget,
    );
    if (path.has(r as object)) throw new NudoThrow(errorTypeAbs("TypeError"));
    const t = r.term;
    if (t?.op === "lit") return { kind: "val", v: t.value };
    const s = r.shape;
    if (s.k === "prim" && s.type === "symbol") return { kind: "omit" };
    if (isBigintPrimAbs(r)) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (s.k === "fn") return { kind: "omit" };
    if (s.k === "brand") {
      // Bug 327：replacer 结果是内建 brand → 原生 SerializeJSONProperty
      // 步骤 4（拆箱 / 普通对象序列化）：Map/Set 族/RegExp/Error 族/Date/URL
      // → 零可枚举自有属性 → {}；装箱 prim → 拆箱后的原始值；TypedArray
      // 家族 → 元素值未建模（值域不可知，深层键的 replacer 调用不可见
      // ⇒ unseen 记账）。
      const fold = jsonBrandFold(r, { plainObject: true });
      if (fold?.k === "exact") return { kind: "val", v: fold.value };
      partial = true;
      unseen = true;
      return { kind: "nonlit" };
    }
    if (s.k === "tuple") {
      if ((s as { rest?: Abs }).rest) {
        partial = true;
        unseen = true;
        return { kind: "nonlit" };
      }
      path.add(r as object);
      try {
        const holes = (s as { holes?: number[] }).holes ?? [];
        const out: unknown[] = [];
        for (let i = 0; i < s.elements.length; i++) {
          if (holes.includes(i)) {
            out.push(null);
            continue;
          }
          const c = walk(String(i), s.elements[i]!);
          // 抽象子值折 null 是占位——结果不可折精确（partial）
          if (c.kind !== "val" || c.v === undefined) {
            if (c.kind === "nonlit") {
              partial = true;
              unseen = true;
            }
            out.push(null);
          } else {
            out.push(c.v);
          }
        }
        return { kind: "val", v: out };
      } finally {
        path.delete(r as object);
      }
    }
    if (s.k === "obj" && isMatchArrayView(r)) {
      // Bug「match/exec 结果 JSON 视图」：replacer 逐项桥接按下标键走数组
      // 形（原生数组键序 ""→"0".."n-1"，非枚举侧槽不可见）
      const els = matchArrayViewElements(r);
      if (!els) {
        partial = true;
        unseen = true;
        return { kind: "nonlit" };
      }
      path.add(r as object);
      try {
        const out: unknown[] = [];
        for (let i = 0; i < els.length; i++) {
          const c = walk(String(i), els[i]!);
          if (c.kind !== "val" || c.v === undefined) {
            if (c.kind === "nonlit") {
              partial = true;
              unseen = true;
            }
            out.push(null);
          } else {
            out.push(c.v);
          }
        }
        return { kind: "val", v: out };
      } finally {
        path.delete(r as object);
      }
    }
    if (s.k === "obj") {
      const entries = jsonEnumerableEntries(r);
      if (!entries) {
        partial = true;
        unseen = true;
        return { kind: "nonlit" };
      }
      path.add(r as object);
      try {
        const out: Record<string, unknown> = {};
        for (const [k2, child] of entries) {
          const c = walk(k2, child);
          if (c.kind === "val" && c.v !== undefined) out[k2] = c.v;
          else if (c.kind === "nonlit") {
            // 抽象子值省略键是占位——结果不可折精确（partial）
            partial = true;
            unseen = true;
          }
        }
        return { kind: "val", v: out };
      } finally {
        path.delete(r as object);
      }
    }
    partial = true;
    unseen = true;
    return { kind: "nonlit" };
  };
  const r0 = walk("", root);
  if (unseen) {
    recordMayThrow({
      kind: "Error",
      cause: "JSON.stringify replacer may throw on entries beyond abstract values",
    });
  }
  if (r0.kind === "omit") return undefAbs();
  if (r0.kind === "nonlit" || partial) return str("partial");
  try {
    const s = JSON.stringify(r0.v, undefined, space);
    return s === undefined ? undefAbs() : strLit(s);
  } catch {
    // bigint 字面量载荷 / 防御 → 原生 TypeError
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
}

/**
 * Bug 298：JSON.parse 的 **callable reviver 逐键执行**（原生
 * InternalizeJSONProperty 语义）。
 *
 * 原生步骤（ES2023 §25.5.1 InternalizeJSONProperty）：
 * - 深度优先**后序**：先对每个子键递归（各调一次 reviver），再对本键调；
 * - 根键 "" 也调一次 ⇒ 调用次数 = JSON 结构节点数（`[1,2]` → 3 次）；
 * - reviver 返回 undefined → 该键被删除（数组槽留洞）；
 * - holder = 根对象（reviver 的 this 恒为它——原生 `typeof this ===
 *   "object"`）。
 *
 * 修前：reviver **一次都不执行** ⇒ 回调副作用（计数器 / 累加串 / 捕获变量
 * 写）整体丢失，捕获变量保留**确定旧值**（引擎内部不对称：同文件的
 * stringify replacer 却真执行）。
 *
 * 本函数只恢复**副作用通道**（调用次数 / 捕获变量的写 / this 绑定）；
 * parse 的**值域**仍保守 unknown（逐键变换未建模——既有回归
 * eval-json.test.ts「reviver arg stays conservative」与
 * eval-object-json-w9.test.ts「callable reviver degrades to unknown」钉此
 * 口径，见报告的「或至少」分支）。
 */
function runJsonReviver(root: unknown, rev: Abs): void {
  // holder（原生是包着根值的对象）——reviver 的 this 恒为它
  const holder = abs({ k: "obj", slots: Object.create(null) }, undefined, undefined, "exact");
  const walk = (key: string, val: unknown): unknown => {
    // 子键先（后序）——原生对每个自有可枚举键递归
    if (val !== null && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        const nv = walk(k, obj[k]);
        if (nv === undefined) delete obj[k];
        else obj[k] = nv;
      }
    }
    const r = applyCallbackAbs(
      rev,
      [strLit(key), jsonValueToAbs(val)],
      replacerEnv(),
      pTrue,
      defaultLeakBudget,
      holder,
    );
    const lv = litValue(r);
    // 不可折的返回值 → 保留原值（值域本就保守，不参与建模）
    return lv.ok ? lv.value : val;
  };
  walk("", root);
}

/** JSON.parse / stringify：字面量实参真执行折叠；失败硬抛（catch 可吸收） */
export function evalJsonMethod(name: string, args: Abs[]): Abs | undefined {
  if (name === "parse") {
    // 无实参 ≡ 实参 undefined：原生 ToString(undefined)="undefined" → SyntaxError
    const a0Abs = args[0];
    if (!a0Abs) throw new NudoThrow(errorTypeAbs("SyntaxError"));
    // Bug 40：ToString 强转先于解析——shape 先于 lit 判定，symbol prim
    //（无 lit 项，Symbol() 产物）定抛「Cannot convert a Symbol value to a
    // string」（原检查困在 lit 分支内是死代码）
    if (isSymbolAbs(a0Abs)) throw new NudoThrow(errorTypeAbs("TypeError"));
    // Bug 48（node v26 实测校正）：reviver 形态面原生**不抛**——非 callable
    // reviver 直接忽略（parse("{}",1) → {}，「reviver must be callable」不
    // 存在）；nullish ≡ 缺省。callable reviver 的逐键变换不建模 → 值域保守
    // unknown（非 throws 面）。判定「确定不可调用」：prim / tuple / never /
    // 闭 obj；fn / any / unknown / sum / brand / eff / open obj → 保守视为
    // 可能变换
    const rev = args[1];
    const revNullish =
      !!rev && rev.term?.op === "lit" && (rev.term.value === null || rev.term.value === undefined);
    const revTransforms =
      !!rev &&
      !revNullish &&
      !(
        rev.shape.k === "prim" ||
        rev.shape.k === "tuple" ||
        rev.shape.k === "never" ||
        (rev.shape.k === "obj" &&
          getFnImpl(rev) === undefined &&
          (rev.shape as { open?: boolean }).open !== true)
      );
    const t = a0Abs.term;
    if (t?.op !== "lit") {
      // Bug 40：抽象文本 may ToString 抛（obj/fn/brand/sum/any——toJSON /
      // toString 用户面；prim 非符号与 tuple/arr 原生全定）
      if (mayCoerceThrowOperand(a0Abs)) {
        recordMayThrow({ kind: "TypeError", cause: "JSON.parse text ToString may throw" });
      }
      return unknown; // 抽象实参：保守
    }
    const v = t.value;
    if (v === undefined) throw new NudoThrow(errorTypeAbs("SyntaxError"));
    // 原生先 ToString：number/boolean/bigint/null 都走字符串解析
    const src =
      typeof v === "string"
        ? v
        : typeof v === "number" || typeof v === "boolean" || typeof v === "bigint"
          ? String(v)
          : v === null
            ? "null"
            : undefined;
    if (src === undefined) return unknown;
    // 原生步骤序：parse（SyntaxError）**先于**一切 reviver 行为
    let rawValue: unknown;
    try {
      rawValue = JSON.parse(src);
    } catch {
      throw new NudoThrow(errorTypeAbs("SyntaxError"));
    }
    // Bug 298：确定可调用的 reviver（fn 形）**真执行**——原生逐键调用，
    // 回调副作用（计数器 / 累加串 / 捕获变量写 / this 绑定）不再整体丢失
    // （修前 reviver 一次都不跑 ⇒ 捕获变量保留确定旧值）。reviver 抛错 →
    // 原生传播（**不**转成 SyntaxError——解析已成功）。
    if (rev && rev.shape.k === "fn") {
      runJsonReviver(rawValue, rev);
      // 值域仍保守 unknown（逐键变换未建模——见 runJsonReviver 头注）
      return unknown;
    }
    // 非 callable reviver 原生忽略——保留折叠结果；抽象 reviver（any /
    // unknown / sum / brand / eff / open obj）可能可调用 → 保守 unknown
    const parsed = jsonValueToAbs(rawValue);
    return revTransforms ? unknown : parsed;
  }
  if (name === "stringify") {
    // 顶层 undefined / function / symbol → 原生返回 undefined 值（非字符串）
    const a0Abs = args[0];
    if (!a0Abs) return undefAbs();
    // Bug 84：用户类实例 brand → 内层闭 obj 的公有自有槽（私有 Slot.internal
    // 与 enumerable:false 剔除——原生私有字段不进 JSON）。类链带 toJSON /
    // 实例访问器用户面时不可折（原生先调用），保持既有保守 partial。
    let jsonArg = a0Abs;
    {
      const inner = classInstanceInnerOf(a0Abs);
      const brandName = a0Abs.shape.k === "brand" ? a0Abs.shape.name : undefined;
      if (inner && brandName !== undefined && !classChainHasJsonUserFace(brandName)) {
        jsonArg = inner;
      }
    }
    // Bug 59：callable replacer（fn 形）——原生对每个键（含根 ""）先调
    // replacer 再序列化其返回值；预提取（absToJsonNative）会先于 replacer
    // 撞 bigint/环面 → 直接走逐项桥接（replacer 可把二者变换掉）
    const fnRep = args[1] && args[1].shape.k === "fn" ? args[1] : undefined;
    if (fnRep) {
      const space = foldJsonSpace(args[2]);
      // space 先于序列化处理（原生步骤序）：抽象 space may ToString 抛，
      // 即使 replacer 不抛——不得静默 no-throw
      if (space === "partial") {
        recordMayThrow({ kind: "TypeError", cause: "JSON.stringify space ToString may throw" });
      }
      return stringifyFnReplacer(jsonArg, fnRep, space === "partial" ? undefined : space);
    }
    const v = absToJsonNative(jsonArg, new Set(), true);
    if (v === NOT_LITERAL || v === OMIT) {
      // 顶层 function/symbol：JSON.stringify 返回 undefined，不是 string
      if (isNonJsonTopLevel(a0Abs)) return undefAbs();
      // Bug 46：抽象/开放面（any/unknown/open obj/rest tuple/brand…）原生
      // may 抛（BigInt 成员 / 循环引用 / toJSON 用户面）——仅补 throws
      // 效果，partial 值域不变；symbol/fn 载体成员原生**省略不抛**
      //（node 实测 stringify({a:Symbol()}) → "{}"），已折 OMIT 不在此臂
      if (v === NOT_LITERAL) {
        // Bug 17：闭内建 brand（toJSON/ToPrimitive 全定、零枚举自有属性、
        // 非循环）→ 恒 total，可精确折叠（RegExp/Map/Set/Error 族 → "{}"、
        // URL → href、Date → ISO 串）
        const folded = foldJsonTotalBrand(a0Abs);
        if (folded) return folded;
        // Bug 20：闭 obj 全 prim 槽 / arr non-bigint 元素——三由头均不可能
        // → 不记 may-throw（值域仍 partial，不伪装精确）
        if (jsonStringifyTotal(a0Abs)) return str("partial");
        recordMayThrow({
          kind: "TypeError",
          cause: "JSON.stringify receiver may carry BigInt / circular / throwing toJSON",
        });
      }
      return str("partial");
    }
    // replacer：数组字面量 → 白名单键；null/非数组非函数 → 原生忽略；
    // 函数 replacer / 抽象 → 保守（结果串不可判定）。extract 模式提取
    //（Bug 46：bigint/symbol prim replacer 原生忽略/键 ToString 抛，
    //  不走 value 模式的 bigint 定抛）
    const replacerArg = args[1];
    let replacer: (string | number)[] | undefined;
    if (replacerArg) {
      const rv = absToJsonNative(replacerArg, new Set(), false);
      if (rv === NOT_LITERAL || rv === OMIT) {
        // Bug 59：NOT_LITERAL 的 replacer 可能 callable（any/unknown/sum/
        // host fn 字面量载荷）——原生逐键调用，may 抛；确定非 callable
        // （prim/tuple/never/闭 obj）不抛
        //
        // Bug 327 顺带：**brand 实例**（new Map() / new Date() / 用户类实例）
        // 与 **eff**（Promise / 生成器对象）都**不可调用** ⇒ 原生
        // SerializeJSONProperty 步骤 1「IsCallable(replacer)」为假 ⇒
        // replacer 被**忽略** ⇒ 恒不抛。此前 brand/eff 一律记 may-throw ⇒
        // **L1/L2 假红**（原生 `JSON.stringify({a:1}, new Map())` 无错）。
        // brand 里**只有构造器**（class 值，markClassValue 标记）可调用
        // （原生 `JSON.stringify({a:1}, Map)` 会逐键调 Map）⇒ 保留 may-throw。
        const brandCallable =
          replacerArg.shape.k === "brand" &&
          classNameOfValue(replacerArg as object) !== undefined;
        if (
          replacerArg.shape.k === "any" ||
          replacerArg.shape.k === "unknown" ||
          replacerArg.shape.k === "sum" ||
          brandCallable ||
          (replacerArg.shape.k === "obj" && (replacerArg.shape as { open?: boolean }).open === true)
        ) {
          recordMayThrow({
            kind: "Error",
            cause: "JSON.stringify replacer may be callable and throw",
          });
        }
        return str("partial");
      }
      if (Array.isArray(rv)) {
        replacer = rv.filter(
          (x): x is string | number => typeof x === "string" || typeof x === "number",
        );
      } else if (typeof rv === "function") {
        // 宿主 fn 字面量载荷：原生逐键调用（may 抛），不建模调用面
        recordMayThrow({ kind: "Error", cause: "JSON.stringify host-fn replacer may throw" });
        return str("partial");
      }
      // 其余（null/prim/对象）：原生忽略 replacer，照常序列化
    }
    // space：number/string 原样交给宿主 JSON.stringify（其内部即规范
    // min(10, ToIntegerOrInfinity(space)) + 「原 space>0 即使 <1 也 pretty」）；
    // 预折 isFinite/floor 会把 Infinity 折成 0、(0,1) 折成紧凑——同族漏网。
    // 缺省/null/undefined → 紧凑。其余非字面量 → 保守
    const space = foldJsonSpace(args[2]);
    if (space === "partial") return str("partial");
    try {
      const s = JSON.stringify(v, replacer, space);
      return s === undefined ? undefAbs() : strLit(s);
    } catch {
      // bigint / 循环引用（防御）→ 原生 TypeError
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  return undefined;
}
