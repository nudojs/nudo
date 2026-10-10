/**
 * Abs builtin 共享原始值 / 小工具（内部）。不从 builtins.ts facade 再导出。
 */
import type { Abs } from "../abs.ts";
import { abs } from "../abs.ts";

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

/** TypedArray 家族名 → 元素域 prim；非家族名 → undefined */
export function typedArrayElementOf(name: string): "number" | "bigint" | undefined {
  return TYPED_ARRAY_ELEMENT[name];
}

