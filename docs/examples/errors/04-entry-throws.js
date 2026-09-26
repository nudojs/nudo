/**
 * E4 入口 may-throw：TS 不展示 throws；Nudo L2 把运行时炸弹放进 CI。
 * pnpm run check docs/examples/errors/04-entry-throws.js
 */
export function getName(user) {
  return user.name; // unconstrained user → may throw TypeError
}
