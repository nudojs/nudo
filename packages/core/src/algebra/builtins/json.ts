/**
 * JSON.parse / JSON.stringify
 */
import type { Abs } from "../abs.ts";
import { abs, numLit, strLit, boolLit, unknown, litValue } from "../abs.ts";
import { getSlot, setSlot } from "../objects.ts";
import { undefAbs } from "../hof.ts";
import { getFnImpl } from "../abs-fn.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { isSymbolAbs } from "../symbol-id.ts";
import { pTrue } from "../pred.ts";
import { str, isBigintPrimAbs, mayCoerceThrowOperand } from "./shared.ts";
import { getPropFlags } from "./invariants.ts";
import { readProperty } from "./object.ts";
import { accessorTable } from "../exec/runtime/members.ts";

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
 * Bug 17：闭内建 brand 的精确折叠。原生值：
 * - RegExp/Map/Set/WeakMap/WeakSet/ArrayBuffer 族/DataView/Error 族 →
 *   "{}"（零可枚举自有属性、无 toJSON）
 * - URL → '"' + href + '"'（URL.prototype.toJSON ≡ href，槽已携带）
 * - Date → toJSON ≡ toISOString（tv 槽精确折叠；Invalid → "null"）
 * 无折叠（用户 brand/未知名）→ undefined（调用方保持 may-throw 记账）。
 */
function foldJsonTotalBrand(a: Abs): Abs | undefined {
  if (a.shape.k !== "brand") return undefined;
  const name = (a.shape as { name: string }).name;
  const inner = (a.shape as { shape: Abs }).shape;
  // 用户在 brand 上挂过 toJSON 槽（$set 写入内层）→ 用户面，不折
  if (
    inner &&
    inner.shape.k === "obj" &&
    getSlot((inner.shape as { slots: Record<string, { value: Abs }> }).slots, "toJSON")
  ) {
    return undefined;
  }
  if (name === "URL") {
    const href =
      inner && inner.shape.k === "obj"
        ? getSlot((inner.shape as { slots: Record<string, { value: Abs }> }).slots, "href")?.value
        : undefined;
    const hv = href ? litValue(href) : undefined;
    if (hv?.ok && typeof hv.value === "string") return strLit(JSON.stringify(hv.value));
    return str("path"); // 抽象输入：href 域 string，恒 total
  }
  if (name === "Date") {
    const tv = (a.shape as { tv?: number }).tv;
    if (tv !== undefined) {
      // toJSON ≡ toISOString；Invalid Date（NaN）→ null
      return Number.isNaN(tv) ? strLit("null") : strLit(JSON.stringify(new Date(tv).toISOString()));
    }
    return str("path"); // 无 epoch 槽：ISO 串域，恒 total
  }
  if (JSON_TOTAL_BRANDS.has(name) || JSON_TOTAL_ERROR_BRANDS.has(name)) {
    return strLit("{}");
  }
  return undefined;
}

/**
 * Bug 20：NOT_LITERAL 臂形状准入——三由头（BigInt 成员 / 循环引用 /
 * 抛错 toJSON）对给定 shape 是否**均不可能**。与 absToJsonNative 的树
 * 结构对齐：fn/symbol 子树已折 OMIT（值域省略、不抛）→ 视为 total；
 * bigint prim 无 lit 项已在 absToJsonNative 定抛（不达此判定）；
 * 其余抽象 prim（number/string/boolean）、闭 obj 全 total 槽、arr
 * non-bigint 元素 → total。open obj/index 键、rest tuple、访问器
 * （getter 用户面）、非 lit toJSON 槽 → 不 total。
 */
