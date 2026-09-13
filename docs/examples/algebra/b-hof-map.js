// 示例 B：高阶函数自动多态
// 考察：generalize → ∀A B. (A[], A→B) → B[]；调用点实例化

function map(arr, fn) {
  const out = [];
  for (const item of arr) {
    out.push(fn(item));
  }
  return out;
}

map([1, 2, 3], (x) => x * 2);
map(["a", "b"], (s) => s.toUpperCase());

export { map };
