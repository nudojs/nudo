/**
 * Abs builtin 共享原始值 / 小工具（内部）。不从 builtins.ts facade 再导出。
 */
import type { Abs } from "../abs.ts";
import { abs } from "../abs.ts";
import { getEvalClass } from "../exec/class-registry.ts";

export const noBody = { type: "BlockStatement", body: [], directives: [] } as never;

export function numPrim(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "number" }, undefined, undefined, conf);
}

export function str(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "string" }, undefined, undefined, conf);
}

export function boolPrim(conf: Abs["conf"] = "partial"): Abs {
  return abs({ k: "prim", type: "boolean" }, undefined, undefined, conf);
}

/** brand 是编译期标签，运行时仍是底层值；isArray 须看穿 */
export function peelBrand(shape: Abs["shape"]): Abs["shape"] {
  let s = shape;
  while (s.k === "brand") s = s.shape.shape;
  return s;
}

/** 非对象形态（prim/never/null/undefined 字面量）→ ES 不变性自省恒真/假 */
export function isPrimLike(a: Abs | undefined): boolean {
  if (!a) return true; // 无实参 → undefined
  if (a.shape.k === "prim" || a.shape.k === "never") return true;
  if (a.term?.op === "lit" && (a.term.value === null || a.term.value === undefined)) {
    return true;
  }
  return false;
}

/**
 * prim-bigint Abs（无 lit 项——BigInt(x) / 运算产物）：ToNumber/ToNumeric
 * 恒抛 TypeError（bigint 字面量有 lit 项，由各 site 的 lit 分支处理）。
 * 与 isSymbolAbs（symbol-id.ts，prim+type symbol）同族——shape 先于 lit 判定。
 */
export function isBigintPrimAbs(a: Abs | undefined): boolean {
  return (
    !!a &&
    a.shape.k === "prim" &&
    (a.shape as { type?: string }).type === "bigint"
  );
}

/**
 * 强转面「可能抛」判定（Bug 25/26/30/45/50/81 共享）：any/unknown/obj/fn/
 * brand/sum——ToPrimitive 后可能成 Symbol/BigInt 值（ToNumber/ToString 原生
 * 抛，node 实测 Math.max({valueOf(){return 1n}}) → TypeError）。prim（含
 * 抽象 prim——ToString/ToPrimitive 恒等）与 tuple/arr 不在此列：对应强转
 * 原生全定（Array(Symbol()) → [Symbol()]，node 实测 total）。lit 项恒 false
 * ——字面量由各 site 的折叠分支处理（lit(undefined) 形如 unknown 但 total）。
 */
export function mayCoerceThrowOperand(a: Abs | undefined): boolean {
  if (!a || a.term?.op === "lit") return false;
  const k = a.shape.k;
  if (k === "sum") {
    // sum 只要有臂可能抛才算可能抛——全字面量臂的枚举（1 | NaN 等，
    // DP 表 `d[i-1][j] + 1` 的典型值域）不会撞 Symbol/BigInt（issue #98）
    const members = (a.shape as { k: "sum"; members: Abs[] }).members;
    return members.some((m) => mayCoerceThrowOperand(m));
  }
  return (
    k === "any" ||
    k === "unknown" ||
    k === "obj" ||
    k === "fn" ||
    k === "brand"
  );
}

/**
 * TypedArray 家族表（brand 名 → 元素域 prim；BigInt64/BigUint64 是 bigint，
 * 其余 number，Float16Array 同 number）。单一事实源，三处消费：
 * - exec/runtime/containers.ts `$idx` 元素读投影（Uint8Array 下标 → number ∪
 *   undefined）；
 * - builtins/error.ts `makeTypedArrayAbs`（Bug 21 构造器 ToIndex 校验）与
 *   `evalTypedArrayStatic`（Bug 27 from/of 静态面，bigint 域 of 走 ToBigInt）；
 * - exec/runtime/containers.ts `NAMESPACE_GLOBALS`（静态面身份路由）。
 */
export const TYPED_ARRAY_ELEMENT: Record<string, "number" | "bigint"> = {
  Int8Array: "number",
  Uint8Array: "number",
  Uint8ClampedArray: "number",
  Int16Array: "number",
  Uint16Array: "number",
  Int32Array: "number",
  Uint32Array: "number",
  Float16Array: "number",
  Float32Array: "number",
  Float64Array: "number",
  BigInt64Array: "bigint",
  BigUint64Array: "bigint",
};

/**
 * TypedArray 家族名 → 元素域 prim；非家族名 → undefined */
export function typedArrayElementOf(name: string): "number" | "bigint" | undefined {
  return TYPED_ARRAY_ELEMENT[name];
}

