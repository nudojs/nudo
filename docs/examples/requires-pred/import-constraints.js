/// @nudo:import * as V from "./interface.nudo.js"

/**
 * @nudo:requires V.delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}

/**
 * @nudo:requires V.percent && n <= 100
 */
function pct(n) {
  if (n >= 0 && n <= 100) return n;
  return 0;
}

setDelay(0);     // error: 0 ⊭ ms>0（来自 interface.nudo.js）
setDelay(100);   // ok
pct(50);         // ok
// pct(150);     // error: 150 ⊭ n<=100（内联 && 片段）
