// 结构场景 — Nudo 侧
// 运行：npx tsx packages/cli/src/index.ts check docs/examples/vs-ts/structure/nudo.js

function greet(user) {
  return "hi " + user.id + " " + user.name;
}

let config = { host: "localhost", port: 8080 };

greet({ id: 1 });                    // nudo: arg-structure（缺 name，从 body 推出）
greet({ id: 1, name: "a" });         // ok
greet({ id: 1, name: "a", extra: 1 }); // ok（宽度允许）

config = { host: "x" };              // nudo: assign-mismatch（缺 port）

module.exports = { greet, config };
