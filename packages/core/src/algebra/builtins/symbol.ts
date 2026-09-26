/**
 * Symbol 构造 / 描述 / 字符串化
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, strLit, unknown } from "../abs.ts";
import { registerSymbolMeta, symbolIdOf, symbolDescriptionAbs, isSymbolAbs as isSymAbs } from "../symbol-id.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { pTrue } from "../pred.ts";
import { numPrim, str, boolPrim } from "./shared.ts";

function undefLit(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: undefined as never }, pTrue, "exact");
}

/**
 * Symbol([description])：非具体 unique symbol（prim type=symbol，无 term）。
 * - 身份：侧表 id（两个 Symbol() 的 === 为 false；同 Abs 引用为 true）
 * - .description：字面量 string 或 undefined
 * - 不折成可比较的字面量身份（description 不作 identity）
 */
export function makeSymbolAbs(descArg?: Abs): Abs {
  let description: Abs;
  if (descArg === undefined) {
    description = undefLit();
  } else if (descArg.term?.op === "lit") {
    const v = descArg.term.value;
    if (v === undefined) description = undefLit();
    else if (typeof v === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
    else description = strLit(String(v));
  } else {
    // 抽象 description：ToString 结果未知（string 或 undefined）
    description = abs({ k: "prim", type: "string" }, undefined, undefined, "partial");
  }
  const a: Abs = {
    shape: { k: "prim", type: "symbol" },
    conf: "path",
  };
  return registerSymbolMeta(a, description);
}

export const isSymbolAbs = isSymAbs;
export { undefLit };
export { symbolIdOf, symbolDescriptionAbs };

function symbolDescriptiveString(a: Abs): string {
  const d = symbolDescriptionAbs(a);
  const dv = d ? litValue(d) : undefined;
  if (typeof dv === "string") return dv.length > 0 ? `Symbol(${dv})` : "Symbol()";
  return "Symbol()";
}

/** 全局 Symbol([desc])（$callNamed 身份校验后派发） */
export function evalSymbolCtor(args: Abs[]): Abs {
  return makeSymbolAbs(args[0]);
}

/** String(sym) → SymbolDescriptiveString（原生不抛；隐式 ToString 才抛） */
export function stringOfSymbol(a: Abs): Abs {
  const d = symbolDescriptionAbs(a);
  if (d) {
    // description 槽在：undefined 字面量 → "Symbol()"；string 字面量 → Symbol(desc)
    if (d.term?.op === "lit") return strLit(symbolDescriptiveString(a));
  }
  return str("path");
}
