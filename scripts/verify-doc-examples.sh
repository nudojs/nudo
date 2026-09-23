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
# Run from anywhere:  pnpm run verify:docs [--report]
set -u

cd "$(dirname "$0")/.."

REPORT_MODE=0
for a in "$@"; do
  [ "$a" = "--report" ] && REPORT_MODE=1
done

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
  # one module per function: <fn>.nudo.standard.ts (not named after the page).
  # Concatenate ALL generated modules (sorted) — `find | head -1` would make the
  # pinned module depend on filesystem order once a page exports several functions.
  local mod
  mod="$tmp/$stem.standard.concat"
  cat $(find "$outdir" -name '*.nudo.standard.ts' | sort) > "$mod" 2>/dev/null
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

# mocking: arrow-function fetch mock resolves to the promised shape; the remaining
# mock forms on the page (stub().returns, number() builder, virtual module) too.
verify_test mocking packages/website/docs/concepts/mocking.md \
  'debug "user"  (1) => promise<{ id: 1, name: "Alice" }>' \
  'debug "default"  () => 8080' \
  'debug "plan"  () => number' \
  '=== readConfig ==='

# runtime-generation: call-site evidence + sidecar contract project to Standard
# Schema validators (one module per function; names `<fn>_<param>` / `<fn>Return`).
verify_export_standard runtime-generation packages/website/docs/guides/runtime-generation.md \
  'export const createUser_input' \
  'export const createUserReturn' \
  'export const iscreateUserOutputOutput' \
  'Standard Schema v1'

# semantics: Set/Map iteration + Symbol.iterator probe fold (formerly documented as unknown).
# All 11 js blocks on the page are tagged — primitive conversion, Math, string
# formatting, iteration and loose equality fold together here.
verify_test semantics packages/website/docs/concepts/semantics.md \
  '() => "a"' \
  '() => 1' \
  '([1]) => boolean' \
  '() => "HELLO"' \
  '([1, 2, 3]) => 6' \
  '() => ["port", "host"]' \
  '("42") => 42' \
  '("3.14") => 3.14' \
  '(5) => 25' \
  '() => { port: 3000 }' \
  '(1050) => "10.50"'

# control-flow-narrowing: optional chaining / ?? fold on known shapes at any depth.
# All 5 blocks tagged: discriminated-union switch + guard forking stay per-call-site.
verify_test control-flow-narrowing packages/website/docs/concepts/control-flow-narrowing.md \
  '=> 3000' \
  '=> 5' \
  '=> undefined' \
  'debug "idle"  ({ status: "idle" }) => "Waiting..."' \
  '({ kind: "circle", radius: 2 }) => 6.28318' \
  '({ kind: "square", side: 3 }) => 9' \
  '("abc") => 3' \
  '({  }) => 3000' \
  '({ b: {  } }) => 5'

# examples: every runnable js block on the page is tagged (the env/mock directive
# blocks included) — call sites, spread, loop sums, guard narrowing fold together.
verify_test examples packages/website/docs/guides/examples.md \
  '({ x: 1, y: 2 }) => 3' \
  'call@L5  (5, 3) => 2' \
  'call@L12  (12, 3) => 36' \
  'call@L13  (0, 2) => 0' \
  '({ name: "Alice", age: 30 }) => "Alice is 30"' \
  '({ host: "localhost", port: 8080 }, { port: 3000, debug: true }) => { host: "localhost", port: 3000, debug: true }' \
  '("vip") => "SAVE-VIP"' \
  'call@L34  (5) => 10' \
  '("hi") => "HI"' \
  'debug "double digits"  (10) => 11'

# cli: subtract call sites + a declared @nudo:case assertion that passes.
verify_test cli packages/website/docs/guides/cli.md \
  'call@L5  (5, 3) => 2' \
  'call@L6  (1, 10) => -9' \
  'debug "double"  (2) => 4' \
  '1 passed'

# contract: @nudo:import template + refine + violating call gates check.
verify_check contract packages/website/docs/guides/contract.md \
  'nudo:constraint-violated' \
  'expected: x > 0' \
  'needsPositive(x: number) => number'

# type-values: @nudo:case witnesses across concrete/symbolic/mixed args.
verify_test type-values packages/website/docs/concepts/type-values.md \
  'debug "concrete"  (5, 3) => 8' \
  'debug "symbolic"  (number, number) => number' \
  'debug "mixed"  (0, string) => string'

