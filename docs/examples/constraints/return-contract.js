// 返回值契约：@nudo:contract return <constraint>
// 与 @nudo:contract（前置）对偶；契约仍来自 .nudo.js 模板
// 运行：pnpm run check docs/examples/constraints/return-contract.js

/// @nudo:import { positive, percent } from "./delay.nudo.js"

/**
 * @nudo:contract x positive
 * @nudo:contract return positive
 */
function inc(x) {
  return x + 1;
}

/**
 * @nudo:contract return percent
 */
function pct(n) {
  if (n >= 0 && n <= 100) return n;
  return 0;
}

/**
 * @nudo:contract return positive
 */
function bad() {
  return 0; // error: return value ⊭ @nudo:contract return positive
}

inc(1);     // ok
// inc(-1); // error: 前置
pct(50);    // ok

export { inc, pct, bad };
