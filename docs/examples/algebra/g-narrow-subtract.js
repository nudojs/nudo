// 示例 G：守卫窄化（meet / subtract）
// 考察：typeof / Array.isArray 分支环境；结果 join 吸收

function len(x) {
  if (typeof x === "string") return x.length;
  if (Array.isArray(x)) return x.length;
  return -1;
}

// len(T.union(T.string, T.number, T.array(T.number)))
// → number #path  （lit(-1) 被 number 吸收）

export { len };
