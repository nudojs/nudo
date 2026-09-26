/**
 * String.fromCharCode 等静态方法
 */
import type { Abs } from "../abs.ts";
import { strLit } from "../abs.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { str } from "./shared.ts";
import { isSymbolAbs } from "./symbol.ts";

function toUint16(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const int = Math.trunc(n);
  return ((int % 65536) + 65536) % 65536;
}

/**
 * String.fromCharCode(...)：
 * - 全部字面量 → 按 ToUint16 折成精确字符串（含越界/非整数/数字字符串）
 * - symbol 字面量 → TypeError（ToNumber 抛）
 * - 任一抽象实参 → 抽象 string（不假精确）
 */
export function evalStringStatic(name: string, args: Abs[]): Abs | undefined {
  if (name !== "fromCharCode") return undefined;
  const codes: number[] = [];
  for (const a of args) {
    if (isSymbolAbs(a)) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (a.term?.op !== "lit") return str("path");
    const v = a.term.value;
    if (typeof v === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
    if (typeof v === "number") {
      codes.push(toUint16(v));
      continue;
    }
    if (typeof v === "string" || typeof v === "boolean" || v === null) {
      codes.push(toUint16(Number(v)));
      continue;
    }
    if (typeof v === "bigint") throw new NudoThrow(errorTypeAbs("TypeError"));
    // undefined / 其它：ToNumber(undefined)=NaN → 0
    codes.push(0);
  }
  return strLit(String.fromCharCode(...codes));
}
