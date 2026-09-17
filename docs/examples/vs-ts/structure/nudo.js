// 结构场景 — Nudo 侧
// 运行：pnpm run check docs/examples/vs-ts/structure/nudo.js
//
// 契约来自侧车 user.nudo.js（@nudo:refine user user），不是 body 扫描。

/// @nudo:import { user } from "./user.nudo.js"

/**
 * @nudo:refine u user
 */
function greet(u) {
  return "hi " + u.id + " " + u.name;
}

let config = { host: "localhost", port: 8080 };

greet({ id: 1 });                    // nudo: constraint-violated（契约缺 name）
greet({ id: 1, name: "a" });         // ok
greet({ id: 1, name: "a", extra: 1 }); // ok（宽度允许）

config = { host: "x" };              // nudo: assign-mismatch（缺 port）

export { greet, config };
