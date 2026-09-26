/**
 * Symbol 身份侧表：Symbol() 产生非具体 unique symbol（prim type=symbol，无 term）。
 * === 按 Abs 引用 / 侧表 id 判定，不把 description 折成可比较字面量身份。
 * 独立小模块：surface(strictEqAbs) 与 builtins(makeSymbolAbs) 共用，避免环。
 */

import type { Abs } from "./abs.ts";

export type SymbolMeta = { id: number; description: Abs };

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

export function isSymbolAbs(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "prim" && a.shape.type === "symbol";
}
