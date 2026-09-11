// 无 @nudo:requires：if 分支不构成调用前置
// clamp 的越界输入是合法的

function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

clamp(-5, 0, 10);   // ok —— 不是违例
clamp(99, 0, 10);   // ok

// 对比：声明了 requires 才会检查
/**
 * @nudo:requires ms > 0
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}

setDelay(0);        // error: 0 ⊭ ms>0
setDelay(100);      // ok