# directives: case witnesses + expected-type assertions (2 pass) + @nudo:pure /
# @nudo:skip behaviour (skip without a declared return prints "skipped").
verify_test directives packages/website/docs/concepts/directives.md \
  'debug "positive numbers"  (5, 3) => 2' \
  'debug "negative result"  (1, 10) => -9' \
  'debug "basic"  ("abc") => 3' \
  'debug "empty"  ("") => 0' \
  '2 passed' \
  'debug "strings"  ("hello") => 5' \
  'debug "numbers"  (42) => 84' \
  'debug "array"  ([1, 2, 3]) => 3' \
  'debug "add"  (number, number) => number' \
  'skipped (no return type declared)' \
  'skipped (declared): number'

# layers: the sidecar binding auto-binds and check prints the contract signature.
verify_check layers packages/website/docs/concepts/layers.md \
  'add2(x: number) => number'

# intro: the page's source + sidecar story (sidecar auto-binds, signatures print).
verify_check intro packages/website/docs/intro.md \
  'scale(x: number) => number'

# abstract-interpretation: the throw path shows up in the entry face.
verify_test abstract-interpretation packages/website/docs/concepts/abstract-interpretation.md \
  'entry@L1  (any, any) => number   throws Error'

# diagnostics: the glossary's L2 example really reports nudo:entry-may-throw.
verify_check diagnostics packages/website/docs/reference/diagnostics.md \
  'nudo:entry-may-throw' \
  'getName(user: any) => any  throws TypeError'

# vscode: the hover/case sample replays its declared case.
verify_test vscode packages/website/docs/guides/vscode.md \
  'debug "test"  (42) => 84'

# agent-integration: normalize() keeps its entry throws face for agent tooling.
verify_test agent-integration packages/website/docs/guides/agent-integration.md \
  'entry@L1  (any) => number   throws TypeError'

# callsite-discovery: the library-only file shows the L2 entry face before any
# usage-site injection (that is what --from later improves).
verify_check callsite-discovery packages/website/docs/guides/callsite-discovery.md \
  'nudo:entry-may-throw' \
  'slugify(title: any) => any  throws TypeError'

# design-doc: the architecture document's own claims are executable — literal
# preservation, guard-free folding, template prefixes, and the case grammar.
verify_test design-doc packages/website/docs/design/design-doc.md \
  'call@L2  (1) => 2' \
  'call@L3  (2) => 4' \
  'call@L12  (5, 0, 10) => 5' \
  'call@L19  ("/x") => "https://api.example.com/x"' \
  'debug "concrete"  (1, 2) => 3' \
  'debug "symbolic"  (number, number) => number'

printf -- '--------------------------------------------------------------\n'
printf 'doc examples verified: %s checks passed, %s failed\n' "$pass" "$fail"

if [ "$REPORT_MODE" -eq 1 ]; then
  # 覆盖率：js/javascript 围栏总数 vs 打 verify 标签并被真实执行的数量。
  # 输出为 CI 友好行，便于后续作为阈值门禁的输入。
  total_js=0
  verified_js=0
  pages_with_js=0
  verified_pages=0
  docs_dir="packages/website/docs"
  for f in "$docs_dir"/**/*.md "$docs_dir"/*.md; do
    [ -f "$f" ] || continue
    has_js=0
    has_verify=0
    while IFS= read -r line; do
      case "$line" in
        '```js '*|'```js'|'```javascript '*|'```javascript')
          has_js=1
          total_js=$((total_js + 1))
          ;;
      esac
      case "$line" in
        '```js verify'|'```javascript verify'|'```js verify-sidecar'|'```javascript verify-sidecar')
          has_verify=1
          verified_js=$((verified_js + 1))
          ;;
      esac
    done < "$f"
    [ "$has_js" -eq 1 ] && pages_with_js=$((pages_with_js + 1))
    [ "$has_verify" -eq 1 ] && verified_pages=$((verified_pages + 1))
  done
  printf 'doc verify coverage: %s/%s pages with js fences verified, %s/%s js fences executed (%.1f%%)\n' \
    "$verified_pages" "$pages_with_js" "$verified_js" "$total_js" \
    "$(awk -v a="$verified_js" -v b="$total_js" 'BEGIN { printf "%.1f", b ? 100 * a / b : 0 }')"
fi

[ "$fail" -eq 0 ]
