// 返回值契约：@nudo:refine return <constraint>
// 与 @nudo:refine（前置）对偶；契约仍来自 .nudo.js 模板
// 运行：npx tsx packages/cli/src/index.ts check docs/examples/constraints/return-contract.js

/// @nudo:import { positive, percent } from "./delay.nudo.js"

/**
 * @nudo:refine x positive
 * @nudo:refine return positive
 */
function inc(x) {
  return x + 1;
}

/**
 * @nudo:refine return percent
 */
function pct(n) {
  if (n >= 0 && n <= 100) return n;
  return 0;
}

/**
 * @nudo:refine return positive
 */
function bad() {
  return 0; // error: 返回值 ⊭ @nudo:refine return positive
}

inc(1);     // ok
// inc(-1); // error: 前置
pct(50);    // ok

module.exports = { inc, pct, bad };
