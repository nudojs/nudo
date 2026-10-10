/**
 * Error 家族 + evalBuiltinNew / evalBuiltinInstanceMethod + namespace 分派
 */
import type { Abs } from "../abs.ts";
import { abs, strLit, numLit, litValue, bigintLit, boolLit, unknown, confJoin } from "../abs.ts";
import { objOf, getSlot, setSlot, joinAbs } from "../objects.ts";
import {
  makeMapAbs,
  makeSetAbs,
  mapGetEntry,
  mapHasEntry,
  mapSetEntry,
  mapDeleteEntry,
  mapClearEntries,
  mapSizeAbs,
  mapEntriesAbs,
  mapValuesAbs,
  setAddEntry,
  setHasEntry,
  setDeleteEntry,
  setClearEntries,
  setSizeAbs,
  setElementsAbs,
  setMethodFold,
  isSetAbs,
  isMapAbs,
  ctorArgDefinitelyInvalid,
  makeWeakCollectionAbs,
  // Bug 8/43：CanBeHeldWeakly 分类自本文件移入 collections.ts（单一口径）
  classifyCanBeHeldWeakly,
} from "../collections.ts";
import { undefAbs, validateCallableArg, applyCallbackValue } from "../hof.ts";
import { pTrue } from "../pred.ts";
import { defaultLeakBudget } from "../leak.ts";
import { emptyEnv } from "../ast-env.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { registerGenElements } from "../exec/match-iter.ts";
import { absFunction } from "../abs-fn.ts";
import { setPropFlags } from "./invariants.ts";
import { isSymbolAbs, evalSymbolStatic } from "./symbol.ts";
import { str, numPrim, boolPrim, noBody, mayCoerceThrowOperand, isBigintPrimAbs, typedArrayElementOf } from "./shared.ts";
import { evalMathMethod } from "./math.ts";
import { evalObjectMethod, foldGroupBy } from "./object.ts";
import { evalJsonMethod } from "./json.ts";
import { evalNumberStatic } from "./number.ts";
import { evalStringStatic } from "./string.ts";
import { evalArrayStatic, makeArrayCtorAbs } from "./array.ts";
import { evalDateCtor, evalDateStatic, evalDateMethod } from "./date.ts";
import { evalRegExpCtor, evalRegExpMethod } from "./regexp.ts";
import { evalPromiseCtor, evalPromiseStatic, enforceIterableStaticArg } from "./promise.ts";
import { evalReflectMethod } from "./reflect.ts";

export function evalNamespaceCall(
  ns: string,
  method: string,
  args: Abs[],
): Abs | undefined {
  switch (ns) {
    case "Math":
      return evalMathMethod(method, args);
    case "Object":
      return evalObjectMethod(method, args);
    case "JSON":
      return evalJsonMethod(method, args);
    case "Number":
      return evalNumberStatic(method, args);
    case "String":
      return evalStringStatic(method, args);
    case "Array":
      return evalArrayStatic(method, args);
    case "Date":
      return evalDateStatic(method, args);
    case "Promise":
      return evalPromiseStatic(method, args);
    case "BigInt":
      return evalBigIntStatic(method, args);
    case "Reflect":
      // Bug 19：Reflect.* 静态（严格 IsObject / apply·construct 校验）
      return evalReflectMethod(method, args);
    case "Symbol":
      // Bug 43：Symbol.for / Symbol.keyFor（全局注册表）
      return evalSymbolStatic(method, args);
    case "URL":
      // Bug 24：URL 静态面（canParse）
      return evalUrlStatic(method, args);
    case "Map":
      // Bug 26：Map.groupBy（ES2024）—— Map 入 NAMESPACE_GLOBALS 后成员
      // 读经 $get 命中 ns 分派，此前无 case → 折 unknown（无校验/无投影）
      return evalMapStatic(method, args);
    case "Intl":
      // Bug 44：NumberFormat/DateTimeFormat 调用面（new 省略形 ≡ new，
      // 宿主接收者经 $invoke→ns 分派到此处）——与 evalBuiltinNew 同 builder
      if (method === "NumberFormat" || method === "DateTimeFormat") {
        return makeIntlFormatAbs(method, args[0]);
      }
      return undefined;
    default:
      // Bug 27：TypedArray 家族静态面（from/of，TYPED_ARRAY_ELEMENT 表驱动；
      // 非家族名/未建模方法 → undefined 走通用回退）
      return evalTypedArrayStatic(ns, method, args);
  }
}

/**
 * Bug 26：Map.groupBy（ES2024）—— Map 命名空间静态。校验与分组折叠与
 * Object.groupBy 同形（foldGroupBy，键模式 "map"：原始键 SameValueZero 字面量
 * 合并，不 ToPropertyKey）。结果 Map brand：字面量键装 litKey 表；键不可判
 * 组并入 shadow（get 未知键 → 元素域数组 join undefined，诚实保守）。
 */
function evalMapStatic(method: string, args: Abs[]): Abs | undefined {
  if (method !== "groupBy") return undefined;
  const fold = foldGroupBy(args[0], args[1], "Map.groupBy", "map");
  const entries: Abs[] = [];
  const valueTuple = (values: Abs[]): Abs => {
    let vc: Abs["conf"] = "exact";
    for (const v of values) vc = confJoin(vc, v.conf);
    return abs({ k: "tuple", elements: values }, undefined, undefined, vc);
  };
  if (fold.status === "unknown") {
    // items 不可判：条目域未知 → shadow 值 unknown 元素数组
    entries.push(
      abs(
        { k: "tuple", elements: [unknown, abs({ k: "arr", element: unknown }, undefined, undefined, "partial")] },
        undefined,
        undefined,
        "partial",
      ),
    );
  } else {
    for (const g of fold.groups) {
      const vt = valueTuple(g.values);
      entries.push(
        abs(
          { k: "tuple", elements: [g.key, vt] },
          undefined,
          undefined,
          confJoin(g.key.conf, vt.conf),
        ),
      );
    }
    if (fold.open) {
      // 键不可判组：元素可归入任意组 → shadow 值 = 元素域数组
      const domain = fold.unkeyed.reduce((x, y) => joinAbs(x, y));
      entries.push(
        abs(
          { k: "tuple", elements: [unknown, abs({ k: "arr", element: domain }, undefined, undefined, "partial")] },
          undefined,
          undefined,
          "partial",
        ),
      );
    }
  }
  return makeMapAbs(abs({ k: "tuple", elements: entries }, undefined, undefined, "partial"));
}

/**
 * Bug 24：URL.canParse(url, base?) —— 解析恒 total（Invalid → false 非抛，
 * 与 new URL 的定抛面正交）。字面量 string（base 缺省/同为字面量）→ 宿主
 * 真解析折精确 boolean；symbol → ToString 定抛；抽象 prim string →
 * boolean；对象/any 载体 → may TypeError + boolean。
 */
function evalUrlStatic(method: string, args: Abs[]): Abs | undefined {
  if (method !== "canParse") return undefined;
  const url = args[0];
  const base = args[1];
  if (url && isSymbolAbs(url)) throw new NudoThrow(errorTypeAbs("TypeError"));
  if (base && isSymbolAbs(base)) throw new NudoThrow(errorTypeAbs("TypeError"));
  const uR = url ? litValue(url) : undefined;
  const u = uR?.ok ? uR.value : undefined;
  const bR = base ? litValue(base) : undefined;
  const b = bR?.ok ? bR.value : undefined;
  const baseFoldable =
    base === undefined ||
    (base.term?.op === "lit" && base.term.value === undefined) ||
    typeof b === "string";
  const argsAbstract =
    (!!url && url.term?.op !== "lit") || (!!base && base.term?.op !== "lit" && baseFoldable);
  if (argsAbstract) {
    // 抽象 prim（string/number/…）ToString total；obj/fn/any/sum 载体 may
    if (mayCoerceThrowOperand(url) || mayCoerceThrowOperand(base)) {
      recordMayThrow({ kind: "TypeError", cause: "URL.canParse argument ToString may throw (Symbol)" });
    }
    return boolPrim();
  }
  if (typeof u !== "string") {
    // number/bool/bigint/null 字面量：ToString 恒不可解析 → false（不抛）；
    // 缺省 url 原生折 false（canParse() → false）
    if (uR?.ok || url === undefined) return boolLit(false);
    return boolPrim();
  }
  if (!baseFoldable) {
    // 抽象 base：不可判定 → boolean（canParse 恒不抛——base 非法折 false）
    return boolPrim();
  }
  try {
    return boolLit(URL.canParse(u, b as string | undefined));
  } catch {
    return boolPrim();
  }
}

