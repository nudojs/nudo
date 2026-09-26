/**
 * E5 返回契约：声明 return positive 却返回 0。
 * pnpm run check docs/examples/errors/05-return-refine.js
 */
/// @nudo:import { positive } from "./delay.nudo.js"

/**
 * @nudo:contract return positive
 */
export function bad() {
  return 0; // error: 0 ⊭ return > 0
}

bad();
