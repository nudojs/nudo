// nudo check vs tsc — 同一段 JS，两边各自能抓住什么
// 运行：npx tsx packages/cli/src/index.ts check docs/examples/check-vs-ts/demo.js

// ① 约束前置：成功路径要求 x > 0
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}

// ② 结构使用：body 访问 p.id / p.name
function greet(user) {
  return "hi " + user.id + " " + user.name;
}

// ③ 赋值形状
let config = { host: "localhost", port: 8080 };

// --- 调用点 ---

setDelay(0);
// nudo: constraint-violated  (0 ⊭ x>0)
// tsc:   无注解 JS 下通常不报；加 checkJs 也只查 number 类型，不查 >0

setDelay(-50);
// nudo: constraint-violated
// tsc:   同上

greet({ id: 1 });
// nudo: arg-structure  (缺 name)
// tsc:   无 interface 时通常不报；有 interface 则报缺属性

greet({ id: 1, name: "a", extra: true });
// nudo: ok（宽度允许）
// tsc:   有 excess property check 时可能报 extra（对象字面量）

config = { host: "x" };
// nudo: assign-mismatch  (缺 port)
// tsc:   无注解时 inferred 为 {host: string, port: number}，赋值缺 port 会报

setDelay(100);
// nudo: ok
// tsc:   ok