/** BigInt.asIntN / asUintN（wrap 到指定位宽） */
function evalBigIntStatic(method: string, args: Abs[]): Abs | undefined {
  if (method !== "asIntN" && method !== "asUintN") return undefined;
  const bitsA = args[0];
  const valA = args[1];
  // Bug 83：bits 过 ToIndex（ToNumber → ToIntegerOrInfinity 截断 → 范围检查）。
  // 字面量面先折 ToIndex（node 实测："8"→8、null→0、true→1、1.5 截断→1、
  // undefined/NaN→0——此前 typeof/isInteger 过严产生 RangeError 假阳）；
  // 负数 → 硬抛 RangeError；bigint 字面量（ToNumber 恒抛）→ 硬抛 TypeError；
  // >2^53-1 / ±∞ 由下方宿主真调用兜底（原生 RangeError）。
  let bits: number | undefined;
  if (bitsA && bitsA.term?.op === "lit") {
    const v = (bitsA.term as { value: unknown }).value;
    if (typeof v === "bigint" || typeof v === "symbol") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    if (
      typeof v === "number" ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      v === null ||
      v === undefined
    ) {
      const n = Math.trunc(Number(v));
      if (n < 0) throw new NudoThrow(errorTypeAbs("RangeError"));
      bits = n;
    }
  } else if (bitsA) {
    // Bug 83：非 lit 位宽——prim symbol/bigint（无 lit 项）确定 TypeError；
    // any/obj/… may TypeError（Symbol/BigInt 载体）+ may RangeError（负数）；
    // 抽象 prim number 只 may RangeError（不可能是 symbol/bigint 值）
    if (isSymbolAbs(bitsA) || isBigintPrimAbs(bitsA)) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    if (mayCoerceThrowOperand(bitsA)) {
      recordMayThrow({ kind: "TypeError", cause: "BigInt.asIntN/asUintN bits ToNumber may throw (Symbol/BigInt)" });
      recordMayThrow({ kind: "RangeError", cause: "BigInt.asIntN/asUintN bits may be negative" });
    } else if (bitsA.shape.k === "prim" && (bitsA.shape as { type?: string }).type === "number") {
      recordMayThrow({ kind: "RangeError", cause: "BigInt.asIntN/asUintN bits may be negative" });
    }
  }
  // Bug 41：value 过 ToBigInt（与 bits 档的 ToIndex 镜像；node 实测）。
  // 字面量面：bigint 保留折叠；number/symbol/null/undefined/缺参 → 硬抛
  // TypeError（ToBigInt 对 Number/Symbol/Nullish 恒抛）；string →
  // StringToBigInt（合法折叠、非法硬抛 SyntaxError）；boolean → ToBigInt
  // 折 1n/0n。抽象面按 shape 分档：symbol prim → 硬 TypeError；prim
  // number → may TypeError；prim string → may SyntaxError；闭形无
  // valueOf/toString 自有槽的 obj（{} 等——ToPrimitive 恒
  // "[object Object]"）→ 硬 SyntaxError；其余（any/带强转槽 obj/fn/
  // brand/sum/tuple…）→ may TypeError + may SyntaxError（带 Symbol 的
  // 数组 join 抛 TypeError、['x'] 抛 SyntaxError，node 实测）。
  let bigval: bigint | undefined;
  if (!valA) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  } else if (valA.term?.op === "lit") {
    const v = (valA.term as { value: unknown }).value;
    if (typeof v === "bigint") {
      bigval = v;
    } else if (typeof v === "number" || typeof v === "symbol" || v === null || v === undefined) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    } else if (typeof v === "boolean") {
      bigval = v ? 1n : 0n;
    } else if (typeof v === "string") {
      try {
        bigval = BigInt(v);
      } catch {
        throw new NudoThrow(errorTypeAbs("SyntaxError"));
      }
    }
  } else if (isSymbolAbs(valA)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  } else if (valA.shape.k === "prim") {
    const vt = (valA.shape as { type?: string }).type;
    if (vt === "number") {
      recordMayThrow({ kind: "TypeError", cause: "BigInt.asIntN/asUintN value ToBigInt(Number) may throw" });
    } else if (vt === "string") {
      recordMayThrow({ kind: "SyntaxError", cause: "BigInt.asIntN/asUintN value StringToBigInt may throw" });
    }
    // bigint/boolean prim：ToBigInt 全定（0n/1n），不记
  } else if (
    valA.shape.k === "obj" &&
    !(valA.shape as { open?: boolean }).open &&
    !getSlot((valA.shape as { slots: Record<string, { value: Abs }> }).slots, "valueOf") &&
    !getSlot((valA.shape as { slots: Record<string, { value: Abs }> }).slots, "toString")
  ) {
    throw new NudoThrow(errorTypeAbs("SyntaxError"));
  } else {
    recordMayThrow({ kind: "TypeError", cause: "BigInt.asIntN/asUintN value ToBigInt may throw (Symbol/BigInt via ToPrimitive)" });
    recordMayThrow({ kind: "SyntaxError", cause: "BigInt.asIntN/asUintN value StringToBigInt may throw" });
  }
  if (typeof bits === "number" && typeof bigval === "bigint") {
    try {
      return bigintLit(method === "asIntN" ? BigInt.asIntN(bits, bigval) : BigInt.asUintN(bits, bigval));
    } catch {
      throw new NudoThrow(errorTypeAbs("RangeError"));
    }
  }
  // 抽象实参：保守 bigint 非具体
  return abs(
    { k: "prim", type: "bigint" },
    undefined,
    undefined,
    "path",
  );
}

/** JS Error 家族构造器名（求值引擎 evalBuiltinNew / $new 共用） */
const ERROR_CTOR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "EvalError",
  "AggregateError",
]);

export function isErrorCtorName(name: string | undefined): boolean {
  return !!name && ERROR_CTOR_NAMES.has(name);
}

/** Error 构造器 message 槽：原生恒为字符串（缺省/undefined → ""；非字符串
 *  字面量 → ToString）。非字面量保守（字符串保持、其余 strPrim）。
 *  Bug 54：message 过 ToString——symbol prim（Symbol()/Symbol.for 产物，
 *  无 lit 项——JS 无 symbol 字面量，旧 lit 分支是死代码）定抛 TypeError
 *  （node 实测 new Error(Symbol()) 全家族抛）；any/unknown/含 symbol 臂
 *  union → may；bigint/number/bool/对象 ToString 全定（良性惯例）。 */
function errorMessageSlot(messageArg: Abs | undefined): Abs {
  if (!messageArg) return strLit(""); // new Error() → ""
  // shape-first：先于 lit 分支判 symbol 形态
  if (isSymbolAbs(messageArg)) throw new NudoThrow(errorTypeAbs("TypeError"));
  {
    const k = messageArg.shape.k;
    // nullish 字面量（shape k:"unknown" + lit term）ToString 全定（"null"/""）
    const nullishLit =
      messageArg.term?.op === "lit" &&
      (messageArg.term.value === null || messageArg.term.value === undefined);
    if (
      k === "any" ||
      (k === "unknown" && !nullishLit) ||
      (k === "sum" && messageArg.shape.members.some((m) => isSymbolAbs(m)))
    ) {
      recordMayThrow({ kind: "TypeError", cause: "Error constructor message ToString may throw (Symbol)" });
    }
  }
  if (messageArg.term?.op === "lit") {
    const v = messageArg.term.value;
    if (typeof v === "string") return messageArg;
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
      return strLit(String(v));
    }
    if (v === null) return strLit("null");
    if (v === undefined) return strLit(""); // new Error(undefined) → ""
    // symbol 等：原生 ToString 抛 TypeError——保守 unknown，不折精确值
    return str();
  }
  if (messageArg.shape.k === "prim" && messageArg.shape.type === "string") {
    return messageArg;
  }
  return str();
}

/**
 * Error brand：shape 带 name/message（字面量 message 保精确）。
 * AggregateError(errors, message[, options])：message 在第二实参，errors
 * 挂 .errors（原生是实参数组副本）；options.cause 挂 .cause（闭槽 miss
 * 会折 undefined 假精确——原生 .cause 可能有值）。
 * $new 的 new Error 路径共用——catch 形参成员访问可解。
 */
export function errorBrandAbs(name: string, args: Abs[]): Abs {
  const messageArg = name === "AggregateError" ? args[1] : args[0];
  const slots: Record<string, { value: Abs }> = {
    name: { value: strLit(name) },
    message: { value: errorMessageSlot(messageArg) },
    // Bug 59：stack 恒 string（V8/SpiderMonkey/JSC 堆栈轨迹文本，含调用点
    // 信息不可精确折叠）；用户写 e.stack = v 经既有 $set 槽写通道覆盖
    stack: { value: str("path") },
  };
  if (name === "AggregateError") {
    // Bug 54：errors（args[0]）过 IterableToList——非可迭代定抛（node 实测
    // AggregateError(Symbol())/1/()/null 全抛 "… is not iterable"；字符串
    // 可迭代合法："ab" → errors ['a','b']）。与 Promise.all（Bug 47）共用
    // 三档口径：prim 非 string/nullish/缺省 → NudoThrow；any/obj/… → may
    enforceIterableStaticArg(args[0], "AggregateError errors");
    // errors：字面量 tuple 保留精确；抽象/缺省（原生 []）保守 unknown
    slots["errors"] = { value: args[0] ?? unknown };
  }
  const optionsArg = name === "AggregateError" ? args[2] : args[1];
  if (optionsArg && optionsArg.shape.k === "obj") {
    const cause = Object.prototype.hasOwnProperty.call(optionsArg.shape.slots, "cause")
      ? optionsArg.shape.slots["cause"]!.value
      : undefAbs();
    slots["cause"] = { value: cause };
  }
  return abs(
    {
      k: "brand",
      name,
      shape: objOf(slots),
    },
    undefined,
    undefined,
    "path",
  );
}

// --- 宿主构造器实参校验（Bug 37/41/53/63/85）---------------------------
// 两个派发点共用：exec/class.ts $new 宿主函数分支（自由标识符漏入的宿主全局）
// 与本文件 evalBuiltinNew（Abs 面）。三档口径与全仓约定一致：
// - definite 原生 throw（prim 字面量/缺省等静态确定非法）→ NudoThrow
// - any/unknown/含坏成员的 union → recordMayThrow（值域不变）
// - obj/fn/brand/tuple/arr 等对象形态 → 原生全定（total）

/** union 含 prim 成员（非 nullish）→ 该值可能是原始值（原生 may TypeError） */
export function sumHasPrimMember(a: Abs): boolean {
  if (a.shape.k !== "sum") return false;
  return a.shape.members.some(
    (m) =>
      m.shape.k === "prim" &&
      !(m.term?.op === "lit" && (m.term.value === null || m.term.value === undefined)),
  );
}

/**
 * nullish 字面量实参（shape k:"unknown" + lit term——引擎的 null/undefined
 * 字面量表示，见 litAbsFromJs）。与 surface.isNullishLitAbs 同判定，本文件
 * 不引 surface（避免 builtins↔surface 新环）。
 */
function isNullishLit(a: Abs | undefined): boolean {
  return (
    !!a &&
    a.term?.op === "lit" &&
    (a.term.value === null || a.term.value === undefined)
  );
}

/**
 * Bug 37：new Proxy(target, handler) —— 原生 ProxyCreate 对 target 与
 * handler 各做 IsObject。prim（含 nullish/缺省 ≡ undefined）→ 确定
 * TypeError；any/unknown/含 prim 成员 union → may；obj/fn/brand/tuple/arr
 * 是对象 → 全定，构造 Proxy brand。
 */
export function makeProxyAbs(target: Abs | undefined, handler: Abs | undefined): Abs {
  for (const a of [target, handler]) {
    if (!a || isNullishLit(a) || a.shape.k === "prim") {
      throw new NudoThrow(errorTypeAbs("TypeError")); // 缺省/nullish/prim：非对象
    }
    if (a.shape.k === "any" || a.shape.k === "unknown" || sumHasPrimMember(a)) {
      recordMayThrow({ kind: "TypeError", cause: "new Proxy on non-object target or handler" });
    }
  }
  return abs({ k: "brand", name: "Proxy", shape: objOf({}) }, undefined, undefined, "path");
}

