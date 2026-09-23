/**
 * E9 结构传参缺字段（非 interface 语法）。
 * pnpm run check docs/examples/errors/09-arg-shape.js
 */
/// @nudo:import { user } from "./user.nudo.js"

/**
 * @nudo:refine u user
 */
export function idOf(u) {
  return u.id;
}

idOf({ id: 1, name: "A", extra: true }); // ok（宽度）
idOf({ name: "A" });                     // error: missing field user.id
