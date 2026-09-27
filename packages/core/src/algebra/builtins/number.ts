/**
 * Number.* 静态方法 + parseInt 折叠
 */
import type { Abs } from "../abs.ts";
import { litValue, numLit, boolLit } from "../abs.ts";
import { numPrim, str, boolPrim } from "./shared.ts";

export function foldParseInt(s: string | number, radix: number | undefined): Abs {
  const str = String(s);
  if (radix === undefined) return numLit(parseInt(str));
  // 原生对 radix 做 ToInt32 截断：2.9 → 2、NaN → 0；
  // 截断后为 0 视为「未提供」（0x 前缀生效），越界 → NaN
  const r = radix | 0;
  if (r === 0) return numLit(parseInt(str));
  if (r < 2 || r > 36) return numLit(NaN);
  return numLit(parseInt(str, r));
}

/** Number.isInteger / isNaN / parseFloat 等 */
export function evalNumberStatic(name: string, args: Abs[]): Abs | undefined {
  const a0Arg = args[0];
  const a0 = a0Arg ? litValue(a0Arg) : undefined;
  /**
   * Number.isInteger / Number.isNaN / Number.isFinite 不做 ToNumber：
   * 非 number（含缺省实参、undefined/null/bool/string/bigint）恒 false。
   * 仅当实参为具体字面量时折叠；抽象实参保持 boolPrim。
   */
  const foldStrictNumberPred = (
    pred: (n: number) => boolean,
  ): Abs | undefined => {
    if (!a0Arg) return boolLit(false);
    if (a0Arg.term?.op !== "lit") return undefined;
    const v = a0Arg.term.value;
    return boolLit(typeof v === "number" && pred(v));
  };
  switch (name) {
    case "isInteger":
      return foldStrictNumberPred(Number.isInteger) ?? boolPrim();
    case "isNaN":
      return foldStrictNumberPred(Number.isNaN) ?? boolPrim();
    case "isFinite":
      return foldStrictNumberPred(Number.isFinite) ?? boolPrim();
    case "parseInt":
      if (typeof a0 === "string" || typeof a0 === "number") {
        const radix = args[1] ? litValue(args[1]) : undefined;
        if (radix === undefined) return foldParseInt(a0, undefined);
        if (typeof radix === "number") return foldParseInt(a0, radix);
        return numPrim();
      }
      return numPrim();
    case "parseFloat":
      if (typeof a0 === "string" || typeof a0 === "number") return numLit(parseFloat(String(a0)));
      return numPrim();
    case "MAX_SAFE_INTEGER":
      return numLit(Number.MAX_SAFE_INTEGER);
    default:
      return undefined;
  }
}