/** ES ToIndex 校验分类（ArrayBuffer length / DataView byteOffset·byteLength） */
type ToIndexClass = { k: "ok" } | { k: "range" } | { k: "type" } | { k: "may" };

const MAX_TO_INDEX = 2 ** 53 - 1;

/**
 * Bug 41/63：ES ToIndex —— ToNumber 后整数值 < 0 或 > 2^53-1 → RangeError；
 * symbol/bigint 的 ToNumber → TypeError；NaN/nullish → 0 合法；对象经
 * valueOf（良性惯例）→ NaN → 0 合法；any/unknown/抽象 prim → may。
 */
function classifyToIndex(a: Abs | undefined): ToIndexClass {
  if (!a || isNullishLit(a)) return { k: "ok" }; // 缺省/nullish：ToNumber → NaN → 0
  const s = a.shape;
  if (s.k === "prim") {
    // shape-first：symbol 恒无 lit term（JS 无 symbol 字面量），先查形态
    if (s.type === "symbol") return { k: "type" };
    const vR = litValue(a);
    if (!vR.ok) return { k: "may" }; // 抽象 prim（约束参数）：值未知
    const v = vR.value;
    if (v === undefined || v === null) return { k: "ok" }; // ToNumber → NaN → 0
    if (typeof v === "bigint") return { k: "type" }; // ToNumber(bigint) 原生 TypeError
    const n = Number(v); // number/string/boolean 的 ToNumber（含 "8"/"-1" 字符串折算）
    if (Number.isNaN(n)) return { k: "ok" }; // "abc"/undefined 字符串 → NaN → 0
    if (n === Infinity || n === -Infinity) return { k: "range" };
    const t = Math.trunc(n);
    return t < 0 || t > MAX_TO_INDEX ? { k: "range" } : { k: "ok" };
  }
  if (s.k === "any" || s.k === "unknown") return { k: "may" };
  if (s.k === "sum") {
    for (const m of s.members) {
      const c = classifyToIndex(m);
      // 有坏成员但可能取好成员 → 整体 may（不 definite）
      if (c.k !== "ok") return { k: "may" };
    }
    return { k: "ok" };
  }
  return { k: "ok" }; // obj/fn/brand/tuple/arr/eff：valueOf 良性 → 0
}

/** ToIndex 校验落地：range/type → NudoThrow；may → recordMayThrow(RangeError) */
function enforceToIndex(a: Abs | undefined, what: string): void {
  const c = classifyToIndex(a);
  if (c.k === "range") throw new NudoThrow(errorTypeAbs("RangeError"));
  if (c.k === "type") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (c.k === "may") {
    recordMayThrow({ kind: "RangeError", cause: `${what} may be negative or invalid (ToIndex)` });
  }
}

/** Bug 43：CanBeHeldWeakly 校验分类——自本文件移入 collections.ts 内核叶子
 *  （Bug 8：集合构造器条目键复用同口径，避免 collections ↔ builtins 新环）。 */

/** Bug 43：弱键校验落地：def → NudoThrow(TypeError)；may → recordMayThrow(TypeError) */
function enforceCanBeHeldWeakly(a: Abs | undefined, what: string): void {
  const c = classifyCanBeHeldWeakly(a);
  if (c.k === "def") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (c.k === "may") {
    recordMayThrow({ kind: "TypeError", cause: `${what} may not be an object or symbol (CanBeHeldWeakly)` });
  }
}

/** Bug 43：实参确定为 undefined（缺省 / undefined 字面量）——register 的
 * unregisterToken 仅此形态跳过弱键校验（原生 SameValue(·,undefined) 豁免） */
function isDefinitelyUndefinedArg(a: Abs | undefined): boolean {
  return !a || (a.term?.op === "lit" && a.term.value === undefined);
}

/**
 * Bug 15：ToIndex 数值折叠（与 classifyToIndex ok 档同口径的数值面）：
 * 字面量 prim → trunc(ToNumber(v))；nullish/NaN → 0；抽象/对象形态 →
 * undefined（域不可折，调用方落 number 域）。type/range 档已由 enforceToIndex
 * 先行抛出，这里不再重复判定。
 */
function toIndexLiteralValue(a: Abs | undefined): number | undefined {
  if (!a) return 0;
  // nullish 字面量（shape k:"unknown" + lit term）→ ToNumber → NaN → 0
  if (a.term?.op === "lit" && (a.term.value === null || a.term.value === undefined)) return 0;
  const s = a.shape;
  if (s.k !== "prim") return undefined;
  if (s.type === "symbol") return undefined;
  // 直接读 term（litValue 对 lit undefined 返回 not-ok——undefined 是哨兵）
  if (a.term?.op !== "lit") return undefined;
  const v = a.term.value;
  if (v === undefined || v === null) return 0;
  if (typeof v === "bigint") return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.trunc(n);
}

/**
 * Bug 15 补（review）：options.maxByteLength 三分可判性。
 * - absent：无 options / nullish 字面量（node v26 实测 `new ArrayBuffer(8, null)`
 *   同 undefined —— 不抛、非 resizable）/ 闭对象无自有槽 / 槽为字面量
 *   undefined —— ES2024 `Get(options,"maxByteLength")` 返回 undefined
 *   （缺省 ≡ 显式 undefined）⇒ 非 resizable，maxByteLength = byteLength
 *   （native 实测：`new ArrayBuffer(8,{maxByteLength:undefined}).resizable === false`）；
 * - present：闭对象自有非-undefined 槽 ⇒ resizable，走 ToIndex 校验 + 折叠
 *   （null 槽值 ≠ undefined：ToIndex(null)=0，0 < byteLength → RangeError）；
 * - undecidable：open obj / any / unknown / sum —— 运行时可能带任意
 *   maxByteLength，不得折叠 false（false precision）。
 */
type BufferOptionsClass =
  | { k: "absent" }
  | { k: "present"; value: Abs }
  | { k: "undecidable" };

function classifyBufferOptions(options: Abs | undefined): BufferOptionsClass {
  if (!options) return { k: "absent" };
  if (options.term?.op === "lit" && (options.term.value === null || options.term.value === undefined)) {
    return { k: "absent" };
  }
  const s = options.shape;
  if (s.k === "obj" && s.open !== true) {
    const slot = getSlot(s.slots, "maxByteLength");
    if (slot === undefined) return { k: "absent" };
    if (slot.value.term?.op === "lit" && slot.value.term.value === undefined) return { k: "absent" };
    return { k: "present", value: slot.value };
  }
  if (s.k === "any" || s.k === "unknown" || s.k === "sum" || (s.k === "obj" && s.open === true)) {
    return { k: "undecidable" };
  }
  // 其余闭形态（prim/tuple/arr/fn/brand…）：ToObject 后无 maxByteLength 键 → absent
  return { k: "absent" };
}

/**
 * Bug 41：new ArrayBuffer(length) —— length 过 ToIndex：负数/±∞/超 2^53-1 →
 * RangeError；symbol/bigint → TypeError（ToNumber）；缺省/NaN → 0 合法。
 * Bug 15：构造实参存入 brand 槽（字面量 ToIndex 精确折叠、抽象 → number 域）：
 * byteLength / maxByteLength（options.maxByteLength，缺省 ≡ byteLength）/
 * resizable（present → true；absent → false；undecidable → boolean 域）。
 * Review 补：present 且 maxByteLength < byteLength → RangeError（native 实测）；
 * 任一侧抽象 → 该比较 may-throw。
 */
export function makeArrayBufferAbs(len: Abs | undefined, options?: Abs | undefined): Abs {
  enforceToIndex(len, "ArrayBuffer length");
  const oc = classifyBufferOptions(options);
  const bl = toIndexLiteralValue(len);
  let maxV: number | undefined;
  if (oc.k === "present") {
    enforceToIndex(oc.value, "ArrayBuffer maxByteLength");
    maxV = toIndexLiteralValue(oc.value);
    if (maxV !== undefined && bl !== undefined) {
      if (maxV < bl) throw new NudoThrow(errorTypeAbs("RangeError"));
    } else {
      recordMayThrow({ kind: "RangeError", cause: "ArrayBuffer maxByteLength may be less than byteLength" });
    }
  } else if (oc.k === "undecidable") {
    recordMayThrow({ kind: "RangeError", cause: "ArrayBuffer maxByteLength may be negative or invalid (ToIndex)" });
    recordMayThrow({ kind: "RangeError", cause: "ArrayBuffer maxByteLength may be less than byteLength" });
  }
  const slots: Record<string, { value: Abs }> = {
    byteLength: { value: bl !== undefined ? numLit(bl) : numPrim("path") },
    maxByteLength: {
      value:
        oc.k === "absent"
          ? bl !== undefined ? numLit(bl) : numPrim("path")
          : maxV !== undefined ? numLit(maxV) : numPrim("path"),
    },
    resizable: { value: oc.k === "absent" ? boolLit(false) : oc.k === "undecidable" ? boolPrim() : boolLit(true) },
  };
  return abs({ k: "brand", name: "ArrayBuffer", shape: objOf(slots) }, undefined, undefined, "path");
}

/**
 * Bug 15：new SharedArrayBuffer(length, options?) —— ArrayBuffer 同款 ToIndex
 * 校验 + 槽构造（byteLength/maxByteLength/growable；SAB 是 growable 不是
 * resizable——原型无 resizable 访问器）。Review 补同 makeArrayBufferAbs：
 * maxByteLength 缺省/显式 undefined ≡ 非 growable；present 且
 * maxByteLength < byteLength → RangeError；undecidable → boolean 域不折 false。
 */
export function makeSharedArrayBufferAbs(len: Abs | undefined, options?: Abs | undefined): Abs {
  enforceToIndex(len, "SharedArrayBuffer length");
  const oc = classifyBufferOptions(options);
  const bl = toIndexLiteralValue(len);
  let maxV: number | undefined;
  if (oc.k === "present") {
    enforceToIndex(oc.value, "SharedArrayBuffer maxByteLength");
    maxV = toIndexLiteralValue(oc.value);
    if (maxV !== undefined && bl !== undefined) {
      if (maxV < bl) throw new NudoThrow(errorTypeAbs("RangeError"));
    } else {
      recordMayThrow({ kind: "RangeError", cause: "SharedArrayBuffer maxByteLength may be less than byteLength" });
    }
  } else if (oc.k === "undecidable") {
    recordMayThrow({ kind: "RangeError", cause: "SharedArrayBuffer maxByteLength may be negative or invalid (ToIndex)" });
    recordMayThrow({ kind: "RangeError", cause: "SharedArrayBuffer maxByteLength may be less than byteLength" });
  }
  const slots: Record<string, { value: Abs }> = {
    byteLength: { value: bl !== undefined ? numLit(bl) : numPrim("path") },
    maxByteLength: {
      value:
        oc.k === "absent"
          ? bl !== undefined ? numLit(bl) : numPrim("path")
          : maxV !== undefined ? numLit(maxV) : numPrim("path"),
    },
    growable: { value: oc.k === "absent" ? boolLit(false) : oc.k === "undecidable" ? boolPrim() : boolLit(true) },
  };
  return abs({ k: "brand", name: "SharedArrayBuffer", shape: objOf(slots) }, undefined, undefined, "path");
}

