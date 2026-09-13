// 示例 C：reduce 累加器不动点
// 考察：符号路径 acc ⊔ (acc+A) 收敛到 number（widened，不动点吸收字面量）；
// 字面量路径逐元素累加 → 15（见底部注释，需无手写 case 的调用点形态）
//
//   sum(T.array(T.number))  → number  #widened（intension 仍是 number | string = (A1 + A2)）
//   字面量形态（去掉 @nudo:case 后）：sum([1, 2, 3, 4, 5]) → 15  #exact
//
// 注意：函数带手写 @nudo:case 后，调用点合成 case（call@）不再生成——两者互斥。

/**
 * @nudo:case "symbolic" (T.array(T.number))
 */
function sum(numbers) {
  return numbers.reduce((acc, n) => acc + n, 0);
}

export { sum };
