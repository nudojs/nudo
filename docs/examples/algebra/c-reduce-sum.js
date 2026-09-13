// 示例 C：reduce 累加器不动点
// 考察：字面量路径 exact；符号路径 acc ⊔ (acc+A) 不动点 → number

function sum(numbers) {
  return numbers.reduce((acc, n) => acc + n, 0);
}

sum([1, 2, 3, 4, 5]);
// 符号：sum(T.array(T.number)) → number #path

export { sum };
