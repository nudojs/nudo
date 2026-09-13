// 示例 E：索引签名与动态 key
// 考察：已知槽位字面量 key 精确投影；index 槽；动态 key 吸收

function pick(obj, key) {
  return obj[key];
}

pick({ a: 1, b: "x" }, "a");
pick({ a: 1, b: "x" }, "b");

// 概念上的 env：{ [k: string]: string }
// pick(env, "PATH") → string

export { pick };
