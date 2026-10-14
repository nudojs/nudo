/**
 * Symbol 身份侧表：Symbol() 产生非具体 unique symbol（prim type=symbol，无 term）。
 * === 按 Abs 引用 / 侧表 id 判定，不把 description 折成可比较字面量身份。
 * 独立小模块：surface(strictEqAbs) 与 builtins(makeSymbolAbs) 共用，避免环。
 */

import type { Abs } from "./abs.ts";

export type SymbolMeta = { id: number; description: Abs; abstractKey?: boolean };

const symbolMeta = new WeakMap<object, SymbolMeta>();
let symbolIdSeq = 0;

export function registerSymbolMeta(a: Abs, description: Abs): Abs {
  symbolMeta.set(a as object, { id: ++symbolIdSeq, description });
  return a;
}

export function symbolIdOf(a: Abs): number | undefined {
  return symbolMeta.get(a as object)?.id;
}

export function symbolDescriptionAbs(a: Abs): Abs | undefined {
  return symbolMeta.get(a as object)?.description;
}

/**
 * Bug 61：Symbol.for 抽象键驻留符号标记。键 ToString 不可判（开对象/
 * 抽象元素数组等）时以键 Abs 身份驻留：同 Abs 复用同一符号（=== 折
 * true，与原生「同值同串同符号」一致）；两个不同驻留符号的 === 原生
 * 不可判（各自键串可能相等）→ strictEqAbs 退化 unknown，不得折 false。
 */
export function markSymbolAbstractKey(a: Abs): Abs {
  const m = symbolMeta.get(a as object);
  if (m) m.abstractKey = true;
  return a;
}

export function isAbstractKeySymbol(a: Abs): boolean {
  return symbolMeta.get(a as object)?.abstractKey === true;
}

export function isSymbolAbs(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "prim" && a.shape.type === "symbol";
}
