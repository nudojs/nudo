// 示例 G：守卫窄化（typeof / Array.isArray）
// 考察：分支条件按调用点逐位收窄——字符串 → x.length、数组 → x.length、
// 其余 → -1；Combined 保留字面量并（3 | 2 | -1）

function len(x) {
  if (typeof x === "string") return x.length;
  if (Array.isArray(x)) return x.length;
  return -1;
}

len("abc");   // 3
len([1, 2]);  // 2
len(5);       // -1

export { len };
