// tsc 对照：同一逻辑写成 TS 并加注解
// 运行：npx tsc --noEmit --strict docs/examples/check-vs-ts/demo.ts

function setDelay(ms: number): number {
  if (ms > 0) return ms;
  return 0;
}

interface User {
  id: number;
  name: string;
}

function greet(user: User): string {
  return "hi " + user.id + " " + user.name;
}

let config = { host: "localhost", port: 8080 };

// tsc 能抓到的：
setDelay(0);           // 类型 OK —— 不报「不满足 >0」
setDelay(-50);         // 类型 OK —— 不报

greet({ id: 1 });              // 报：缺 name（若写了 interface）
greet({ id: 1, name: "a", extra: true }); // 报：excess property extra

config = { host: "x" };        // 报：缺 port

setDelay(100);         // ok
