// 唯一 refine 形态：@nudo:contract <param> <constraint>
// 约束必须来自 .nudo.js 模板，不在 refine 里写 x > 0
// 运行：pnpm run check docs/examples/constraints/set-delay.js

/// @nudo:import { delay, percent, positive } from "./delay.nudo.js"

/**
 * @nudo:contract ms delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}

/**
 * @nudo:contract n percent
 */
function pct(n) {
  if (n >= 0 && n <= 100) return n;
  return 0;
}

/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  return x;
}

setDelay(100);      // ok
setDelay(0);        // error: 0 ⊭ delay
pct(50);            // ok
// pct(150);        // error
needsPositive(5);   // ok
needsPositive(0);   // error: 0 ⊭ positive

export { setDelay, pct, needsPositive };
