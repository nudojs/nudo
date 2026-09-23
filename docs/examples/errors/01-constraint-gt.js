/**
 * E1 算术约束：TS 的 number 拦不住 0；Nudo 的 gt(0) 在调用点拦。
 * pnpm run check docs/examples/errors/01-constraint-gt.js
 */
/// @nudo:import { delay } from "./delay.nudo.js"

/**
 * @nudo:refine ms delay
 */
export function setDelay(ms) {
  return ms;
}

setDelay(250); // ok
setDelay(0);   // error: 0 ⊭ ms > 0
