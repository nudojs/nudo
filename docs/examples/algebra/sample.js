// 示例 S：最小合集（无调用点、无 @nudo:case / @nudo:refine）
// 考察：entry@ 回退——无调用点的函数参数默认 any（无约束）；unknown = 推导失败
// 运行：pnpm run check docs/examples/algebra/sample.js
//       pnpm run test:cli docs/examples/algebra/sample.js
//
// 输出（test:cli）：
//   add          Case "entry@": (any, any) => any
//     intension: add: (a: A1, b: A2) => number | string = (A1 + A2)
//     abs: number | string  = (A1 + A2)  #partial
//     —— 无契约时 + 跟真实 JS：number | string
//   scale        (any) => number | string = (A1 + 1)
//   twice        (any) => number | `${string}1` = ((A1 + 1) + 1)
//   negate       (any) => number = (A1 * -1)  —— 乘法恒 number
//   createConfig (any) => { host: "localhost", port: 8080, debug: false }
//     —— unknown spread 得空形状：只剩默认槽位（与 a-spread-optional.js 对照）
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

export { add, scale, twice, negate, createConfig };