/**
 * Bug 63：new DataView(buffer, byteOffset?, byteLength?) —— buffer 必须
 * ArrayBuffer/SharedArrayBuffer（其余闭形态确定 TypeError，any/unknown/
 * open obj/union → may）；byteOffset/byteLength 过 ToIndex（负 → RangeError）。
 * Bug 35：ctor bounds——byteOffset/byteLength 越出 buffer.byteLength →
 * 定抛 RangeError；组合不可判 → may；byteLength 显式 undefined ≡ 缺省
 * （填满缓冲区）。
 */
export function makeDataViewAbs(
  buf: Abs | undefined,
  off: Abs | undefined,
  len: Abs | undefined,
): Abs {
  if (!buf || isNullishLit(buf)) {
    throw new NudoThrow(errorTypeAbs("TypeError")); // 缺省/nullish ≡ 非 buffer
  }
  const k = buf.shape.k;
  const isBufferBrand =
    k === "brand" && (buf.shape.name === "ArrayBuffer" || buf.shape.name === "SharedArrayBuffer");
  if (isBufferBrand) {
    // 合法 buffer：仅做 ToIndex 校验
  } else if (k === "any" || k === "unknown" || k === "sum" || (k === "obj" && buf.shape.open === true)) {
    recordMayThrow({ kind: "TypeError", cause: "DataView buffer may not be an ArrayBuffer" });
  } else {
    // prim/tuple/arr/fn/eff/闭对象/其余 brand：确定非 ArrayBuffer
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  enforceToIndex(off, "DataView byteOffset");
  enforceToIndex(len, "DataView byteLength");
  // Bug 35：byteLength 显式 undefined ≡ 缺省（原生构造器先判 undefined 再
  // ToIndex——new DataView(buf, 2, undefined).byteLength 是 bufLen−off 而非
  // ToIndex(undefined)=0，node 实测 6；null 仍走 ToIndex → 0）。
  const lenDefaulted = isDefinitelyUndefinedArg(len);
  // Bug 15：byteOffset/byteLength 存入 brand 槽（字面量 ToIndex 折叠、抽象 →
  // number 域）。byteLength 缺省 = buffer 的 byteLength 槽 − byteOffset
  // （buffer 为 ArrayBuffer/SharedArrayBuffer brand 时可读其槽）。
  const offV = off !== undefined ? toIndexLiteralValue(off) : 0;
  const bufBrand = isBufferBrand && buf.shape.k === "brand" ? buf.shape : undefined;
  const bufInner = bufBrand ? bufBrand.shape : undefined;
  const bufLenAbs = bufInner && bufInner.shape.k === "obj" ? getSlot(bufInner.shape.slots, "byteLength")?.value : undefined;
  const bufLenV = bufLenAbs !== undefined ? toIndexLiteralValue(bufLenAbs) : undefined;
  const lenV =
    !lenDefaulted && len !== undefined
      ? toIndexLiteralValue(len)
      : offV !== undefined && bufLenV !== undefined
        ? Math.max(0, bufLenV - offV)
        : undefined;
  // Bug 35 ctor bounds：byteOffset > buffer.byteLength 或（显式长度时）
  // byteOffset + byteLength > buffer.byteLength → 定抛 RangeError（node 实测
  // new DataView(buf8, 9) / (buf8, 4, 8) / (buf8, 100) 均 RangeError）；
  // 组合不可判 → may RangeError。缺省长度臂 = 填满缓冲区恒不越界，仅
  // byteOffset 需判；off=0 的缺省长度（含 any buffer 的 new DataView(x)）
  // 恒安全不记 may。
  if (offV !== undefined && bufLenV !== undefined) {
    if (offV > bufLenV) throw new NudoThrow(errorTypeAbs("RangeError"));
    if (!lenDefaulted) {
      if (lenV !== undefined) {
        if (offV + lenV > bufLenV) throw new NudoThrow(errorTypeAbs("RangeError"));
      } else {
        recordMayThrow({ kind: "RangeError", cause: "DataView byteLength may exceed the buffer bounds" });
      }
    }
  } else if (!(offV === 0 && lenDefaulted)) {
    recordMayThrow({ kind: "RangeError", cause: "DataView byteOffset/byteLength may exceed the buffer bounds" });
  }
  const slots: Record<string, { value: Abs }> = {
    byteOffset: { value: offV !== undefined ? numLit(offV) : numPrim("path") },
    byteLength: { value: lenV !== undefined ? numLit(lenV) : numPrim("path") },
  };
  return abs({ k: "brand", name: "DataView", shape: objOf(slots) }, undefined, undefined, "path");
}

/**
 * Bug 21：new <TA>(length) —— length 实参过 ToIndex（与 makeArrayBufferAbs
 * 同口径：负/±∞/超 2^53-1 → RangeError；symbol/bigint → TypeError；缺省/
 * NaN/截断小数合法）。抽象长度除 may RangeError 外还 may TypeError（any 载体
 * 可能是 Symbol——ToNumber 定抛）。iterable/array-like/对象实参走 ToPrimitive
 * 良性惯例 → 不抛（长度不建模，值域 imprecision 非 wrong-exact）。evalBuiltinNew
 * （Abs 面）与 $new 宿主分支共用本 builder。Bug 38 补：数字 length 形态
 * （单 prim 实参）length 入槽（非可枚举），set 的越界档据此可判。
 */
export function makeTypedArrayAbs(name: string, args: Abs[]): Abs {
  const len = args[0];
  // ToIndex 三档复用 enforceToIndex（range/type 定抛 / may → may RangeError）；
  // may 档额外记 may TypeError——any/obj 载体可能取 Symbol（ToNumber 定抛）
  enforceToIndex(len, "typed array length");
  if (classifyToIndex(len).k === "may" && mayCoerceThrowOperand(len)) {
    recordMayThrow({ kind: "TypeError", cause: "typed array length ToNumber may throw (Symbol/BigInt)" });
  }
  // Bug 38：数字 length 形态入槽（new <TA>(8).length === 8——原生非可枚举
  // 自有数据属性；字面量 ToIndex 折叠，抽象数字 → number 域；iterable/
  // buffer 形态长度不建模无槽）。%TypedArray%.prototype.set 的越界档
  // （offset + srcLen > targetLen）据此可判。length 槽标 enumerable:false
  // ——for-in / Object.keys 枚举视图保持空（原生同）。
  const slots: Record<string, { value: Abs }> = {};
  let lenIsNumericForm = false;
  if (len && len.shape.k === "prim" && args.length === 1) {
    lenIsNumericForm = true;
    const lenV = toIndexLiteralValue(len);
    slots.length = { value: lenV !== undefined ? numLit(lenV) : numPrim("path") };
  }
  const inner = objOf(slots);
  if (lenIsNumericForm) setPropFlags(inner, "length", { enumerable: false });
  return abs({ k: "brand", name, shape: inner }, undefined, undefined, "path");
}

/** Bug 27：可能取 null/undefined 的抽象实参（ToObject 定抛面）——any/unknown
 * （nullish 字面量挂 k:"unknown"+lit，由 isNullishLit 定抛分支处理）/含
 * 可能 nullish 臂的 sum；prim（非 nullish 值域）/obj/tuple/arr/fn/brand 恒非。 */
function mayBeNullishOperand(a: Abs | undefined): boolean {
  if (!a || isNullishLit(a)) return false;
  const k = a.shape.k;
  if (k === "any" || k === "unknown") return true;
  if (k === "sum") {
    return (a.shape as { k: "sum"; members: Abs[] }).members.some(mayBeNullishOperand);
  }
  return false;
}

/**
 * Bug 28：set-like `.size` 槽的 ToNumber 分类（GetSetRecord 第一读）。
 * ok = 数值可折（number/string/bool 字面量、null→0、抽象 bool）；
 * nan = NaN 定抛（undefined 字面量、NaN、不可解析 string 字面量）；
 * type = ToNumber 定抛 TypeError（symbol/bigint 形态）；
 * may = 抽象 number/string（可能 NaN）/对象强转路径不可判。
 * 注意 nullish 字面量挂 k:"unknown"+lit（isNullishLit 同口径）：
 * ToNumber(null)=0 合法、ToNumber(undefined)=NaN 定抛。
 */
function classifySetArgSizeNumber(v: Abs): "ok" | "nan" | "type" | "may" {
  if (isNullishLit(v)) {
    // isNullishLit 保证 lit term；此处显式收窄仅为类型（行为不变）
    const t = v.term;
    return t?.op === "lit" && t.value === null ? "ok" : "nan";
  }
  const s = v.shape;
  if (s.k === "prim") {
    if (s.type === "symbol") return "type"; // shape-first：symbol 恒无 lit term
    const r = litValue(v);
    if (!r.ok) {
      // 抽象 prim：bool 恒 0/1；抽象 number 可能 NaN、string 可能不可解析
      return s.type === "boolean" ? "ok" : "may";
    }
    const val = r.value;
    if (typeof val === "bigint") return "type"; // ToNumber(bigint) 原生 TypeError
    return Number.isNaN(Number(val)) ? "nan" : "ok"; // number/string/bool 折算
  }
  return "may"; // obj/tuple/arr/fn/brand/sum/any/unknown：valueOf 路径不可判
}

/**
 * Bug 28：ES2025 Set 方法实参的 GetSetRecord 校验（union/intersection/
 * difference/symmetricDifference/isSubsetOf/isSupersetOf/isDisjointFrom
 * 共用，node 实测）。原生三读：① 非对象 → "argument must be an object"
 * TypeError；② ToNumber(arg.size) 为 NaN 或 ToNumber 抛（symbol/bigint）
 * → TypeError；③ arg.has / arg.keys 非 callable → TypeError。Set/Map
 * brand 天然合法；tuple/arr/闭 obj 无 size 槽 → 定抛（.size 读取
 * undefined → NaN）；闭 obj 带 size 槽 → 逐槽三读（数值 size + 可调用
 * has/keys 全过才放行——duck-typed set-like 原生合法）；open obj/fn/
 * 其他 brand/any/unknown/sum/eff → may（可能有数值 size + 可调用槽，
 * 如自定义 set-like 类实例）。
 */
function enforceSetMethodArg(a: Abs | undefined, method: string): void {
  const what = `Set.prototype.${method} argument`;
  if (!a || isNullishLit(a) || a.shape.k === "prim") {
    throw new NudoThrow(errorTypeAbs("TypeError")); // 缺省/nullish/prim：非对象
  }
  const k = a.shape.k;
  if (k === "tuple" || k === "arr") {
    throw new NudoThrow(errorTypeAbs("TypeError")); // .size 读取 undefined → NaN
  }
  // Set/Map brand：数值 size + 可调用 has/keys 由构造保证 → 全定合法
  if (isSetAbs(a) || isMapAbs(a)) return;
  if (k === "obj") {
    const s = a.shape as Extract<Abs["shape"], { k: "obj" }>;
    if (s.open === true || s.index) {
      recordMayThrow({
        kind: "TypeError",
        cause: `${what} .size may be NaN / .has .keys may not be callable (open object)`,
      });
      return;
    }
    const sizeSlot = getSlot(s.slots, "size");
    if (!sizeSlot) throw new NudoThrow(errorTypeAbs("TypeError")); // 无 size 槽 → NaN
    if (sizeSlot.optional) {
      recordMayThrow({ kind: "TypeError", cause: `${what} .size may be absent (NaN)` });
    } else {
      const c = classifySetArgSizeNumber(sizeSlot.value);
      if (c === "nan" || c === "type") throw new NudoThrow(errorTypeAbs("TypeError"));
      if (c === "may") {
        recordMayThrow({ kind: "TypeError", cause: `${what} .size may be NaN` });
      }
    }
    for (const name of ["has", "keys"] as const) {
      const slot = getSlot(s.slots, name);
      if (!slot) throw new NudoThrow(errorTypeAbs("TypeError")); // undefined 非 callable
      if (slot.optional) {
        recordMayThrow({ kind: "TypeError", cause: `${what} .${name} may not be callable` });
        continue;
      }
      validateCallableArg(slot.value, `${what} .${name} may not be callable`);
    }
    return;
  }
  // fn/brand(非 Set/Map)/any/unknown/sum/eff：set-like 可能（不可判）→ may
  if (mayCoerceThrowOperand(a) || k === "eff") {
    recordMayThrow({
      kind: "TypeError",
      cause: `${what} .size may be NaN / .has .keys may not be callable`,
    });
  }
}

/**
 * Bug 27：ToBigInt 单项校验（bigint 域 of 的逐项面，与 evalBigIntStatic 的
 * value 档同口径）：bigint/boolean 字面量合法；number/symbol/nullish 字面量
 * 与 symbol prim → 定抛 TypeError；string 字面量 StringToBigInt（非法 →
 * SyntaxError）；prim number → may TypeError、prim string → may SyntaxError；
 * 闭对象无 valueOf/toString 自有槽 → ToPrimitive 恒 "[object Object]" →
 * 定抛 SyntaxError；其余（any/带强转槽 obj/fn/brand/sum/tuple…）→ may。
 */
function enforceTaBigIntItem(it: Abs): void {
  if (it.term?.op === "lit") {
    const v = it.term.value;
    if (typeof v === "bigint" || typeof v === "boolean") return; // ToBigInt 全定
    if (typeof v === "number" || typeof v === "symbol" || v === null || v === undefined) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    if (typeof v === "string") {
      try {
        BigInt(v);
      } catch {
        throw new NudoThrow(errorTypeAbs("SyntaxError"));
      }
    }
    return; // 其余对象字面量：ToPrimitive 良性惯例 → 下方保守面不重复记
  }
  if (isSymbolAbs(it)) throw new NudoThrow(errorTypeAbs("TypeError"));
  if (it.shape.k === "prim") {
    const t = (it.shape as { type?: string }).type;
    if (t === "number") {
      recordMayThrow({ kind: "TypeError", cause: "TypedArray.of item ToBigInt(Number) may throw" });
    } else if (t === "string") {
      recordMayThrow({ kind: "SyntaxError", cause: "TypedArray.of item StringToBigInt may throw" });
    }
    return; // bigint/boolean prim：ToBigInt 全定
  }
  if (
    it.shape.k === "obj" &&
    (it.shape as { open?: boolean }).open !== true &&
    !getSlot((it.shape as { slots: Record<string, { value: Abs }> }).slots, "valueOf") &&
    !getSlot((it.shape as { slots: Record<string, { value: Abs }> }).slots, "toString")
  ) {
    throw new NudoThrow(errorTypeAbs("SyntaxError"));
  }
  recordMayThrow({ kind: "TypeError", cause: "TypedArray.of item ToBigInt may throw (Symbol/Number via ToPrimitive)" });
  recordMayThrow({ kind: "SyntaxError", cause: "TypedArray.of item StringToBigInt may throw" });
}

/**
 * Bug 27：%TypedArray%.from / .of 静态面（12 家族，TYPED_ARRAY_ELEMENT 键）：
 * - from：items 过 ToObject——null/undefined 字面量 → 定抛 TypeError（原生
 *   "object null is not iterable"）；可能 nullish 的抽象 → may TypeError。
 *   非可迭代非 array-like 对象（含 Symbol() 装箱、number prim）原生折空
 *   数组不抛——不做 iterable 校验（与 Map/Set ctor 口径不同）。迭代逐项的
 *   元素转换（Uint8Array.from([1n]) 原生 TypeError）不建模（imprecision）。
 *   mapFn IsCallable 前置校验 + tuple items 的 mapper 逐元素执行（Bug 37，
 *   validateCallableArg/applyCallbackValue 对齐 Array.from 口径）。
 * - of：逐项过元素转换——number 域 ToNumber（symbol/bigint → 定抛
 *   TypeError、抽象 may）；bigint 域 ToBigInt（enforceTaBigIntItem）。
 * 值域：元素域 brand（长度/内容不建模，$idx 走 TYPED_ARRAY_ELEMENT 投影）。
 */
export function evalTypedArrayStatic(
  name: string,
  method: string,
  args: Abs[],
): Abs | undefined {
  const elem = typedArrayElementOf(name);
  if (elem === undefined) return undefined;
  const brand = () => abs({ k: "brand", name, shape: objOf({}) }, undefined, undefined, "path");
  if (method === "from") {
    const items = args[0];
    if (items && isNullishLit(items)) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (items && mayBeNullishOperand(items)) {
      recordMayThrow({ kind: "TypeError", cause: "TypedArray.from items ToObject may throw (null/undefined)" });
    }
    // Bug 37：? GetMethod(mapFn) 前置校验——对齐 Array.from（Bug 49）口径：
    // 原生 mapFn 先于任何元素映射过 IsCallable（空 items 也抛）。缺省/严格
    // undefined → 无 mapper；null/prim/闭 obj/tuple → 确定 TypeError；
    // any/unknown/open obj/含不可调用臂 sum → may TypeError
    validateCallableArg(args[1], "TypedArray.from mapFn may not be callable", {
      undefinedOk: true,
    });
    // 合法 mapper + 字面量元素（tuple items）：逐元素执行——副作用/体内
    // 抛错传播落地（对齐 Array.from 的 mapOne；元素转换与值域不建模，
    // brand 元素域投影同 Bug 27 口径）。抽象 items 元素未知，不执行。
    // isDefinitelyUndefinedArg：严格 undefined 字面量 ≡ 无 mapper（原生同，
    // validateCallableArg 的 undefinedOk 豁免同口径——不重蹈 Array.from
    // 对 undefined-lit mapper 误执行的覆辙）
    const mapFn = args[1];
    const hasMapper = !!mapFn && !isDefinitelyUndefinedArg(mapFn);
    if (hasMapper && items && items.shape.k === "tuple") {
      const els = (items.shape as { elements: Abs[] }).elements;
      for (let i = 0; i < els.length; i++) {
        applyCallbackValue(mapFn, [els[i]!, numLit(i)], emptyEnv(), pTrue, defaultLeakBudget);
      }
    }
    return brand();
  }
  if (method === "of") {
    for (const it of args) {
      if (elem === "bigint") {
        enforceTaBigIntItem(it);
        continue;
      }
      // number 域：ToNumber——symbol（shape 恒无 lit）/bigint 字面量/抽象
      // bigint prim → 定抛 TypeError；any/obj/fn/brand/sum 抽象项 → may
      if (isSymbolAbs(it) || isBigintPrimAbs(it)) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (it.term?.op === "lit" && typeof it.term.value === "bigint") {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (it.term?.op !== "lit" && mayCoerceThrowOperand(it)) {
        recordMayThrow({ kind: "TypeError", cause: "TypedArray.of item ToNumber may throw (Symbol/BigInt)" });
      }
    }
    return brand();
  }
  return undefined;
}

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

/**
 * Bug 53：new Number(v)/new String(v) —— ToNumber/ToString(symbol) 确定
 * TypeError（Boolean 的 ToBoolean 全定，不校验）；any/unknown/含 symbol
 * 成员 union → may；非 symbol 字面量/对象原生合法（ToNumber(1n)=1 等）。
 */
export function noteBoxedCtorArg(name: "Number" | "String", arg: Abs | undefined): void {
  if (!arg || isNullishLit(arg)) return; // ToNumber/ToString(nullish) 合法（NaN/"undefined"）
  if (isSymbolAbs(arg)) throw new NudoThrow(errorTypeAbs("TypeError"));
  const k = arg.shape.k;
  const maySymbol =
    k === "any" ||
    k === "unknown" ||
    (k === "sum" && arg.shape.members.some((m) => isSymbolAbs(m)));
  if (maySymbol) {
    recordMayThrow({ kind: "TypeError", cause: `${name} constructor argument may be a symbol` });
  }
}

/** Bug 22：装箱 brand 包装原始值的内部槽键（非原生属性名；用户面不可见） */
export const BOXED_PRIMITIVE_SLOT = "[[PrimitiveValue]]";

/**
 * Bug 22：装箱 brand 的包装原始值（字面量精确折叠、抽象 prim 保持、
 * 其余 → 域）。Number:ToNumber 折叠（缺省 → +0、null→0/undefined→NaN/
 * 字符串数字）；Boolean:ToBoolean 折叠（对象恒 true、nullish/缺省→false）；
 * String:ToString 折叠（缺省 → ""，显式 undefined → "undefined"）。
 * litValue not-ok（抽象实参）不得与「字面量 undefined」混淆——以哨兵区分。
 */
const NOT_A_LITERAL = Symbol("not-a-literal");

function boxedPrimitiveOf(name: "String" | "Number" | "Boolean", arg: Abs | undefined): Abs {
  let v: unknown = NOT_A_LITERAL;
  if (!arg) {
    // 缺省 ≠ undefined 字面量：Number()/String() 无参 → +0 / ""（native
    // new Number().valueOf() → 0、new String() → ""；显式传 undefined 才
    // 折 NaN/"undefined"）。Boolean 缺省与 undefined 同折 false，不变。
    if (name === "Number") return numLit(0);
    if (name === "String") return strLit("");
    v = undefined;
  } else {
    const vR = litValue(arg);
    if (vR.ok) v = vR.value;
  }
  const isLit = v !== NOT_A_LITERAL;
  if (name === "Number") {
    if (isLit) {
      if (typeof v === "number") return numLit(v);
      if (typeof v === "string" || typeof v === "boolean" || typeof v === "bigint") return numLit(Number(v));
      if (v === null) return numLit(0);
      return numLit(NaN); // undefined
    }
    if (arg && arg.shape.k === "prim" && arg.shape.type === "number") return arg;
    return numPrim("path");
  }
  if (name === "Boolean") {
    if (isLit) {
      if (typeof v === "boolean") return boolLit(v);
      if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") return boolLit(Boolean(v));
      return boolLit(false); // null / undefined
    }
    if (arg && arg.shape.k === "prim" && arg.shape.type === "boolean") return arg;
    // 抽象 string/number（"" / 0 可假）→ 域；obj/fn/brand/tuple/arr → ToBoolean 恒 true
    if (arg && arg.shape.k === "prim") return boolPrim();
    return boolLit(true);
  }
  // String
  if (isLit) {
    if (typeof v === "string") return strLit(v);
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return strLit(String(v));
    if (v === null) return strLit("null");
    return strLit("undefined"); // new String() → ToString(undefined)
  }
  if (arg && arg.shape.k === "prim" && arg.shape.type === "string") return arg;
  return str("path");
}

/**
 * Bug 22：装箱 brand 单一构造 builder（evalBuiltinNew / $new 宿主分支 /
 * evalGlobalFn Object 装箱共用——收敛此前「字面量带槽 / 抽象空箱」双口径）：
 * 包装原始值存 [[PrimitiveValue]] 内部槽（valueOf/toString/原型方法经
 * boxedPrimitiveValue 拆箱派发）；String 字面量箱另带 length/下标槽
 * （原生可枚举自有属性）；非字面量 String 箱 open（成员读保持非具体）。
 */
export function makeBoxedAbs(name: "String" | "Number" | "Boolean", arg: Abs | undefined): Abs {
  if (name === "Number" || name === "String") noteBoxedCtorArg(name, arg);
  const prim = boxedPrimitiveOf(name, arg);
  // [[PrimitiveValue]] 记不可枚举（enumOwnKeys / assign 视图不可见；
  // 原生装箱箱除 String 下标槽外零可枚举自有属性）
  const mkInner = (slots: Record<string, { value: Abs }>, opts?: { open?: boolean }) => {
    const inner = objOf(slots, opts);
    setPropFlags(inner, BOXED_PRIMITIVE_SLOT, { enumerable: false });
    return inner;
  };
  if (name === "String") {
    const svR = litValue(prim);
    const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
    if (typeof sv === "string") {
      const slots: Record<string, { value: Abs }> = {
        length: { value: numLit(sv.length) },
        [BOXED_PRIMITIVE_SLOT]: { value: prim },
      };
      for (let i = 0; i < sv.length; i++) {
        slots[String(i)] = { value: strLit(sv[i]!) };
      }
      return abs(
        { k: "brand", name: "String", shape: mkInner(slots) },
        undefined,
        undefined,
        "exact",
      );
    }
    return abs(
      { k: "brand", name: "String", shape: mkInner({ [BOXED_PRIMITIVE_SLOT]: { value: prim } }, { open: true }) },
      undefined,
      undefined,
      "path",
    );
  }
  return abs(
    { k: "brand", name, shape: mkInner({ [BOXED_PRIMITIVE_SLOT]: { value: prim } }) },
    undefined,
    undefined,
    "path",
  );
}

/**
 * Bug 22：装箱 brand 实例方法派发用——读 [[PrimitiveValue]] 槽拆箱。
 * 非装箱 brand / 无槽 → undefined（调用方不接管）。
 */
export function boxedPrimitiveValue(recv: Abs): Abs | undefined {
  if (recv.shape.k !== "brand") return undefined;
  const name = recv.shape.name;
  if (name !== "String" && name !== "Number" && name !== "Boolean") return undefined;
  const inner = recv.shape.shape;
  if (!inner || inner.shape.k !== "obj") return undefined;
  return getSlot(inner.shape.slots, BOXED_PRIMITIVE_SLOT)?.value;
}

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
 */
export function makeIntlCtorAbs(sub: IntlSubCtor): Abs {
  return absFunction(
    ["locales", "options"],
    {
      body: noBody,
      apply: (args) => makeIntlFormatAbs(sub, args[0]),
    },
    { name: `Intl.${sub}`, ctor: true },
  );
}

/**
 * Bug 29（强转三连）：`new Function(p0, …, body)` / `Function(…)` 动态代码
 * 构造器。实参逐个 ToString（Symbol → 确定 TypeError，node 实测
 * `new Function(Symbol())` 抛 "Cannot convert a Symbol value to a string"；
 * 抽象 any/obj/… → may）。动态体不静态求值（同 eval 口径）：返回 path 级
 * 抽象 fn，调用面保守 unknown。$new 宿主分支与 evalBuiltinNew（Abs 面）共
 * 用本 builder。
 */
export function makeDynamicFunctionAbs(a0: Abs | undefined): Abs {
  if (a0 && isSymbolAbs(a0)) throw new NudoThrow(errorTypeAbs("TypeError"));
  if (a0 && a0.term?.op !== "lit" && mayCoerceThrowOperand(a0)) {
    recordMayThrow({
      kind: "TypeError",
      cause: "new Function(body) ToString may throw (Symbol)",
    });
  }
  return abs({ k: "fn", params: [] }, undefined, undefined, "path");
}

/**
 * Bug 25：`new WeakRef(target)` —— target 过 CanBeHeldWeakly（与
 * FinalizationRegistry.register 同口径，enforceCanBeHeldWeakly 单一分类）：
 * prim/nullish 字面量与缺省 → 确定 TypeError（node 实测 "WeakRef:
 * invalid target"）；symbol/对象形态合法；抽象 → recordMayThrow。
 * 合法 → 空 brand（与原兜底同款；deref 值域走 BUILTIN_BRAND_METHODS 现状，
 * 弱目标身份不在分析域）。$new 宿主分支与 evalBuiltinNew（Abs 面）共用。
 */
export function makeWeakRefAbs(target: Abs | undefined): Abs {
  enforceCanBeHeldWeakly(target, "new WeakRef(target) target");
  return abs({ k: "brand", name: "WeakRef", shape: objOf({}) }, undefined, undefined, "path");
}

/**
 * Bug 25：`new FinalizationRegistry(cleanupCallback)` —— IsCallable 前置
 * 校验（validateCallableArg，无 undefinedOk 豁免——缺省/undefined 原生同抛
 * "cleanup must be callable"）：非 callable（prim/nullish 字面量/闭 obj/
 * 缺省）→ 确定 TypeError；any/open obj/含不可调用臂 union → may。
 * 合法 → 空 brand（实例方法面 register/unregister Bug 43 已落）。
 */
export function makeFinalizationRegistryAbs(cb: Abs | undefined): Abs {
  validateCallableArg(cb, "new FinalizationRegistry(cleanupCallback) callback may not be callable");
  return abs(
    { k: "brand", name: "FinalizationRegistry", shape: objOf({}) },
    undefined,
    undefined,
    "path",
  );
}

/** new X(...) */
export function evalBuiltinNew(className: string, args: Abs[]): Abs | undefined {
  // Bug 21：TypedArray 家族（TYPED_ARRAY_ELEMENT 表驱动）——length 实参
  // ToIndex 校验；$new 宿主分支共用 makeTypedArrayAbs
  if (typedArrayElementOf(className) !== undefined) {
    return makeTypedArrayAbs(className, args);
  }
  switch (className) {
    case "Date":
      return evalDateCtor(args);
    case "RegExp":
      return evalRegExpCtor(args);
    case "Function":
      // Bug 29：构造器形与调用形同口径（makeDynamicFunctionAbs 单一 builder）
      return makeDynamicFunctionAbs(args[0]);
    case "Symbol":
      // new Symbol() 原生 TypeError
      throw new NudoThrow(errorTypeAbs("TypeError"));
    case "BigInt":
      // Bug 45：BigInt 无 [[Construct]]（.prototype 存在但不可构造）→ 确定
      // TypeError（与 Symbol 同口径）
      throw new NudoThrow(errorTypeAbs("TypeError"));
    case "Promise":
      return evalPromiseCtor(args);
    case "Array":
      return makeArrayCtorAbs(args);
    case "Number":
    case "Boolean":
    case "String":
      // Bug 22：装箱统一 makeBoxedAbs（[[PrimitiveValue]] 槽 + String 下标槽；
      // Number symbol 实参 ToNumber 确定 TypeError、any → may——builder 内记）
      return makeBoxedAbs(className, args[0]);
    case "Map":
      // C1.1：可选 entry 元组列表填充字面量映射；
      // 确定非法实参（prim 条目/非可迭代）→ NudoThrow(TypeError)
      // （evaluator $new 同口径；$catchVal 吸收 NudoThrow）
      if (ctorArgDefinitelyInvalid("Map", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeMapAbs(args[0]);
    case "Set":
      // C1.2：从 iterable 填充元素联合
      if (ctorArgDefinitelyInvalid("Set", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeSetAbs(args[0]);
    case "WeakMap":
    case "WeakSet":
      // Bug 15：Map/Set 同口径 iterable 校验；合法 → 空 brand（条目表不建模）
      return makeWeakCollectionAbs(className as "WeakMap" | "WeakSet", args[0]);
    case "WeakRef":
      // Bug 25：target CanBeHeldWeakly 校验（与 FCR.register 同口径）
      return makeWeakRefAbs(args[0]);
    case "FinalizationRegistry":
      // Bug 25：cleanupCallback IsCallable 前置校验（缺省同抛）
      return makeFinalizationRegistryAbs(args[0]);
    case "Proxy":
      // Bug 37：target/handler IsObject 校验
      return makeProxyAbs(args[0], args[1]);
    case "ArrayBuffer":
      // Bug 41：length 过 ToIndex（负/超界 → RangeError；symbol/bigint → TypeError）
      // Bug 15：options.maxByteLength 同校验；实参存槽
      return makeArrayBufferAbs(args[0], args[1]);
    case "SharedArrayBuffer":
      // Bug 15：SAB 同款 ToIndex 校验 + 槽构造（growable 面）
      return makeSharedArrayBufferAbs(args[0], args[1]);
    case "DataView":
      // Bug 63：buffer IsArrayBuffer + byteOffset/byteLength ToIndex
      return makeDataViewAbs(args[0], args[1], args[2]);
    case "URL":
      // Bug 85：input ToString + URL 解析校验（字面量真解析带 href 槽）
      return makeUrlAbs(args[0], args[1]);
    case "Intl.NumberFormat":
    case "Intl.DateTimeFormat":
      // Bug 44：makeIntlCtorAbs 的 fn name 按名派发——locale 校验构造
      return makeIntlFormatAbs(
        className === "Intl.NumberFormat" ? "NumberFormat" : "DateTimeFormat",
        args[0],
      );
    default:
      // C2.2：Error 家族 → name/message 槽
      if (isErrorCtorName(className)) {
        return errorBrandAbs(className, args);
      }
      return undefined;
  }
}

/** Bug 23：迭代器结果对象 {value, done}（生成器对象 genIterResult 同款） */
function iterResultAbs(value: Abs, done: boolean): Abs {
  return abs(
    {
      k: "obj",
      slots: {
        value: { value },
        done: { value: boolLit(done) },
      },
    },
    undefined,
    undefined,
    "exact",
  );
}

/**
 * Bug 23：Map/Set keys/values/entries 迭代器对象——生成器对象（Bug 22）
 * 同款协议面：obj + next 方法槽（按调用序折 {value, done}，耗尽 →
 * {value: undefined, done: true}）+ @@iterator 槽 + 元素侧表
 * （registerGenElements）——spread/for-of/Array.from/.next() 链路全求值。
 */
function collectionIteratorAbs(els: Abs[]): Abs {
  const state = { i: 0 };
  const next = absFunction(
    [],
    {
      body: noBody,
      apply: (): Abs => {
        if (state.i >= els.length) return iterResultAbs(undefAbs(), true);
        const v = els[state.i]!;
        state.i++;
        return iterResultAbs(v, false);
      },
    },
    { ctor: false },
  );
  const slots: Record<string, { value: Abs }> = {
    next: { value: next },
    "@@iterator": { value: absFunction([], { body: noBody }, { ctor: false }) },
  };
  const iter = abs(
    { k: "obj", slots },
    undefined,
    undefined,
    els.every((e) => e.conf === "exact") ? "exact" : "path",
  );
  registerGenElements(iter, els);
  return iter;
}

/** Bug 23：Map 迭代条目的 key 投影（条目是 [k, v] 元组；非元组臂 → unknown） */
function mapEntryKey(e: Abs): Abs {
  if (e.shape.k === "tuple" && e.shape.elements.length >= 1) return e.shape.elements[0]!;
  return unknown;
}

/** Bug 23：Set 元素 → [el, el] 条目元组（Set#entries 原生语义） */
function setEntryTuple(el: Abs): Abs {
  return abs(
    { k: "tuple", elements: [el, el] },
    undefined,
    undefined,
    el.conf,
  );
}

/**
 * Bug 35：DataView.prototype get/set 存取族元素位宽（getFloat16/setFloat16
 * 为 ES2025 面，node v26 已有——台账键同名登记）。
 */
const DATAVIEW_ACCESS_BITS: Record<string, number> = {
  getInt8: 8, getUint8: 8,
  getInt16: 16, getUint16: 16, getFloat16: 16,
  getInt32: 32, getUint32: 32, getFloat32: 32,
  getBigInt64: 64, getBigUint64: 64, getFloat64: 64,
  setInt8: 8, setUint8: 8,
  setInt16: 16, setUint16: 16, setFloat16: 16,
  setInt32: 32, setUint32: 32, setFloat32: 32,
  setBigInt64: 64, setBigUint64: 64, setFloat64: 64,
};

/**
 * Bug 35：DataView get/set 存取族——byteOffset 实参过 ToIndex（负 →
 * RangeError；缺省/undefined → 0），越界（offset + 元素宽 > 视图
 * byteLength 槽）→ 定抛 RangeError；组合不可判（抽象 offset / 视图长度
 * 折不出）→ may RangeError。读返回域按元素类型（number 家族 → number、
 * BigInt64/BigUint64 → bigint——元素值域未建模的诚实 prim 域），写恒
 * undefined；littleEndian 实参 ToBoolean 恒不抛不校验。
 */
function evalDataViewMethod(method: string, recv: Abs, args: Abs[]): Abs | undefined {
  const bits = DATAVIEW_ACCESS_BITS[method];
  if (bits === undefined) return undefined;
  const isBigint = method === "getBigInt64" || method === "getBigUint64";
  const isSet = method.startsWith("set");
  enforceToIndex(args[0], `DataView.prototype.${method} byteOffset`);
  const offV = toIndexLiteralValue(args[0]);
  const inner = recv.shape.k === "brand" ? recv.shape.shape : undefined;
  const viewLenAbs =
    inner && inner.shape.k === "obj" ? getSlot(inner.shape.slots, "byteLength")?.value : undefined;
  const viewLenV = viewLenAbs !== undefined ? toIndexLiteralValue(viewLenAbs) : undefined;
  if (offV !== undefined && viewLenV !== undefined) {
    if (offV + bits / 8 > viewLenV) throw new NudoThrow(errorTypeAbs("RangeError"));
  } else {
    recordMayThrow({ kind: "RangeError", cause: `DataView.prototype.${method} byteOffset may exceed the view bounds` });
  }
  if (isSet) return undefAbs();
  return isBigint
    ? abs({ k: "prim", type: "bigint" }, undefined, undefined, "path")
    : numPrim("path");
}

/** Bug 38：TA brand 的 length 槽数字折叠（makeTypedArrayAbs 数字形态入槽；
 * iterable/buffer 形态与抽象长度 → undefined，越界档落 may） */
function taLengthSlotLit(recv: Abs): number | undefined {
  if (recv.shape.k !== "brand") return undefined;
  const inner = (recv.shape as { shape: Abs }).shape;
  if (inner.shape.k !== "obj") return undefined;
  const lenA = getSlot((inner.shape as { slots: Record<string, { value: Abs }> }).slots, "length")?.value;
  if (!lenA) return undefined;
  const v = litValue(lenA);
  return v.ok && typeof v.value === "number" ? v.value : undefined;
}

/**
 * Bug 38：set 源长度折叠（原生 array-like 的 Get(source,"length") →
 * ToLength 语义）：tuple 元数 / 字符串字面量长度 / TA 源 length 槽 / 装箱
 * prim 与无 length 槽闭对象折 0；其余（arr 抽象元素、open obj、any、抽象
 * length 槽、symbol 槽）不可判 → undefined（越界档落 may）。
 */
function taSetSourceLength(src: Abs): number | undefined {
  const k = src.shape.k;
  if (k === "tuple") return (src.shape as { elements: Abs[] }).elements.length;
  if (k === "prim") {
    if ((src.shape as { type?: string }).type === "string") {
      const v = litValue(src);
      return v.ok && typeof v.value === "string" ? v.value.length : undefined;
    }
    return 0; // number/bool/bigint/symbol 装箱无 length → ToLength(undefined)=0
  }
  if (k === "brand" && typedArrayElementOf((src.shape as { name?: string }).name ?? "") !== undefined) {
    return taLengthSlotLit(src);
  }
  if (k === "obj" && (src.shape as { open?: boolean }).open !== true) {
    const lenA = getSlot((src.shape as { slots: Record<string, { value: Abs }> }).slots, "length")?.value;
    if (!lenA) return 0; // 无 length 槽：Get → undefined → 0
    if (lenA.term?.op === "lit") {
      const v = lenA.term.value;
      if (v === null || v === undefined) return 0;
      if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
        const n = Number(v);
        if (Number.isNaN(n)) return 0;
        return Math.min(Math.max(Math.trunc(n), 0), Number.MAX_SAFE_INTEGER);
      }
    }
  }
  return undefined;
}

/** brand 内层 obj 槽表（非 obj 内层 → undefined） */
function brandObjSlots(recv: Abs): Record<string, { value: Abs }> | undefined {
  if (recv.shape.k !== "brand") return undefined;
  const inner = (recv.shape as { shape: Abs }).shape;
  return inner.shape.k === "obj"
    ? (inner.shape as { slots: Record<string, { value: Abs }> }).slots
    : undefined;
}

/** brand 实例方法（Date/RegExp/Map/Set/Error 家族/装箱拆箱后的 prim 面在外层） */
export function evalBuiltinInstanceMethod(
  brandName: string,
  method: string,
  recv: Abs,
  args: Abs[],
): Abs | undefined {
  if (brandName === "Date") return evalDateMethod(method, recv, args);
  if (brandName === "RegExp") return evalRegExpMethod(method, recv, args);
  // Bug 35：DataView get/set 存取族（bounds 校验 + 元素域返回）
  if (brandName === "DataView") return evalDataViewMethod(method, recv, args);
  // Bug 38：%TypedArray%.prototype.set(source, offset) —— 原生三段校验：
  // ① ToIndex(offset)（负/±∞/超 2^53-1 → RangeError；symbol/bigint →
  //    TypeError；抽象 → may RangeError，复用 enforceToIndex）；② ToObject
  //    (source)（nullish 字面量/缺省 → 定抛 TypeError；any/含 nullish 臂
  //    sum → may）；③ targetOffset + sourceLength > targetLength → RangeError
  //    ——target 长度读 makeTypedArrayAbs 的 length 槽（数字形态折叠），
  //    source 长度读 taSetSourceLength（tuple 元数/字符串长度/TA 源槽/装箱
  //    折 0）；任一侧不可判 → 保守 may。成功恒返 undefined；元素拷贝值域
  //    不建模（imprecision，同长度口径）。
  if (typedArrayElementOf(brandName) !== undefined && method === "set") {
    const offset = args.length > 1 ? args[1] : undefined;
    enforceToIndex(offset, "TypedArray.prototype.set offset");
    const src = args[0];
    if (!src || isNullishLit(src)) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (mayBeNullishOperand(src)) {
      recordMayThrow({ kind: "TypeError", cause: "TypedArray.prototype.set source ToObject may throw (null/undefined)" });
    }
    const offV = toIndexLiteralValue(offset);
    const srcLen = taSetSourceLength(src);
    const tgtLen = taLengthSlotLit(recv);
    if (offV !== undefined && srcLen !== undefined && tgtLen !== undefined) {
      if (offV + srcLen > tgtLen) throw new NudoThrow(errorTypeAbs("RangeError"));
    } else {
      recordMayThrow({ kind: "RangeError", cause: "TypedArray.prototype.set may exceed target bounds" });
    }
    return undefAbs();
  }
  // Bug 39：ArrayBuffer.prototype.resize(newLength) —— ValidateAndApply：
  // ① resizable 槽 false 字面量 → 定抛 TypeError（原生先于 newLength 求值）；
  //    抽象 → may TypeError。② newLength 过 ToIndex（负/超界 → RangeError；
  //    symbol/bigint → TypeError；抽象 → may）。③ newLength > maxByteLength
  //    槽 → 定抛 RangeError；任一侧抽象 → may。成功臂：byteLength 槽原地
  //    更新（$set 引用语义惯例——别名同步；字面量折新值、抽象 → number
  //    域）；恒返 undefined。transfer/grow/slice 不扩 scope（另行任务）。
  if (brandName === "ArrayBuffer" && method === "resize") {
    const slots = brandObjSlots(recv);
    const resizableA = slots ? getSlot(slots, "resizable")?.value : undefined;
    const resR = resizableA ? litValue(resizableA) : undefined;
    const resizableLit = resR?.ok && typeof resR.value === "boolean" ? resR.value : undefined;
    if (resizableLit === false) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (resizableLit === undefined) {
      recordMayThrow({ kind: "TypeError", cause: "ArrayBuffer.prototype.resize buffer may not be resizable" });
    }
    enforceToIndex(args[0], "ArrayBuffer resize newLength");
    const newLen = toIndexLiteralValue(args[0]);
    const maxA = slots ? getSlot(slots, "maxByteLength")?.value : undefined;
    const maxV = maxA ? toIndexLiteralValue(maxA) : undefined;
    if (newLen !== undefined && maxV !== undefined) {
      if (newLen > maxV) throw new NudoThrow(errorTypeAbs("RangeError"));
    } else {
      recordMayThrow({ kind: "RangeError", cause: "ArrayBuffer resize newLength may exceed maxByteLength" });
    }
    if (slots) {
      setSlot(slots, "byteLength", { value: newLen !== undefined ? numLit(newLen) : numPrim("path") });
    }
    return undefAbs();
  }
  // Bug 42：URL.prototype.toJSON ≡ href（原生恒 string，total——与 Date 的
  // toJSON 同语义；toString 巧合路径之外补显式面）
  if (brandName === "URL") {
    if (method === "toJSON") {
      const inner = recv.shape.k === "brand" ? recv.shape.shape : undefined;
      const href =
        inner && inner.shape.k === "obj"
          ? getSlot((inner.shape as { slots: Record<string, { value: Abs }> }).slots, "href")?.value
          : undefined;
      const hv = href ? litValue(href) : undefined;
      if (hv?.ok && typeof hv.value === "string") return strLit(hv.value);
      return str("path");
    }
    return undefined;
  }
  // Bug 10：Error 家族 toString/toLocaleString = `${name}: ${message}`
  // （name/message 槽已建模；原生空 message 只返 name）；valueOf 走
  // Object.prototype 恒等（既有路径，不在此接管）
  if (isErrorCtorName(brandName)) {
    switch (method) {
      case "toString":
      case "toLocaleString": {
        const inner = recv.shape.k === "brand" ? recv.shape.shape : undefined;
        const nameA = inner && inner.shape.k === "obj" ? getSlot(inner.shape.slots, "name")?.value : undefined;
        const msgA = inner && inner.shape.k === "obj" ? getSlot(inner.shape.slots, "message")?.value : undefined;
        const nameR = nameA ? litValue(nameA) : undefined;
        const msgR = msgA ? litValue(msgA) : undefined;
        const nv = nameR?.ok && typeof nameR.value === "string" ? nameR.value : undefined;
        const mv = msgR?.ok && typeof msgR.value === "string" ? msgR.value : undefined;
        if (nv !== undefined && mv !== undefined) {
          return strLit(mv === "" ? nv : `${nv}: ${mv}`);
        }
        return str("path");
      }
      default:
        return undefined;
    }
  }
  if (brandName === "Map") {
    switch (method) {
      case "get":
        return mapGetEntry(recv, args[0]);
      case "has":
        return mapHasEntry(recv, args[0]);
      case "set":
        return mapSetEntry(recv, args[0], args[1] ?? unknown);
      case "delete":
        return mapDeleteEntry(recv, args[0]);
      case "clear":
        return mapClearEntries(recv);
      case "size":
        return mapSizeAbs(recv);
      // Bug 23：迭代器三件套 → 带协议面的迭代器对象（条目表精确展开）
      case "keys":
        return collectionIteratorAbs(mapEntriesAbs(recv).map(mapEntryKey));
      case "values":
        return collectionIteratorAbs(mapValuesAbs(recv));
      case "entries":
        return collectionIteratorAbs(mapEntriesAbs(recv));
      default:
        return undefined;
    }
  }
  if (brandName === "Set") {
    switch (method) {
      case "has":
        return setHasEntry(recv, args[0]);
      case "add":
        return setAddEntry(recv, args[0] ?? unknown);
      case "delete":
        return setDeleteEntry(recv, args[0]);
      case "clear":
        return setClearEntries(recv);
      case "size":
        return setSizeAbs(recv);
      // Bug 23：Set keys ≡ values ≡ 元素序列；entries → [el, el] 条目
      case "keys":
      case "values":
        return collectionIteratorAbs(setElementsAbs(recv));
      case "entries":
        return collectionIteratorAbs(setElementsAbs(recv).map(setEntryTuple));
      // Bug 28：ES2025 Set 方法族——实参 GetSetRecord 校验（非对象 /
      // .size NaN / .has·.keys 非 callable → TypeError）+ 值域折叠
      // （setMethodFold：双方条目表确切时 union 恒折、其余运算与 is*
      // 谓词全字面量折；不可折 → 集合运算诚实 unknown / is* 抽象 boolean）。
      case "union":
      case "intersection":
      case "difference":
      case "symmetricDifference":
      case "isSubsetOf":
      case "isSupersetOf":
      case "isDisjointFrom": {
        enforceSetMethodArg(args[0], method);
        const isPred =
          method === "isSubsetOf" || method === "isSupersetOf" || method === "isDisjointFrom";
        return setMethodFold(recv, method, args[0] as Abs) ?? (isPred ? boolPrim() : unknown);
      }
      default:
        return undefined;
    }
  }
  // Bug 12/22：WeakMap/WeakSet 实例方法——弱持有条目表不建模（key 身份
  // 不在分析域，makeWeakCollectionAbs 空 brand）：set/add 键过 CanBeHeldWeakly
  // （enforceCanBeHeldWeakly 与 FCR 同口径：prim/nullish 字面量与缺省 →
  // 确定 TypeError；symbol/对象形态合法弱键——注册 Symbol.for 原生抛、
  // 未注册不抛，Abs 无注册标记不可分，保守按合法；抽象 → may）；返回面
  // set/add → receiver（原生恒返 this，链式精确），get/has/delete 原生对
  // 非弱键不抛直返 undefined/false——确定非弱键可精确折，其余键条目表
  // 不建模：get → unknown、has/delete → 抽象 boolean。
  if (brandName === "WeakMap" || brandName === "WeakSet") {
    if (method === "set" || method === "add") {
      enforceCanBeHeldWeakly(args[0], `${brandName}.prototype.${method} key`);
      return recv;
    }
    if (method === "get" || method === "has" || method === "delete") {
      if (classifyCanBeHeldWeakly(args[0]).k === "def") {
        return method === "get" ? undefAbs() : boolLit(false);
      }
      return method === "get" ? unknown : boolPrim();
    }
    return undefined;
  }
  // Bug 43：FCR register/unregister 的 IsObject（CanBeHeldWeakly）校验——
  // 此前走空 brand 兜底不校验 target（L2 漏报）。FCR 实例是 $new 空 brand
  // 兜底产物（brand 名 "FinalizationRegistry"，$invokeInner 品牌派发直达）。
  if (brandName === "FinalizationRegistry") {
    switch (method) {
      case "register":
        // target 非弱键 → TypeError（node 实测 register(1,1)/('s',1)/(null,1)/
        // (undefined,1)/(true,1)/(1n,1) 抛；register(Symbol(),1)/({},1) 合法）；
        // heldToken 任意值合法（原生不校验）；unregisterToken 仅在给出且
        // 非 undefined 时同校验（SameValue(·,undefined) 豁免，null 仍抛）
        enforceCanBeHeldWeakly(args[0], "FinalizationRegistry.prototype.register target");
        if (!isDefinitelyUndefinedArg(args[2])) {
          enforceCanBeHeldWeakly(args[2], "FinalizationRegistry.prototype.register unregisterToken");
        }
        return undefAbs(); // 原生恒 undefined（may 档亦然——非抛臂返回面确定）
      case "unregister":
        // token 过 CanBeHeldWeakly（无 register 的 undefined 豁免——缺省/
        // undefined 字面量亦抛，node 实测）；cells 表未建模 → 保守 boolean
        enforceCanBeHeldWeakly(args[0], "FinalizationRegistry.prototype.unregister unregisterToken");
        return boolPrim();
      default:
        return undefined;
    }
  }
  return undefined;
}
