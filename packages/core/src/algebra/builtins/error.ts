/**
 * Error 家族 + evalBuiltinNew / evalBuiltinInstanceMethod + namespace 分派
 */
import type { Abs } from "../abs.ts";
import { abs, strLit, numLit, litValue, bigintLit, boolLit, unknown } from "../abs.ts";
import { objOf, getSlot } from "../objects.ts";
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
  ctorArgDefinitelyInvalid,
  makeWeakCollectionAbs,
} from "../collections.ts";
import { undefAbs } from "../hof.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { registerGenElements } from "../exec/match-iter.ts";
import { absFunction } from "../abs-fn.ts";
import { setPropFlags } from "./invariants.ts";
import { isSymbolAbs, evalSymbolStatic } from "./symbol.ts";
import { str, numPrim, boolPrim, noBody, mayCoerceThrowOperand, isBigintPrimAbs } from "./shared.ts";
import { evalMathMethod } from "./math.ts";
import { evalObjectMethod } from "./object.ts";
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
    case "Intl":
      // Bug 44：NumberFormat/DateTimeFormat 调用面（new 省略形 ≡ new，
      // 宿主接收者经 $invoke→ns 分派到此处）——与 evalBuiltinNew 同 builder
      if (method === "NumberFormat" || method === "DateTimeFormat") {
        return makeIntlFormatAbs(method, args[0]);
      }
      return undefined;
    default:
      return undefined;
  }
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

/** Bug 43：CanBeHeldWeakly 校验分类（FinalizationRegistry.register/unregister 弱键） */
type WeakHeldClass = { k: "ok" } | { k: "def" } | { k: "may" };

/**
 * Bug 43：ES CanBeHeldWeakly 分类——对象形态（obj/tuple/arr/fn/brand/eff）
 * 与 symbol 是合法弱键（node 26 实测 register(Symbol(),1) 不抛）；
 * number/string/boolean/bigint 字面量与 nullish 字面量/缺省 ≡ undefined
 * → 确定非弱键；抽象 prim/any/unknown/含坏成员 union → may。
 */
function classifyCanBeHeldWeakly(a: Abs | undefined): WeakHeldClass {
  if (!a) return { k: "def" }; // 缺省 ≡ undefined：非弱键
  const s = a.shape;
  if (s.k === "prim") {
    // shape-first：symbol 恒无 lit term（无 symbol 字面量），先查形态
    if (s.type === "symbol") return { k: "ok" };
    return a.term?.op === "lit" ? { k: "def" } : { k: "may" }; // 抽象 prim：值未知
  }
  if (s.k === "any" || s.k === "unknown") {
    // nullish 字面量挂 k:"unknown" + lit term（与 isNullishLit 同口径）
    return isNullishLit(a) ? { k: "def" } : { k: "may" };
  }
  if (s.k === "sum") {
    // 有坏成员但可能取好成员 → 整体 may（与 classifyToIndex 同口径，不 definite）
    for (const m of s.members) {
      if (classifyCanBeHeldWeakly(m).k !== "ok") return { k: "may" };
    }
    return { k: "ok" };
  }
  return { k: "ok" }; // obj/fn/brand/tuple/arr/eff：对象 → 弱键合法
}

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
  // Bug 15：byteOffset/byteLength 存入 brand 槽（字面量 ToIndex 折叠、抽象 →
  // number 域）。byteLength 缺省 = buffer 的 byteLength 槽 − byteOffset
  // （buffer 为 ArrayBuffer/SharedArrayBuffer brand 时可读其槽）。
  const offV = off !== undefined ? toIndexLiteralValue(off) : 0;
  const bufBrand = isBufferBrand && buf.shape.k === "brand" ? buf.shape : undefined;
  const bufInner = bufBrand ? bufBrand.shape : undefined;
  const bufLenAbs = bufInner && bufInner.shape.k === "obj" ? getSlot(bufInner.shape.slots, "byteLength")?.value : undefined;
  const bufLenV = bufLenAbs !== undefined ? toIndexLiteralValue(bufLenAbs) : undefined;
  const lenV =
    len !== undefined
      ? toIndexLiteralValue(len)
      : offV !== undefined && bufLenV !== undefined
        ? Math.max(0, bufLenV - offV)
        : undefined;
  const slots: Record<string, { value: Abs }> = {
    byteOffset: { value: offV !== undefined ? numLit(offV) : numPrim("path") },
    byteLength: { value: lenV !== undefined ? numLit(lenV) : numPrim("path") },
  };
  return abs({ k: "brand", name: "DataView", shape: objOf(slots) }, undefined, undefined, "path");
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
 * 其余 → 域）。Number:ToNumber 折叠（null→0/undefined→NaN/字符串数字）；
 * Boolean:ToBoolean 折叠（对象恒 true、nullish→false）；String:ToString
 * 折叠（缺省 ≡ undefined → "undefined"）。litValue not-ok（抽象实参）
 * 不得与「字面量 undefined」混淆——以哨兵区分。
 */
const NOT_A_LITERAL = Symbol("not-a-literal");

function boxedPrimitiveOf(name: "String" | "Number" | "Boolean", arg: Abs | undefined): Abs {
  let v: unknown = NOT_A_LITERAL;
  if (!arg) {
    v = undefined; // 缺省 ≡ 字面量 undefined
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

/** new X(...) */
export function evalBuiltinNew(className: string, args: Abs[]): Abs | undefined {
  switch (className) {
    case "Date":
      return evalDateCtor(args);
    case "RegExp":
      return evalRegExpCtor(args);
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

/** brand 实例方法（Date/RegExp/Map/Set/Error 家族/装箱拆箱后的 prim 面在外层） */
export function evalBuiltinInstanceMethod(
  brandName: string,
  method: string,
  recv: Abs,
  args: Abs[],
): Abs | undefined {
  if (brandName === "Date") return evalDateMethod(method, recv, args);
  if (brandName === "RegExp") return evalRegExpMethod(method, recv, args);
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
      default:
        return undefined;
    }
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
