/**
 * 装箱原始值 brand：new Number/String/Boolean 与 Object(prim) 装箱
 * （makeBoxedAbs 单一构造 builder）+ 实例方法拆箱（boxedPrimitiveValue）。
 *
 * Invariants:
 * - 包装原始值存 [[PrimitiveValue]] 内部槽（enumerable:false，枚举视图与
 *   assign 剔除）；实例方法派发经 boxedPrimitiveValue 读槽拆箱（外层
 *   brand 方法面），非装箱 brand/无槽 → undefined（调用方不接管）。
 * - 缺省 ≠ undefined 字面量（Number()/String() 无参 → +0/""；显式
 *   undefined 才折 NaN/"undefined"）——litValue not-ok（抽象实参）与
 *  「字面量 undefined」以 NOT_A_LITERAL 哨兵区分。
 * - String 字面量箱另带 length/下标槽（原生可枚举自有属性，conf exact）；
 *   非字面量 String 箱 open（成员读保持非具体）。
 * - Number/String 构造实参 ToNumber/ToString(symbol) 校验
 *  （noteBoxedCtorArg：symbol 定抛、any/含 symbol 臂 union → may）；
 *   Boolean 的 ToBoolean 全定不校验。web 域（URLSearchParams）复用该校验。
 */

import type { Abs } from "../../abs.ts";
import { abs, strLit, numLit, litValue, boolLit, unknown } from "../../abs.ts";
import { objOf, getSlot } from "../../objects.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { setPropFlags } from "../invariants.ts";
import { isSymbolAbs } from "../symbol.ts";
import { str, numPrim, boolPrim } from "../shared.ts";

import { isNullishLit } from "./error-family.ts";

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
