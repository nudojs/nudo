/**
 * 命名空间静态分派：evalNamespaceCall 总入口 + 本地静态面（Map.groupBy /
 * URL.canParse / ArrayBuffer.isView / BigInt.asIntN·asUintN）。
 *
 * Invariants:
 * - 静态面只走「纯静态」（无接收者）调用；未建模方法返回 undefined 交通用
 *   回退，不得折精确值。
 * - Map.groupBy 与 Object.groupBy 共用 foldGroupBy（object 域单一折叠口径，
 *   键模式 "map" 原始键 SameValueZero 字面量合并，不 ToPropertyKey）；键
 *   不可判组并入 shadow（get 未知键 → 元素域数组 join undefined）。
 * - ArrayBuffer.isView 是纯谓词恒不抛（Invalid → false 非抛的口径只属于
 *   canParse）：DV/TA brand → true、确定非视图闭形态 → false、不可判
 *  （any/unknown/未知 brand/mock 面）→ boolean 域不折字面量。
 * - BigInt.asIntN/asUintN：bits 过 ToIndex（负数 → RangeError、bigint/
 *   symbol → TypeError）、value 过 ToBigInt（number/nullish → TypeError、
 *   非法 string → SyntaxError），字面量可折时宿主真调用兜底。
 *
 * 兄弟模块边界：Intl/TypedArray 尾分派落在 intl.ts / binary.ts；实例方法
 * 与 new 分派在 dispatch.ts。
 */

import type { Abs } from "../../abs.ts";
import { abs, litValue, bigintLit, boolLit, bool, unknown, confJoin } from "../../abs.ts";
import { getSlot, joinAbs } from "../../objects.ts";
import { makeMapAbs } from "../../collections.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { isSymbolAbs, evalSymbolStatic } from "../symbol.ts";
import {
  boolPrim,
  mayCoerceThrowOperand,
  isBigintPrimAbs,
  typedArrayElementOf,
} from "../shared.ts";
import { evalMathMethod } from "../math.ts";
import { evalObjectMethod, foldGroupBy } from "../object.ts";
import { evalJsonMethod } from "../json.ts";
import { evalNumberStatic } from "../number.ts";
import { evalStringStatic } from "../string.ts";
import { evalArrayStatic } from "../array.ts";
import { evalDateStatic } from "../date.ts";
import { evalPromiseStatic } from "../promise.ts";
import { evalReflectMethod } from "../reflect.ts";

import { isErrorCtorName } from "./error-family.ts";
import { evalTypedArrayStatic } from "./binary.ts";
import { makeIntlFormatAbs } from "./intl.ts";

/**
 * 命名空间静态分派。Bug 311：thisVal = 静态方法值的 this 绑定（成员读出的
 * 静态方法被单独调用时的接收者，如 `Promise.resolve.call(null, 1)`）；
 * 缺席 = 直接命名空间调用（this ≡ 命名空间构造器，合法）。
 */
export function evalNamespaceCall(
  ns: string,
  method: string,
  args: Abs[],
  thisVal?: Abs,
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
      // Bug 311：Promise 静态以 this 为接收者（PromiseResolve 要求 this 是
      // 构造器，否则 TypeError）
      return evalPromiseStatic(method, args, thisVal);
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
    case "ArrayBuffer":
      // P3a：ArrayBuffer.isView 纯谓词（N3 白名单静态；AB(8).slice 等实例
      // 方法不经此）。extends ArrayBuffer 派生类的静态调用沿 N2 宿主通道
      // 派发到此处。
      return evalArrayBufferStatic(method, args);
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
      // 键不可判组：元素可归入任意组 → shadow 值 = 元素域数组。
      // unkeyed 可为空（arr/抽象串的代表元素键可判时 open 仍
      // true）——空 reduce 裸抛宿主 TypeError（非 NudoThrow）炸穿
      // 求值；空域折 unknown（与 unknown 元素同口径）
      const domain =
        fold.unkeyed.length > 0
          ? fold.unkeyed.reduce((x, y) => joinAbs(x, y))
          : unknown;
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

/**
 * P3a：ArrayBuffer.isView(arg) —— 纯谓词（恒不抛）：DataView/TypedArray
 * brand → true；ArrayBuffer/SharedArrayBuffer brand 与 prim/obj/arr/tuple/
 * fn/eff 面 → false（确定非视图）；其余（any/unknown/sum/未知 brand——
 * 可能是宿主视图值或 mock）→ boolean（不可判不折）。node 实测
 * isView(new ArrayBuffer(4)) === false（视图仅 DV/TA）。
 */
function evalArrayBufferStatic(method: string, args: Abs[]): Abs | undefined {
  if (method !== "isView") return undefined;
  const a = args[0];
  if (a && typeof a === "object" && "shape" in (a as object)) {
    const s = (a as Abs).shape;
    if (s.k === "brand") {
      if (s.name === "DataView" || typedArrayElementOf(s.name) !== undefined) return boolLit(true);
      if (
        s.name === "ArrayBuffer" ||
        s.name === "SharedArrayBuffer" ||
        isErrorCtorName(s.name) ||
        s.name === "Map" || s.name === "Set" || s.name === "WeakMap" ||
        s.name === "WeakSet" || s.name === "Date" || s.name === "RegExp" ||
        s.name === "Promise" || s.name === "URL" || s.name === "WeakRef" ||
        s.name === "FinalizationRegistry"
      ) {
        return boolLit(false);
      }
      // 用户类实例 brand：构造面（constructClass/evalBuiltinNew）产出内建
      // brand，用户 brand 理论上非视图——但 extends TA 的旧路径/mock 面
      // 不可枚举，保持不可判。
      return bool();
    }
    if (
      s.k === "prim" || s.k === "obj" || s.k === "arr" || s.k === "tuple" ||
      s.k === "fn" || s.k === "eff"
    ) {
      return boolLit(false);
    }
  }
  return bool();
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
