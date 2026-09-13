// if 分支 ≠ 契约
// 无 refine：越界输入合法；有 refine：才检查
// 形态：@nudo:refine <param> <constraint>
// 运行：pnpm run check docs/examples/constraints/declared-vs-if.js

/// @nudo:import { delay } from "./delay.nudo.js"

function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

clamp(-5, 0, 10);   // ok —— clamp 的回退守卫不是调用前置
clamp(99, 0, 10);   // ok

/**
 * @nudo:refine ms delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}

setDelay(0);        // error: 0 ⊭ delay
setDelay(100);      // ok

export { clamp, setDelay };
