// 示例 C：reduce 累加器单 pass
// 考察：字面量路径逐元素累加 → 15 #exact；
// 符号路径对 element 一次应用（init + element）→ number #widened（非不动点迭代）
//
//   sum([1, 2, 3, 4, 5])   → 15      #exact
//   sum(array(number())) → number  #widened（intension 仍是 number | string）
//
// 注意：函数带手写 @nudo:case 后，调用点合成 case（call@）不再生成——两者互斥。

/**
 * @nudo:case "literal" ([1, 2, 3, 4, 5])
 * @nudo:case "symbolic" (array(number()))
 */
function sum(numbers) {
  return numbers.reduce((acc, n) => acc + n, 0);
}

export { sum };
