// Pred 如何流入代数（add × requires）
// 形态：@nudo:requires <param> <constraint>
// 运行：
//   npx tsx packages/cli/src/index.ts check docs/examples/constraints/add-pred.js
//   npx tsx packages/cli/src/index.ts infer docs/examples/constraints/add-pred.js

/// @nudo:import { positive } from "./delay.nudo.js"

const add = (a, b) => a + b;

/**
 * @nudo:requires x positive
 */
function scale(x) {
  // x 带 Pred: self>0 实例化到 x → x>0
  // add(x, 1) → term=x+1, pred: (x+1)>1
  return add(x, 1);
}

/**
 * @nudo:requires x positive
 */
function twice(x) {
  const c = add(x, 1); // c ↦ x+1, c>1
  return add(c, 1);    // (x+1)+1, >2
}

add(1, 3);     // ok → 4 #exact
scale(100);    // ok
scale(-1);     // error: -1 ⊭ positive

// infer 期望（无契约时 shape 是 JS + 的并集，不是 number 也不是 unknown）：
//   add    → number | string = (A1 + A2)
//   scale  → 有 requires x>0 时：number = (x + 1)  where (x+1)>1
//   twice  → 有 requires x>0 时：number = ((x + 1) + 1)
// 无 requires 的 score(x){return x+1}：score("x") 合法，返回 "x1"

module.exports = { add, scale, twice };
