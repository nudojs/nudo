// 示例 0：类型即计算（定义性示例）
// add 的类型是函数本身 (a,b)=>a+b，不是 (number,number)=>number
//
// add(1, 3)        → lit(4)                     #exact
// Φ: x > 0
// add(x, 1)        → term=x+1, pred: >1         #path
// twice(x)         → term=(x+1)+1, pred: >2     #path
//
// TS 在后两者只能给 number；Nudo 让约束参与运算。

const add = (a, b) => a + b;

add(1, 3);

function scale(x) {
  // 前置条件：x > 0
  return add(x, 1);
}

function twice(x) {
  // 前置条件：x > 0
  const c = add(x, 1); // c ↦ x+1, c>1
  return add(c, 1);    // (x+1)+1, >2
}

module.exports = { add, scale, twice };
