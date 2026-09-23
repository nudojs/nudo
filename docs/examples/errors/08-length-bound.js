/**
 * E8 数组/串长度界：TS 的 string[] / string 拦不住空串与错元素。
 * pnpm run check docs/examples/errors/08-length-bound.js
 */
/// @nudo:import { name1 } from "./delay.nudo.js"

/**
 * @nudo:refine s name1
 */
export function tag(s) {
  return "[" + s + "]";
}

tag("ok");  // ok
tag("");    // error: "" ⊭ min length 1
