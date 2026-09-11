// requires × Pred × add —— 约束如何流入代数
// 契约来自 @nudo:requires，不从 if 猜前置。

const add = (a, b) => a + b;

/**
 * @nudo:requires x > 0
 */
function scale(x) {
  // 体内 x 已带 Pred: x>0
  // add(x, 1) → term=x+1, pred: (x+1)>1
  return add(x, 1);
}

/**
 * @nudo:requires x > 0
 */
function twice(x) {
  const c = add(x, 1); // c ↦ x+1, c>1
  return add(c, 1);    // (x+1)+1, >2
}

// --- 调用点 ---
add(1, 3);      // ok → 4 #exact（add 无 requires）
scale(100);     // ok
// scale(-1);   // error: -1 ⊭ x>0
// scale(0);    // error: 0 ⊭ x>0

module.exports = { add, scale, twice };
