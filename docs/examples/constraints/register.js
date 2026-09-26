// object 形状契约：无需 interface / type
// number() / string() / shape() 在 .nudo.js 里声明；业务文件只写 @nudo:contract
// 运行：pnpm run check docs/examples/constraints/register.js
//
// check 输出（OK，签名是钉住的无损 Abs）：
//   register(u)  string  #path
//   setup(c)  number  = c.retries  where c.retries ≥ 0 ∧ c.retries ≤ 5  #path
// shape 契约逐字段检查（id>0 / name:string / retries∈[0,5]），违例才报 issue。

/// @nudo:import { user, config } from "./shapes.nudo.js"

/**
 * @nudo:contract u user
 */
function register(u) {
  return `${u.id}:${u.name}`;
}

/**
 * @nudo:contract c config
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

export { register, setup };
