#!/usr/bin/env bash
# Verify every documented example command against the exit code its docs promise.
#
# Single source of truth for "the docs' claims hold today": every command block
# in docs/examples/README.md (and the per-directory READMEs it supersedes) must
# appear here with the exit code the docs promise. Positive examples exit 0;
# negative examples deliberately exit 1 (nudo check) or 2 (tsc) — the error
# lines are what they demonstrate.
#
# Run from anywhere:  pnpm run verify:examples
set -u

cd "$(dirname "$0")/.."

pass=0
fail=0

# expect <expected_exit> <command...> — run, compare exit code, print verdict.
expect() {
  expected=$1
  shift
  out=$("$@" 2>&1)
  got=$?
  if [ "$got" -eq "$expected" ]; then
    pass=$((pass + 1))
    printf 'OK    %s\n' "$*"
  else
    fail=$((fail + 1))
    printf 'FAIL  %s (want exit %s, got %s)\n' "$*" "$expected" "$got"
    printf '%s\n' "$out" | tail -n 12 | sed 's/^/      | /'
  fi
}

# --- constraints/ (pnpm run check = tsx packages/cli/src/index.ts check) -------
expect 1 pnpm run check docs/examples/constraints/set-delay.js
expect 0 pnpm run check docs/examples/constraints/register.js
expect 1 pnpm run check docs/examples/constraints/return-contract.js
expect 1 pnpm run check docs/examples/constraints/declared-vs-if.js
expect 1 pnpm run check docs/examples/constraints/add-pred.js
expect 0 pnpm run infer docs/examples/constraints/add-pred.js

# --- structure/ ---------------------------------------------------------------
expect 1 pnpm run check docs/examples/structure/assign.js
expect 1 pnpm run check docs/examples/structure/arg-structure.js

# --- vs-ts/ (nudo side exits 1; tsc side is the comparison baseline) ----------
expect 1 pnpm run check docs/examples/vs-ts/constraints/nudo.js
expect 0 npx tsc --noEmit --strict docs/examples/vs-ts/constraints/tsc.ts
expect 1 pnpm run check docs/examples/vs-ts/structure/nudo.js
expect 2 npx tsc --noEmit --strict docs/examples/vs-ts/structure/tsc.ts

# --- algebra/ -----------------------------------------------------------------
expect 0 pnpm run check docs/examples/algebra/0-add-intensional.js
expect 0 pnpm run infer docs/examples/algebra/0-add-intensional.js
expect 0 pnpm run infer docs/examples/algebra/a-spread-optional.js
expect 0 pnpm run infer docs/examples/algebra/b-hof-map.js
expect 0 pnpm run infer docs/examples/algebra/c-reduce-sum.js
expect 0 pnpm run infer docs/examples/algebra/d-mixin-meet.js
expect 0 pnpm run infer docs/examples/algebra/e-index-proj.js
expect 0 pnpm run infer docs/examples/algebra/f-async-eff.js
expect 0 pnpm run infer docs/examples/algebra/g-narrow-subtract.js
expect 0 pnpm run infer docs/examples/algebra/sample.js

# --- mini-repo/ ---------------------------------------------------------------
expect 0 pnpm run check docs/examples/mini-repo/user-service.js
expect 0 pnpm run infer docs/examples/mini-repo/user-service.js

printf -- '--------------------------------------------------------------\n'
printf 'examples verified: %s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
