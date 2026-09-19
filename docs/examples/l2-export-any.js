/**
 * L2 demo: unconstrained entry param + member access → nudo:entry-may-throw.
 * Migration: nudo check docs/examples/l2-export-any.js --ignore-throws TypeError
 *            or package.json#nudo.check.ignoreThrows / entryThrows.
 */
export function getName(user) {
  return user.name;
}
