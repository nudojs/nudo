// 示例 S：最小合集（无 @nudo:case / @nudo:contract）
// 考察：调用点见证优先、无调用点时回落 entry@——无约束形参默认 any（无约束）；
//       unknown = 推导失败
// 运行：pnpm run check docs/examples/algebra/sample.js
//       pnpm run test:cli docs/examples/algebra/sample.js
//
// 输出（test:cli）：
//   add          call@L19  (any, 1) => number | string
//     —— add 被 scale / twice 在**导出函数体内**调用 ⇒ 合成 call@ 见证
//        （实参取调用现场：第二个实参是字面量 1；第一个仍无约束 any）
//   scale        entry@L18  (any) => number | string   throws TypeError
//   twice        entry@L22  (any) => number | string   throws TypeError
//   negate       entry@L27  (any) => number   throws TypeError
//   createConfig entry@L31  (any) => { host: "localhost", port: 8080, debug: false }
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
