// 传参结构：义务来自显式 shape 契约（C0.1：不再从 body 访问发明必填 slot）
// 运行：pnpm run check docs/examples/structure/arg-structure.js
//
// 无契约时 readXY({x:1}) 合法（调用点事实 / any）；
// 声明 @nudo:refine p xy 后，缺 y 由契约门禁拦截。

/// @nudo:import { xy } from "./xy.nudo.js"

/**
 * @nudo:refine p xy
 */
function readXY(p) {
  return p.x + p.y;
}

/**
 * @nudo:refine p xy
 */
function readX(p) {
  return p.x;
}

readXY({ x: 1 });           // error: constraint-violated（契约要求 y）
readXY({ x: 1, y: 2 });     // ok
// 宽度子类型：多余 slot 合法；契约只检查声明的字段
readXY({ x: 1, y: 2, z: 9 }); // ok

const o = { x: 1 };
readXY(o);                  // error（标识符实参同样过契约）

export { readXY, readX };
