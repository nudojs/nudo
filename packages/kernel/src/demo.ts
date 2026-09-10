/**
 * 端到端演示：从真实 JS 源码推出 term 与约束。
 * 运行：npx tsx packages/kernel/src/demo.ts
 */
import {
  analyzeFn,
  numLit,
  numVar,
  gtNum,
  v,
  termToString,
  predToString,
  absToString,
  litValue,
} from "./index.ts";

function show(label: string, a: ReturnType<typeof numLit>): void {
  const bits = [absToString(a)];
  if (a.term) bits.push(`  term: ${termToString(a.term)}`);
  if (a.pred && a.pred.op !== "true") bits.push(`  pred: ${predToString(a.pred)}`);
  console.log(`${label}\n  ${bits.join("\n  ")}\n`);
}

const ADD_SRC = `
const add = (a, b) => a + b;
function scale(x) {
  return add(x, 1);
}
function twice(x) {
  const c = add(x, 1);
  return add(c, 1);
}
function sum3(a, b, c) {
  return add(add(a, b), c);
}
`;

console.log("=== 类型即计算：从 JS 源码抽象求值 ===\n");
console.log("源码：");
console.log(ADD_SRC.trim());
console.log("");

show("add(1, 3)", analyzeFn(ADD_SRC, "add", [numLit(1), numLit(3)]));

const phi = gtNum(v("x"), 0);
const x = numVar("x", gtNum(v("x"), 0));

show("scale(x)  where Φ: x > 0", analyzeFn(ADD_SRC, "scale", [x], phi));
show("twice(x)  where Φ: x > 0", analyzeFn(ADD_SRC, "twice", [x], phi));

const phi2 = gtNum(v("a"), 0);
const a = numVar("a", gtNum(v("a"), 0));
show(
  "sum3(a, 1, 2)  where Φ: a > 0",
  analyzeFn(ADD_SRC, "sum3", [a, numLit(1), numLit(2)], phi2),
);

const GUARD_SRC = `
function clampPositive(x) {
  if (x > 0) return x;
  return 0;
}
function addOneIfPositive(x) {
  if (x > 0) return x + 1;
  return 0;
}
`;

console.log("--- 守卫与分支 ---\n");
show(
  "addOneIfPositive(x)  where Φ: x > 0  (true 分支)",
  analyzeFn(GUARD_SRC, "addOneIfPositive", [x], phi),
);

const MUL_SRC = `
function negate(x) {
  return x * -1;
}
`;

console.log("--- 负数乘法翻转 ---\n");
show("negate(x)  where Φ: x > 0  ⇒ 应 < 0", analyzeFn(MUL_SRC, "negate", [x], phi));

console.log("结论：TS 对后几项只能给 number；Nudo 从源码算出 term 与约束。");