/**
 * Bug 331：ToString 面「可能抛」判定（String() 全局函数专用档）。
 *
 * 与 mayCoerceThrowOperand（ToNumber/ToNumeric 面）**分档**：后者服务
 * ToNumber——obj/fn/brand 一律 may（原生 `Number(Object(Symbol()))` →
 * TypeError；用户 brand 的 valueOf 可能返 Symbol）。本档只服务 ToString：
 * 原生 `String()` 对**引擎已知的内建 brand** 的 ToString 行为是确定的
 * （Date → 本地化串、Map → "[object Map]"、TypedArray → join 串、Error →
 * "Error: …"）⇒ 不记 may；**未知** brand（用户类 / Proxy / 抽象泛型）
 * 保守记 may（其 toString 覆写体不可见）。
 *
 * obj 档：普通闭对象继承 Object.prototype.toString ⇒ 不抛（原生
 * `String({})` → "[object Object]"；node 实测 total）。自有 toString /
 * @@toPrimitive 槽 → 可能抛；open/index 形成员未知 → 保守 may。
 * null-proto 无 coercer 由调用方的**精确臂**（isNullProtoWithoutCoercer）
 * 定抛 TypeError，不在本判定内（已定抛 ⇒ 无需再记 may）。
 */
export function mayToStringThrowOperand(a: Abs | undefined): boolean {
  if (!a || a.term?.op === "lit") return false;
  const k = a.shape.k;
  if (k === "sum") {
    const members = (a.shape as { k: "sum"; members: Abs[] }).members;
    return members.some((m) => mayToStringThrowOperand(m));
  }
  if (k === "any" || k === "unknown") return true;
  if (k === "obj") return objHasToStringCoercer(a);
  if (k === "fn") return true; // 保守：Function.prototype.toString 对 Proxy 可抛
  if (k === "brand") return brandMayToStringThrow(a);
  return false;
}

/**
 * Bug 331：ToString 面上「自有 coercer 槽存在」的判定（obj 档）。
 * ToPrimitive(obj, string) 依次试 @@toPrimitive → toString → valueOf：
 * valueOf 单独存在**不**被 ToString 面读到（toString 先命中即 total），
 * 故只查前两者。
 */
function objHasToStringCoercer(a: Abs): boolean {
  const so = a.shape as {
    slots?: Record<string, unknown>;
    open?: boolean;
    index?: unknown;
  };
  if (so.open || so.index) return true;
  const slots = so.slots;
  if (!slots) return false;
  return (
    Object.prototype.hasOwnProperty.call(slots, "toString") ||
    Object.prototype.hasOwnProperty.call(slots, "@@toPrimitive")
  );
}

/**
 * Bug 331：ToString 面上 brand 档的判定。
 * - 自有 coercer 槽（用户给实例挂了 toString/@@toPrimitive）→ 可能抛；
 * - ".prototype" brand（原型对象自身，原生 toString 多为 brand check，
 *   如 Date.prototype / Symbol.prototype → 原生定抛）→ 保守 may；
 * - 用户注册的类（getEvalClass 命中）→ 其 toString 覆写体不可见 → may；
 * - 引擎已知的内建 brand → total（见 TOSTRING_TOTAL_BRANDS）。
 */
function brandMayToStringThrow(a: Abs): boolean {
  const s = a.shape as {
    name: string;
    shape?: { k: string; slots?: Record<string, unknown>; open?: boolean; index?: unknown };
  };
  const inner = s.shape;
  if (inner && inner.k === "obj") {
    const so = inner as { slots?: Record<string, unknown>; open?: boolean; index?: unknown };
    if (so.open || so.index) return true;
    const slots = so.slots;
    if (
      slots &&
      (Object.prototype.hasOwnProperty.call(slots, "toString") ||
        Object.prototype.hasOwnProperty.call(slots, "@@toPrimitive"))
    ) {
      return true;
    }
  }
  if (s.name.endsWith(".prototype")) return true;
  if (getEvalClass(s.name) !== undefined) return true;
  if (typedArrayElementOf(s.name) !== undefined) return false;
  return !TOSTRING_TOTAL_BRANDS.has(s.name);
}

/**
 * Bug 331：ToString 面 total 的内建 brand 名（实例 brand，非 ".prototype"）。
 * 逐个经原生 oracle 核对（node 实测 `String(x)` 不抛）：
 * Date/RegExp/Map/Set/WeakMap/WeakSet/ArrayBuffer/SharedArrayBuffer/DataView/
 * URL/URLSearchParams/TextDecoder/TextEncoder/WeakRef/FinalizationRegistry/
 * Arguments/Error 家族/装箱（String·Number·Boolean·BigInt）。
 * **不含** Symbol 箱（原生 `String(Object(Symbol("x")))` → TypeError：
 * Symbol.prototype[@@toPrimitive] 返回 symbol 原语 → ToString(symbol) 抛）
 * 与 Proxy（靶的 toString 不可判）。
 */
const TOSTRING_TOTAL_BRANDS: ReadonlySet<string> = new Set([
  "Date",
  "RegExp",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "URL",
  "URLSearchParams",
  "TextDecoder",
  "TextEncoder",
  "WeakRef",
  "FinalizationRegistry",
  "Arguments",
  "String",
  "Number",
  "Boolean",
  "BigInt",
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "EvalError",
  "URIError",
  "AggregateError",
]);