function jsonStringifyTotal(a: Abs): boolean {
  const s = a.shape;
  if (a.term?.op === "lit") return true;
  if (s.k === "fn") return true; // OMIT（值域省略，不抛）
  if (s.k === "prim") {
    const t = (s as { type?: string }).type;
    return t !== "bigint" && t !== "symbol"; // symbol → OMIT；bigint 已定抛
  }
  if (s.k === "tuple") {
    if ((s as { rest?: Abs }).rest) return false;
    return s.elements.every(jsonStringifyTotal);
  }
  if (s.k === "arr") return jsonStringifyTotal((s as { element: Abs }).element);
  if (s.k === "obj") {
    const os = s as { open?: boolean; index?: unknown; slots: Record<string, { value: Abs }> };
    if (os.open || os.index) return false;
    if (accessorTable.get(a as object)) return false; // getter 用户面（Bug 57 同源）
    const flags = getPropFlags(a);
    for (const [k, sv] of Object.entries(os.slots)) {
      if (flags?.get(k)?.enumerable === false) continue;
      if (k === "toJSON" && sv.value.term?.op !== "lit") return false;
      if (!jsonStringifyTotal(sv.value)) return false;
    }
    return true;
  }
  return false;
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
  if (seen.has(a as object)) return NOT_LITERAL; // 防御自引用（Abs 树理论无环）
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
  if (s.k === "tuple") {
    // rest 槽有 0..n 个未知额外元素：折叠固定位会产出缺尾数组（非字面量）
    if ((a.shape as { rest?: Abs }).rest) return NOT_LITERAL;
    seen.add(a as object);
    const holes = (a.shape as { holes?: number[] }).holes ?? [];
    const out: unknown[] = [];
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
  }
  if (s.k === "obj") {
    // open/带 index 的对象有未知键：序列化结果不确定
    if (s.open || s.index) return NOT_LITERAL;
    seen.add(a as object);
    const out: Record<string, unknown> = {};
    const flags = getPropFlags(a);
    for (const [k, sv] of Object.entries(s.slots as Record<string, { value: Abs }>)) {
      // enumerable:false（defineProperty 描述符）→ JSON.stringify 跳过
      if (flags?.get(k)?.enumerable === false) continue;
      // toJSON 槽：callable（fn 形）/抽象 → 原生先调用再序列化其返回值，
      // 不可折（{toJSON(){return 'x'}} → "\"x\""，非省略）——保守 NOT_LITERAL
      if (k === "toJSON") {
        const ts = sv.value;
        if (ts.term?.op !== "lit") return NOT_LITERAL;
      }
      // Bug 57：[[Get]] 语义——访问器属性经 accessorTable getter 求值
      //（此前直接序列化占位数据槽 → 字面量 getter 键整个丢失、defineProperty
      // getter 占位 unknown → 假 may-throw）
      const v = absToJsonNative(readProperty(a, k), seen, valueMode);
      if (v === NOT_LITERAL) return NOT_LITERAL;
      if (v !== OMIT) out[k] = v;
    }
    return out;
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
    try {
      const parsed = jsonValueToAbs(JSON.parse(src));
      // 解析成功后 reviver 才参与（原生步骤序：parse SyntaxError 先于一切
      // reviver 行为）；非 callable reviver 原生忽略——保留折叠结果
      return revTransforms ? unknown : parsed;
    } catch {
      throw new NudoThrow(errorTypeAbs("SyntaxError"));
    }
  }
  if (name === "stringify") {
    // 顶层 undefined / function / symbol → 原生返回 undefined 值（非字符串）
    const a0Abs = args[0];
    if (!a0Abs) return undefAbs();
    const v = absToJsonNative(a0Abs, new Set(), true);
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
      if (rv === NOT_LITERAL || rv === OMIT) return str("partial");
      if (Array.isArray(rv)) {
        replacer = rv.filter(
          (x): x is string | number => typeof x === "string" || typeof x === "number",
        );
      } else if (typeof rv === "function") {
        return str("partial");
      }
      // 其余（null/prim/对象）：原生忽略 replacer，照常序列化
    }
    // space：number/string 原样交给宿主 JSON.stringify（其内部即规范
    // min(10, ToIntegerOrInfinity(space)) + 「原 space>0 即使 <1 也 pretty」）；
    // 预折 isFinite/floor 会把 Infinity 折成 0、(0,1) 折成紧凑——同族漏网。
    // 缺省/null/undefined → 紧凑。其余非字面量 → 保守
    const spaceArg = args[2];
    let space: number | string | undefined;
    if (spaceArg) {
      const t = spaceArg.term;
      if (t?.op !== "lit") return str("partial");
      const sv = t.value;
      if (typeof sv === "number" || typeof sv === "string") {
        space = sv;
      } else if (sv !== undefined && sv !== null) {
        return str("partial");
      }
    }
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
