#!/usr/bin/env bash
# migrate-demo — runnable walkthrough of the code-first migration path
# documented in packages/website/docs/guides/migrating-js.md.
#
#   inventory (contract) → draft → review snippet → accept sidecar → check
#
# Usage (from monorepo root):
#   pnpm run migrate-demo
#   bash scripts/migrate-demo.sh --keep   # leave the temp dir for inspection
#
# Not a CI gate (unlike verify:examples); safe to run locally after changes
# to `nudo contract --draft` / check.
set -euo pipefail
cd "$(dirname "$0")/.."

KEEP=0
if [ "${1:-}" = "--keep" ]; then KEEP=1; fi

NUDO_RUN() {
  # Prefer workspace CLI so draft/check share the same build as tests.
  pnpm exec tsx packages/cli/src/index.ts "$@"
}

dir=$(mktemp -d)
if [ "$KEEP" -eq 0 ]; then
  trap 'rm -rf "$dir"' EXIT
else
  echo "keep: $dir"
fi

lib="$dir/lib.js"
cat >"$lib" <<'EOF'
export function double(x) {
  return x * 2;
}

export function greet(user) {
  return "hi " + user.name;
}

double(21);
EOF

step() { printf '\n== %s ==\n' "$1"; }

step "1. inventory (implicit / no sidecar yet)"
NUDO_RUN contract "$lib"

step "2. draft from existing code"
NUDO_RUN contract --draft "$lib"

step "3. write draft file (not ambient-bound)"
NUDO_RUN contract --draft --write "$lib"
draft="$dir/lib.nudo.draft.js"
test -f "$draft"
test ! -f "$dir/lib.nudo.js"
echo "draft file: $draft"
# show the reviewable module
sed -n '1,40p' "$draft"

step "4. accept (human review) — copy intent into handwritten sidecar"
cat >"$dir/lib.nudo.js" <<'EOF'
import { fn, number, shape, string } from "@nudojs/core";

export const double = fn({ x: number() }, number());
export const greet = fn({ user: shape({ name: string() }) }, string());
EOF

step "5. inventory after accept (handwritten)"
NUDO_RUN contract "$lib"

step "6. check gate (handwritten obligations)"
# greet({ id: 1 }) would violate shape name; current file only calls double(21)
set +e
NUDO_RUN check "$lib"
check_ok=$?
set -e
echo "check exit: $check_ok (expect 0 — only double(21) is called)"

step "6b. check catches bad call against accepted contract"
cat >>"$lib" <<'EOF'

greet({ id: 1 });
EOF
set +e
NUDO_RUN check "$lib"
check_bad=$?
set -e
echo "check exit after greet({ id: 1 }): $check_bad (expect non-zero)"

step "done"
echo "Migration demo complete."
echo "Docs: packages/website/docs/guides/migrating-js.md"
if [ "$KEEP" -eq 1 ]; then
  echo "Workspace kept at: $dir"
fi
if [ "$check_ok" -ne 0 ] || [ "$check_bad" -eq 0 ]; then
  echo "FAIL: unexpected check exit codes" >&2
  exit 1
fi
