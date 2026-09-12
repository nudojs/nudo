// object 形状契约：无需 interface / type
// number() / string() / shape() 在 .nudo.js 里声明；业务文件只写 @nudo:refine
// 运行：npx tsx packages/cli/src/index.ts check docs/examples/constraints/register.js

/// @nudo:import { user, config } from "./shapes.nudo.js"

/**
 * @nudo:refine u user
 */
function register(u) {
  return `${u.id}:${u.name}`;
}

/**
 * @nudo:refine c config
 */
function setup(c) {
  return c.retries;
}

register({ id: 1, name: "ada" });     // ok
// register({ id: -1, name: "ada" }); // error: u.id ⊭ > 0
// register({ id: 1 });               // error: missing name
// register({ id: 1, name: 2 });      // error: name ⊭ string

setup({ retries: 3 });                // ok（label 可选）
// setup({ retries: 99 });            // error: retries ⊭ ≤ 5

module.exports = { register, setup };
