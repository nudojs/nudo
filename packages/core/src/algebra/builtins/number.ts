/**
 * Number.* 静态方法 + parseInt/parseFloat 折叠
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, numLit, boolLit } from "../abs.ts";
import { numPrim, str, boolPrim, mayCoerceThrowOperand, isBigintPrimAbs } from "./shared.ts";
import { isSymbolAbs } from "./symbol.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";

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
  // Bug 26：shape 先于 lit——prim symbol（Symbol() 产物，无 lit 项）ToString
  // 恒抛 TypeError（lit 分支的 typeof symbol 是防御性死代码）
  if (isSymbolAbs(a)) throw new NudoThrow(errorTypeAbs("TypeError"));
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
  // Bug 45：shape 先于 lit——prim symbol/bigint（无 lit 项）ToInt32 前的
  // ToNumber 恒抛 TypeError；抽象（any/obj/…）由调用方 may 打点
  if (isSymbolAbs(a) || isBigintPrimAbs(a)) throw new NudoThrow(errorTypeAbs("TypeError"));
  if (a.term?.op !== "lit") return { ok: false };
  const v = a.term.value;
  if (typeof v === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (v === undefined) return { ok: true, v: undefined };
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean" || v === null) {
    return { ok: true, v };
  }
  // Bug 45：bigint 字面量 radix——ToNumber(1n) 恒抛 TypeError
  //（node 实测 Number.parseInt("1", 1n) → TypeError）
  throw new NudoThrow(errorTypeAbs("TypeError"));
}

/** Number.isInteger / isNaN / parseFloat 等 */
export function evalNumberStatic(name: string, args: Abs[]): Abs | undefined {
  const a0Arg = args[0];
  const a0R = a0Arg ? litValue(a0Arg) : undefined;
  const a0 = a0R?.ok ? a0R.value : undefined;
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
    // Bug 1：与 isInteger 同族同款（env 声明被硬编码派发表遮蔽）——非
    // number 实参恒 false，字面量精确折叠，抽象保持 boolPrim
    case "isSafeInteger":
      return foldStrictNumberPred(Number.isSafeInteger) ?? boolPrim();
    case "isNaN": {
      const folded = foldStrictNumberPred(Number.isNaN);
      if (folded) return folded;
      // 抽象实参：挂 eq(term, NaN) —— $fork 真臂进 Φ，假臂 negate 成 ne(term, NaN)
      // （min/max 据此排除 NaN 臂，见 #68 clamp 证明）
      if (a0Arg?.term) {
        return abs(
          { k: "prim", type: "boolean" },
          undefined,
          { op: "eq", a: a0Arg.term, b: { op: "lit", value: NaN } },
          "path",
        );
      }
      return boolPrim();
    }
    case "isFinite":
      return foldStrictNumberPred(Number.isFinite) ?? boolPrim();
    case "parseInt": {
      // 缺省首参 ≡ undefined：ToString(undefined)="undefined" → NaN
      const s = toStringLitArg(a0Arg);
      if (!s.lit) {
        // Bug 26：抽象首参（any/obj/…）ToPrimitive 可能成 Symbol → may
        if (mayCoerceThrowOperand(a0Arg)) {
          recordMayThrow({ kind: "TypeError", cause: "Number.parseInt argument ToString may throw (Symbol)" });
        }
        return numPrim();
      }
      const radix = radixLitArg(args[1]);
      if (!radix.ok) {
        // Bug 45：抽象 radix（any/obj/…）ToNumber may TypeError
        if (mayCoerceThrowOperand(args[1])) {
          recordMayThrow({ kind: "TypeError", cause: "Number.parseInt radix ToNumber may throw (Symbol/BigInt)" });
        }
        return numPrim();
      }
      return foldParseInt(s.v, radix.v);
    }
    case "parseFloat": {
      const s = toStringLitArg(a0Arg);
      if (!s.lit) {
        // Bug 26：抽象首参 ToPrimitive 可能成 Symbol → may
        if (mayCoerceThrowOperand(a0Arg)) {
          recordMayThrow({ kind: "TypeError", cause: "Number.parseFloat argument ToString may throw (Symbol)" });
        }
        return numPrim();
      }
      return foldParseFloat(s.v);
    }
    case "MAX_SAFE_INTEGER":
      return numLit(Number.MAX_SAFE_INTEGER);
    default:
      return undefined;
  }
}
