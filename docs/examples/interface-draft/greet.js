/**
 * Code-first / migration: generate a reviewable interface draft from logic.
 *
 * Promises (pinned by verify:examples):
 * - `pnpm run interface --draft docs/examples/interface-draft/greet.js`
 *   prints a @nudo:draft module; call-site evidence for double; body-read
 *   suggestion for greet.user.name; does NOT invent check obligations.
 */
export function double(x) {
  return x * 2;
}

export function greet(user) {
  return "hi " + user.name;
}

double(21);
