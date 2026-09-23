/**
 * E2 shape 缺字段：TS 要 interface；Nudo 用 shape 契约在调用点报 missing field。
 * pnpm run check docs/examples/errors/02-shape-missing.js
 */
/// @nudo:import { user } from "./user.nudo.js"

/**
 * @nudo:refine u user
 */
export function greet(u) {
  return "hi " + u.name;
}

greet({ id: 1, name: "Ada" }); // ok
greet({ id: 2 });              // error: missing field user.name
