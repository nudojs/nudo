/**
 * E10 多约束同文件：每个违例都带 actual/expected + fix: contract --draft。
 * pnpm run check docs/examples/errors/10-fix-path.js
 */
/// @nudo:import { delay, positive } from "./delay.nudo.js"

/**
 * @nudo:contract ms delay
 */
export function arm(ms) {
  return ms;
}

/**
 * @nudo:contract x positive
 */
export function bump(x) {
  return x + 1;
}

arm(30);  // ok
bump(2);  // ok
arm(-1);  // error
bump(0);  // error
