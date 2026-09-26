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
  const a0 = args[0] ? litValue(args[0]) : undefined;
  switch (name) {
    case "isInteger":
      if (typeof a0 === "number") return boolLit(Number.isInteger(a0));
      return boolPrim();
    case "isNaN":
      if (typeof a0 === "number") return boolLit(Number.isNaN(a0));
      return boolPrim();
    case "isFinite":
      if (typeof a0 === "number") return boolLit(Number.isFinite(a0));
      return boolPrim();
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

