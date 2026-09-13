// 示例 B：高阶函数自动多态
// 考察：回调经内置 .map 传播；调用点逐位实例化 → [2, 4, 6] / ["A", "B"]

function map(arr, fn) {
  return arr.map(fn);
}

map([1, 2, 3], (x) => x * 2);
map(["a", "b"], (s) => s.toUpperCase());

export { map };
