// 示例 H：数组方法精度边界
// 考察：已建模侧（reduce / map / forEach / some）逐字面量精确；
// 与 e-index-proj 的动态 key 边界同源（动态 key 仍 unknown）
//
// 逐 case 真值（infer 输出）：
//   sum([1, 2, 3, 4, 5])        → 15      #exact（reduce 累加器不动点）
//   forEachSum([1, 2, 3, 4, 5]) → 15      #exact（forEach 回调副作用写回 s）
//   someBig([1, 2, 3, 4, 5])    → boolean #exact（some 建模为 boolean）
//
// 边界形态（写算法前先查这张表，避免依赖未建模方法）：
//   已建模：arr.map(cb) / arr.reduce(cb, init) / forEach 副作用 / some / every
//   未建模：动态 key 投影 / 手写循环里 fn(item) 返回值

/**
 * @nudo:case "reduce" ([1, 2, 3, 4, 5])
 */
function sum(numbers) {
  return numbers.reduce((acc, n) => acc + n, 0);
}

/**
 * @nudo:case "forEach" ([1, 2, 3, 4, 5])
 */
function forEachSum(arr) {
  let s = 0;
  arr.forEach((x) => { s = s + x; });
  return s;
}

/**
 * @nudo:case "some" ([1, 2, 3, 4, 5])
 */
function someBig(arr) {
  return arr.some((x) => x > 3);
}

export { sum, forEachSum, someBig };
