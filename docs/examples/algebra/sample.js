// 示例 S：最小合集（无调用点、无 @nudo:case / @nudo:refine）
// 考察：entry@ 回退——无调用点的函数参数默认 unknown；intension / abs 行是
// unknown 形参的泛化签名（多分支时只显示回退路径），case 头为真值。
// 运行：pnpm run infer docs/examples/algebra/sample.js
//
// 输出（每段都带 '# no call sites found; parameters default to unknown'）：
//   add          Case "entry@": (unknown, unknown) => unknown
//     intension: add: (a: A1, b: A2) => number | string = (A1 + A2)
//     abs: number | string  = (A1 + A2)  #partial
//     —— 无契约时 + 跟真实 JS：number | string，不是 unknown
//   scale        (unknown) => number | string = (A1 + 1)
//   twice        (unknown) => number | `${string}1` = ((A1 + 1) + 1)
//   negate       (unknown) => number = (A1 * -1)  —— 乘法恒 number
//   createConfig (unknown) => { host: "localhost", port: 8080, debug: false }
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
