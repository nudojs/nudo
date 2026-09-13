// 约束场景 — Nudo 侧
// 运行：pnpm run check docs/examples/vs-ts/constraints/nudo.js

/// @nudo:import { delay } from "../../constraints/delay.nudo.js"

/**
 * @nudo:refine ms delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}

setDelay(0);      // nudo: constraint-violated
setDelay(-50);    // nudo: constraint-violated
setDelay(100);    // ok

export { setDelay };
