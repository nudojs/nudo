// 示例：类型即计算
const add = (a, b) => a + b;

function scale(x) {
  return add(x, 1);
}

function twice(x) {
  const c = add(x, 1);
  return add(c, 1);
}

function negate(x) {
  return x * -1;
}

function createConfig(options) {
  return {
    host: "localhost",
    port: 8080,
    debug: false,
    ...options,
  };
}

module.exports = { add, scale, twice, negate, createConfig };
