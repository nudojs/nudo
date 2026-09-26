/**
 * Abs builtin 共享原始值 / 小工具（内部）。不从 builtins.ts facade 再导出。
 */
import type { Abs } from "../abs.ts";
import { abs } from "../abs.ts";

export const noBody = { type: "BlockStatement", body: [], directives: [] } as never;

export function numPrim(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "number" }, undefined, undefined, conf);
}

export function str(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "string" }, undefined, undefined, conf);
}

export function boolPrim(conf: Abs["conf"] = "partial"): Abs {
  return abs({ k: "prim", type: "boolean" }, undefined, undefined, conf);
}

/** brand 是编译期标签，运行时仍是底层值；isArray 须看穿 */
export function peelBrand(shape: Abs["shape"]): Abs["shape"] {
  let s = shape;
  while (s.k === "brand") s = s.shape.shape;
  return s;
}

/** 非对象形态（prim/never/null/undefined 字面量）→ ES 不变性自省恒真/假 */
export function isPrimLike(a: Abs | undefined): boolean {
  if (!a) return true; // 无实参 → undefined
  if (a.shape.k === "prim" || a.shape.k === "never") return true;
  if (a.term?.op === "lit" && (a.term.value === null || a.term.value === undefined)) {
    return true;
  }
  return false;
}

