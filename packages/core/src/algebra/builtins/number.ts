/**
 * Number.* 静态方法 + parseInt/parseFloat 折叠
 */
import type { Abs } from "../abs.ts";
import { litValue, numLit, boolLit } from "../abs.ts";
import { numPrim, str, boolPrim } from "./shared.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";

/**
 * parseInt(s[, radix])：首参 ToString，radix ToInt32（截断后 0 视为未提供，越界 NaN）。
 * radix 可为 number/string/bool/null 字面量（'2'→2、true→1 越界 NaN、null/false→0）。
 */
export function foldParseInt(
  s: string | number | boolean | null | bigint | undefined,
  radix: number | string | boolean | null | undefined,
): Abs {
  const str = String(s);
  if (radix === undefined) return numLit(parseInt(str));
  // 原生对 radix 做 ToInt32 截断：2.9 → 2、true → 1、"2" → 2、null/false/""/NaN → 0；
  // 截断后为 0 视为「未提供」（0x 前缀生效），越界 → NaN
  const r = Number(radix) | 0;
  if (r === 0) return numLit(parseInt(str));
  if (r < 2 || r > 36) return numLit(NaN);
  return numLit(parseInt(str, r));
}

/** parseFloat(s)：ToString 后解析（true→NaN、null→NaN、5n→5） */
export function foldParseFloat(
  s: string | number | boolean | null | bigint | undefined,
): Abs {
  return numLit(parseFloat(String(s)));
}

type ToStringLit = string | number | boolean | null | bigint | undefined;

/**
 * 取可 ToString 的字面量。返回 {lit:true, v} / {lit:false}（抽象）。
 * symbol 原生 TypeError。lit(undefined) 与缺省实参都是合法 ToString 输入
 * （缺省 ≡ undefined → String(undefined)="undefined"）。
 */
function toStringLitArg(a: Abs | undefined): { lit: true; v: ToStringLit } | { lit: false } {
  if (!a) return { lit: true, v: undefined };
  if (a.term?.op !== "lit") return { lit: false };
  const v = a.term.value;
  if (typeof v === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
  return { lit: true, v: v as ToStringLit };
}

/**
 * radix 字面量（number/string/bool/null 可 ToInt32）。
 * 返回 {ok:true, v} / {ok:false}（抽象）/ {ok:true, v:undefined}（无 radix 或 lit(undefined)→未提供）。
 */
function radixLitArg(a: Abs | undefined): { ok: true; v: number | string | boolean | null | undefined } | { ok: false } {
  if (!a) return { ok: true, v: undefined };
  if (a.term?.op !== "lit") return { ok: false };
  const v = a.term.value;
  if (typeof v === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (v === undefined) return { ok: true, v: undefined };
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean" || v === null) {
    return { ok: true, v };
  }
  return { ok: false };
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
    case "parseInt": {
      // 缺省首参 ≡ undefined：ToString(undefined)="undefined" → NaN
      const s = toStringLitArg(a0Arg);
      if (!s.lit) return numPrim();
      const radix = radixLitArg(args[1]);
      if (!radix.ok) return numPrim();
      return foldParseInt(s.v, radix.v);
    }
    case "parseFloat": {
      const s = toStringLitArg(a0Arg);
      if (!s.lit) return numPrim();
      return foldParseFloat(s.v);
    }
    case "MAX_SAFE_INTEGER":
      return numLit(Number.MAX_SAFE_INTEGER);
    default:
      return undefined;
  }
}
