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
  return (
    k === "any" ||
    k === "unknown" ||
    k === "obj" ||
    k === "fn" ||
    k === "brand" ||
    k === "sum"
  );
}

