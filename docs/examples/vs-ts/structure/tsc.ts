// 结构场景 — tsc 侧（需 interface）
// 运行：pnpm exec tsc --noEmit --strict docs/examples/vs-ts/structure/tsc.ts

interface User {
  id: number;
  name: string;
}

function greet(user: User): string {
  return "hi " + user.id + " " + user.name;
}

let config = { host: "localhost", port: 8080 };

greet({ id: 1 });                    // tsc: 报缺 name
greet({ id: 1, name: "a" });         // ok
greet({ id: 1, name: "a", extra: 1 }); // tsc: excess property extra

config = { host: "x" };              // tsc: 报缺 port

export { greet, config };
