// 赋值结构：Abs leq
// 运行：pnpm run check docs/examples/structure/assign.js

let config = { host: "localhost", port: 8080 };

config = { host: "x", port: 1 };     // ok（宽度允许多余 key）
config = { host: "y" };              // error: assign-mismatch（缺 port）

let n = 1;
// n = "str";                         // error: prim number ⊭ string

let a = { x: 1 };
a = { x: 2, z: "s" };                // ok

export { config, n, a };
