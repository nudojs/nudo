#!/usr/bin/env bash
# Verify that the website doc code blocks tagged `verify` actually produce the
# outputs their pages promise. Extracted blocks are run through the real CLI
# (`check` / `test` / `export`) and pinned against the strings the pages print
# as outputs — so a doc example that drifts from engine behavior goes red here
# instead of teaching stale output.
#
# Tag grammar (opt-in per block, on the opening fence only):
#   ```js verify            → appended (in page order) to <page>.js
#   ```js verify-sidecar    → appended to <page>.nudo.js (auto-bound sidecar)
#   ```js noplayground      → ignored here (also hides the Playground button)
# Only `js` / `javascript` fences with these tags are executed; every other
# block is documentation-only.
#
# Pin strings must be the exact labels the CLI prints on this branch — same
# discipline as scripts/verify-examples.sh: never invent golden strings.
#
# Run from anywhere:  pnpm run verify:docs
set -u

cd "$(dirname "$0")/.."

pass=0
fail=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cli() { pnpm exec tsx packages/cli/src/index.ts "$@"; }

# fences <page> <tag> <outfile> — extract fenced js blocks tagged <tag>.
fences() {
  awk -v tag="$2" '
    $0 == ("```js " tag) || $0 == ("```javascript " tag) { in_block=1; next }
    in_block && /^```/ { in_block=0; next }
    in_block { print }
  ' "$1" > "$3"
}

# pin <label> <file> <fixed-string>... — every string must appear in <file>.
pin() {
  local label="$1" file="$2"
  shift 2
  for s in "$@"; do
    if grep -Fq -- "$s" "$file"; then
      pass=$((pass + 1))
    else
      fail=$((fail + 1))
      echo "FAIL [$label] missing pin: $s"
    fi
  done
}

# verify_check <label> <page> <pin>... — extract, run `nudo check`, pin stdout.
# (Exit code is not asserted: some pages teach failing gates on purpose.)
verify_check() {
  local label="$1" page="$2"
  shift 2
  local stem out
  stem=$(basename "$page" .md)
  out="$tmp/$stem.out"
  fences "$page" verify "$tmp/$stem.js"
  fences "$page" verify-sidecar "$tmp/$stem.nudo.js"
  [ -s "$tmp/$stem.nudo.js" ] || rm -f "$tmp/$stem.nudo.js"
  if [ ! -s "$tmp/$stem.js" ]; then
    fail=$((fail + 1))
    echo "FAIL [$label] no tagged js block found in $page"
    return
  fi
  cli check "$tmp/$stem.js" > "$out" 2>&1
  pin "$label" "$out" "$@"
}

# verify_test <label> <page> <pin>...
verify_test() {
  local label="$1" page="$2"
  shift 2
  local stem out
  stem=$(basename "$page" .md)
  out="$tmp/$stem.out"
  fences "$page" verify "$tmp/$stem.js"
  fences "$page" verify-sidecar "$tmp/$stem.nudo.js"
  [ -s "$tmp/$stem.nudo.js" ] || rm -f "$tmp/$stem.nudo.js"
  if [ ! -s "$tmp/$stem.js" ]; then
    fail=$((fail + 1))
    echo "FAIL [$label] no tagged js block found in $page"
    return
  fi
  cli test "$tmp/$stem.js" > "$out" 2>&1
  pin "$label" "$out" "$@"
}

# verify_export_standard <label> <page> <pin>...
verify_export_standard() {
  local label="$1" page="$2"
  shift 2
  local stem outdir
  stem=$(basename "$page" .md)
  outdir="$tmp/$stem-out"
  fences "$page" verify "$tmp/$stem.js"
  fences "$page" verify-sidecar "$tmp/$stem.nudo.js"
  [ -s "$tmp/$stem.nudo.js" ] || rm -f "$tmp/$stem.nudo.js"
  if [ ! -s "$tmp/$stem.js" ]; then
    fail=$((fail + 1))
    echo "FAIL [$label] no tagged js block found in $page"
    return
  fi
  cli export "$tmp/$stem.js" --format standard --out "$outdir" > "$tmp/$stem.out" 2>&1
  # one module per function: <fn>.nudo.standard.ts (not named after the page)
  local mod
  mod=$(find "$outdir" -name '*.nudo.standard.ts' | head -n 1)
  if [ ! -s "$mod" ]; then
    fail=$((fail + 1))
    echo "FAIL [$label] no standard module written"
    return
  fi
  pin "$label" "$mod" "$@"
}

# --- verified pages (pins mirror the output blocks on each page) ---------------

# quick-start: sidecar auto-binds, the violating call gates, signatures print.
verify_check quick-start packages/website/docs/getting-started/quick-start.md \
  'nudo:constraint-violated' \
  'expected: x > 0' \
  'scale(x: number) => number' \
  'formatName(first: any, last: any) => number | string'

# check: L2 entry may-throw gates; subtract body arith yields number.
verify_check check packages/website/docs/guides/check.md \
  'nudo:entry-may-throw' \
  'getName(user: any) => any  throws TypeError' \
  'subtract(a: any, b: any) => number'

# mocking: arrow-function fetch mock resolves to the promised shape.
verify_test mocking packages/website/docs/concepts/mocking.md \
  'debug "user"  (1) => promise<{ id: 1, name: "Alice" }>'

# runtime-generation: call-site evidence projects to standard validators
# (input validator name `<fn>_<param>`; literals pin exact values).
verify_export_standard runtime-generation packages/website/docs/guides/runtime-generation.md \
  'export const createUser_input' \
  '"k":"lit"'

printf -- '--------------------------------------------------------------\n'
printf 'doc examples verified: %s checks passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
