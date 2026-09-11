// if 分支 ≠ 契约
// 无 requires：越界输入合法；有 requires：才检查
// 形态：@nudo:requires <param> <constraint>
// 运行：npx tsx packages/cli/src/index.ts check docs/examples/constraints/declared-vs-if.js

/// @nudo:import { delay } from "./delay.nudo.js"

function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

clamp(-5, 0, 10);   // ok —— clamp 的回退守卫不是调用前置
clamp(99, 0, 10);   // ok

/**
 * @nudo:requires ms delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}

setDelay(0);        // error: 0 ⊭ delay
setDelay(100);      // ok

module.exports = { clamp, setDelay };
