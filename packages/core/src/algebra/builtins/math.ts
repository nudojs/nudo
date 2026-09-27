/**
 * Math.* — 字面量实参走 ToNumber/ToInt32 后调用原生折叠，否则 number
 */
import type { Abs } from "../abs.ts";
import { numLit } from "../abs.ts";
import { numPrim } from "./shared.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";

/**
 * Math 算子实参：ToNumber（clz32/imul 走 ToInt32/ToUint32 由原生完成）。
 * 抽象 / lit(undefined) 不折叠——transpile 把 call spread 占位成 $lit(undefined)，
 * 折成 NaN 会把 `Math.max(...[1,2,3])` 钉成假精确。symbol/bigint 原生 TypeError。
 * 空实参（args 为空）由原生 ToNumber(undefined) 处理（min()→+Inf、abs()→NaN）。
 */
function coerceMathArg(a: Abs | undefined): number | undefined | "throw" {
  if (!a || a.term?.op !== "lit") return undefined;
  const v = a.term.value;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return 0;
  if (v === undefined) return undefined;
  // bigint/symbol：ToNumber 抛 TypeError
  return "throw";
}

/** Math 自有数值方法（排除继承的 constructor/toString/valueOf 等） */
function mathMethod(name: string): ((...a: number[]) => number) | undefined {
  if (!Object.hasOwn(Math, name)) return undefined;
  const impl = (Math as unknown as Record<string, unknown>)[name];
  return typeof impl === "function"
    ? (impl as (...a: number[]) => number)
    : undefined;
}

export function evalMathMethod(name: string, args: Abs[]): Abs | undefined {
  if (name === "random") return numPrim("path");

  const impl = mathMethod(name);
  if (!impl) return undefined;

  const nums: number[] = [];
  for (const a of args) {
    const n = coerceMathArg(a);
    if (n === undefined) return numPrim();
    if (n === "throw") throw new NudoThrow(errorTypeAbs("TypeError"));
    nums.push(n);
  }

  try {
    // 空实参：min()→+Inf、max()→-Inf、hypot()→0、abs()→NaN（ToNumber(undefined)）
    // 由原生自身处理，与 ToNumber 语义一致
    return numLit(impl(...nums));
  } catch {
    return numPrim();
  }
}
