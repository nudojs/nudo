// 传参结构：body 访问 p.foo → 实参必填 slot
// 运行：npx tsx packages/cli/src/index.ts check docs/examples/structure/arg-structure.js

function readXY(p) {
  return p.x + p.y;
}

function readX(p) {
  return p.x;
}

readXY({ x: 1 });           // error: arg-structure（缺 y）
readXY({ x: 1, y: 2 });     // ok
readX({ x: 1, z: 9 });      // ok（宽度允许）

const o = { x: 1 };
readXY(o);                  // error（标识符绑定表）

module.exports = { readXY, readX };
