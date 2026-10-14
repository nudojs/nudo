/**
 * String.fromCharCode 等静态方法
 */
import type { Abs } from "../abs.ts";
import { strLit, litValue } from "../abs.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { str, mayCoerceThrowOperand, isBigintPrimAbs } from "./shared.ts";
import { isSymbolAbs } from "./symbol.ts";

function toUint16(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const int = Math.trunc(n);
  return ((int % 65536) + 65536) % 65536;
}

/**
 * String.fromCharCode / String.fromCodePoint：
 * - fromCharCode：全部字面量 → 按 ToUint16 折成精确字符串（含越界/非整数/
 *   数字字符串）；symbol 字面量 → TypeError（ToNumber 抛）；任一抽象实参 →
 *   抽象 string（不假精确）
 * - fromCodePoint（Bug 38）：字面量过 ToNumber 后 IsValidCodePoint 校验
 *   （node v26 实测：非整数/NaN/±∞/<0/>0x10FFFF → RangeError "Invalid
 *   code point"；null/""/false → 0 合法；"65" → 65；surrogate 0xD800 合法）；
 *   symbol/bigint 的 ToNumber → TypeError（fromCodePoint(1n) 原生抛，区别
 *   于 fromCharCode 的 ToUint16 面——bigint ToString 合法但 ToNumber 抛）；
 *   抽象实参 → may RangeError（+ symbol 载体 may TypeError）+ str("path")
 */
export function evalStringStatic(name: string, args: Abs[]): Abs | undefined {
  if (name === "raw") {
    // Bug 12：String.raw`a${x}b` —— transpile 编 args[0] 为 $tpl 模板对象
    // （raw 槽 = 字符串字面量元组），args[1:] 为 substitutions。
    // GetTemplateObject 外的手写对象（raw 数组）同语义；quasis+subs 全
    // 字面量 → 精确拼接（sub 经 ToString，symbol 定抛 TypeError）；
    // 任一抽象 → str("path")。
    const tpl = args[0];
    if (!tpl || tpl.shape.k !== "obj") return undefined;
    const rawAbs = tpl.shape.slots["raw"]?.value;
    const raws: string[] = [];
    if (rawAbs && rawAbs.shape.k === "tuple") {
      for (const el of rawAbs.shape.elements) {
        const eR = litValue(el);
        if (!(eR.ok && typeof eR.value === "string")) return str("path");
        raws.push(eR.value);
      }
    } else {
      return str("path"); // raw 槽缺失/非字面量数组：保守
    }
    let out = "";
    for (let i = 0; i < raws.length; i++) {
      out += raws[i]!;
      // 末尾 raw 片后不再拼接；超出 raw 片数的 sub 原生忽略
      if (i + 1 >= raws.length) break;
      if (i >= args.length - 1) continue;
      const sub = args[i + 1]!;
      if (isSymbolAbs(sub)) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (sub.term?.op !== "lit") {
        if (mayCoerceThrowOperand(sub)) {
          recordMayThrow({ kind: "TypeError", cause: "String.raw substitution ToString may throw (Symbol)" });
        }
        return str("path");
      }
      const sv = sub.term.value;
      if (typeof sv === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
      out += String(sv);
    }
    return strLit(out);
  }
  if (name === "fromCodePoint") {
    if (args.length === 0) return strLit(""); // fromCodePoint() → ""
    const codes: number[] = [];
    let abstract = false;
    for (const a of args) {
      // shape-first：symbol prim（Symbol() 产物，无 lit 项）→ ToNumber 定抛
      if (isSymbolAbs(a)) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (isBigintPrimAbs(a)) throw new NudoThrow(errorTypeAbs("TypeError")); // ToNumber(bigint) 定抛
      if (a.term?.op !== "lit") {
        // 抽象实参：symbol/bigint 载体（any/obj/fn/brand/sum）may TypeError；
        // 一切抽象值 may RangeError（越界/非整数）。值域保守 str("path")
        if (mayCoerceThrowOperand(a)) {
          recordMayThrow({ kind: "TypeError", cause: "String.fromCodePoint ToNumber may throw (Symbol/BigInt)" });
        }
        recordMayThrow({ kind: "RangeError", cause: "String.fromCodePoint code point may be invalid" });
        abstract = true;
        continue;
      }
      const v = a.term.value;
      if (typeof v === "symbol" || typeof v === "bigint") {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // ToNumber：number/string/boolean/null/undefined（null→0、undefined→NaN、
      // ""→0、"abc"→NaN、true→1）
      const n =
        v === undefined ? NaN : v === null ? 0 : typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) {
        throw new NudoThrow(errorTypeAbs("RangeError")); // Invalid code point
      }
      codes.push(n);
    }
    if (abstract) return str("path");
    return strLit(String.fromCodePoint(...codes));
  }
  if (name !== "fromCharCode") return undefined;
  const codes: number[] = [];
  for (const a of args) {
    if (isSymbolAbs(a)) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (a.term?.op !== "lit") {
      // Bug 11：抽象实参（any/obj/fn/brand/sum）may ToNumber 抛（symbol/
      // bigint 载体，同 fromCodePoint 口径）。值域上 fromCharCode 对
      // ToNumber 结果全定（ToUint16 截断），无 RangeError 臂
      if (mayCoerceThrowOperand(a)) {
        recordMayThrow({ kind: "TypeError", cause: "String.fromCharCode ToNumber may throw (Symbol/BigInt)" });
      }
      return str("path");
    }
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
