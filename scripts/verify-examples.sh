#!/usr/bin/env bash
# Verify every documented example command against what its docs promise:
#   1. the exit code, from the command matrix in docs/examples/README.md, and
#   2. for pinned commands, the output lines the example files promise.
#
# The command × exit-code matrix is the single source of truth: this script
# parses it, so adding/removing an example or changing a promised exit code
# means editing the matrix only. Every matrix row must parse — a row that
# silently fails to parse would silently drop coverage — so the parsed row
# count is cross-checked against the matrix. Two disk cross-checks close
# the remaining blind spots: every row's target file must exist (a typo'd
# path on a negative-example row would otherwise pass as exit 1), and
# every runnable *.js/*.ts under docs/examples must be covered by at least
# one row (*.nudo.js templates excepted — imported via @nudo:import).
#
# CLI product face (docs/design/cli-semantics.md):
#   Day0  pnpm run check      — gate + signatures (any ≠ unknown)
#         pnpm run test:cli   — case reports (call@/entry@ + debug)
#   Day1  pnpm run contract   — draft/emit/print sidecars
#         pnpm run export:nudo — dts | guard | schema | standard | all
# This script pins current product verbs and the labels the CLI prints.
# Do not invent golden strings that the CLI does not emit.
#
# Output pins (below) mirror the promises in the example files' header
# comments and the per-directory READMEs: fixed strings that MUST appear in
# the full command output (`pin` / `pin_empty`) or in a generated artifact
# (`pin_file`). export --format dts without --out prints declarations to
# stdout (pinned there). When engine precision changes an output, update
# the example file AND its pins, or CI goes red.
#
# Run from anywhere:  pnpm run verify:examples
set -u

cd "$(dirname "$0")/.."

pass=0
fail=0
outdir=$(mktemp -d)
trap 'rm -rf "$outdir"' EXIT

# outfile <command> — stable temp file holding the command's captured output.
outfile() {
  printf '%s/%s.out' "$outdir" "$(printf '%s' "$1" | cksum | cut -d' ' -f1)"
}

# expect <expected_exit> <command> — run, compare exit code, keep output.
expect() {
  expected=$1
  cmd=$2
  out=$(sh -c "$cmd" 2>&1)
  got=$?
  printf '%s' "$out" > "$(outfile "$cmd")"
  if [ "$got" -eq "$expected" ]; then
    pass=$((pass + 1))
    printf 'OK    %s\n' "$cmd"
  else
    fail=$((fail + 1))
    printf 'FAIL  %s (want exit %s, got %s)\n' "$cmd" "$expected" "$got"
    printf '%s\n' "$out" | tail -n 12 | sed 's/^/      | /'
  fi
}

# pin <command> <fixed-string>... — every string must appear in the output.
pin() {
  cmd=$1
  shift
  f=$(outfile "$cmd")
  if [ ! -f "$f" ]; then
    fail=$((fail + 1))
    printf 'FAIL  [pin] no captured output for: %s\n' "$cmd"
    return
  fi
  for s in "$@"; do
    if grep -qF -- "$s" "$f"; then
      pass=$((pass + 1))
      printf 'OK    [pin] %s\n' "$s"
    else
      fail=$((fail + 1))
      printf 'FAIL  [pin] %s (not in output of: %s)\n' "$s" "$cmd"
    fi
  done
}

# pin_empty <command> — the captured output must be empty (nothing reported).
pin_empty() {
  cmd=$1
  f=$(outfile "$cmd")
  if [ -s "$f" ]; then
    fail=$((fail + 1))
    printf 'FAIL  [pin] %s (expected no output, got:)\n' "$cmd"
    head -n 8 "$f" | sed 's/^/      | /'
  else
    pass=$((pass + 1))
    printf 'OK    [pin] %s (no output)\n' "$cmd"
  fi
}

# pin_file <file> <fixed-string>... — every string must appear in a
# generated artifact (e.g. the .d.ts written by `export --format dts --out`), not in
# the command's stdout.
pin_file() {
  f=$1
  shift
  if [ ! -f "$f" ]; then
    fail=$((fail + 1))
    printf 'FAIL  [pin] missing file: %s\n' "$f"
    return
  fi
  for s in "$@"; do
    if grep -qF -- "$s" "$f"; then
      pass=$((pass + 1))
      printf 'OK    [pin] %s\n' "$s"
    else
      fail=$((fail + 1))
      printf 'FAIL  [pin] %s (not in file: %s)\n' "$s" "$f"
    fi
  done
}

# --- command matrix (parsed from docs/examples/README.md) ---------------------
# Row format: | `command` | **exit** | description |
matrix=docs/examples/README.md
rows=$(grep -c '^| `' "$matrix")
parsed=0
while read -r code cmd; do
  [ -n "$cmd" ] || continue
  parsed=$((parsed + 1))
  expect "$code" "$cmd"
  # the row's target file is the first whitespace-delimited token after
  # docs/examples/ (trailing CLI options like --assume are allowed after it)
  # and must exist — a typo'd path on a negative-example row (expected
  # exit 1) would otherwise pass silently.
  case "$cmd" in
    *' docs/examples/'*) ;;
    *)
      fail=$((fail + 1))
      printf 'FAIL  matrix row has no docs/examples target: %s\n' "$cmd"
      continue
      ;;
  esac
  path=$(printf '%s' "$cmd" | sed -n 's|.*docs/examples/\([^ ]*\).*|docs/examples/\1|p')
  if [ -z "$path" ]; then
    fail=$((fail + 1))
    printf 'FAIL  matrix target not extractable: %s\n' "$cmd"
    continue
  fi
  if [ ! -f "$path" ]; then
    fail=$((fail + 1))
    printf 'FAIL  matrix target missing: %s (from: %s)\n' "$path" "$cmd"
  fi
done < <(sed -n 's/^| `\([^`]*\)` | \*\*\([0-9]*\)\*\*.*$/\2 \1/p' "$matrix")

if [ "$parsed" -ne "$rows" ]; then
  fail=$((fail + 1))
  printf 'FAIL  matrix parse: %s/%s command rows parsed from %s\n' \
    "$parsed" "$rows" "$matrix"
fi

# every runnable example file must be covered by at least one matrix row —
# a file added without a row would silently skip the gate. *.nudo.js
# templates are imported via @nudo:import, not standalone targets; *.d.ts
# files are generated declarations (nudo export --format dts), not runnable examples.
covered=$(sed -n 's/^| `\([^`]*\)` | \*\*\([0-9]*\)\*\*.*$/\1/p' "$matrix" \
  | sed -n 's|.*docs/examples/\([^ ]*\).*|docs/examples/\1|p')
while read -r f; do
  case "$f" in
    *.nudo.js | *.d.ts | *.nudo.draft.js) continue ;;
  esac
  if ! grep -qxF -- "$f" <<<"$covered"; then
    fail=$((fail + 1))
    printf 'FAIL  matrix coverage: %s has no command row in %s\n' "$f" "$matrix"
  fi
done < <(find docs/examples -type f \( -name '*.js' -o -name '*.ts' \) | sort)

# --- output pins (mirror the example files' documented output claims) ---------
# Labels below are the strings the CLI actually prints on this branch
# (check: `name(params) => result`; test: `  call@L…  (args) => result`).
# Do not restore old infer/types/interface golden strings.

# constraints/ — negative examples pin their diagnostic lines; register.js
# (positive) pins its signatures so shape-refine drift also goes red.
pin 'pnpm run check docs/examples/constraints/set-delay.js' \
  'setDelay[ms]: argument ⊭ precondition' 'expected: ms > 0' \
  'needsPositive[x]: argument ⊭ precondition' 'expected: x > 0'
pin 'pnpm run check docs/examples/constraints/return-contract.js' \
  'bad: return value ⊭ @nudo:refine return positive' 'expected: return > 0' \
  'nudo contract --draft'
pin 'pnpm run check docs/examples/constraints/declared-vs-if.js' \
  'setDelay[ms]: argument ⊭ precondition'
pin 'pnpm run check docs/examples/constraints/register.js' \
  '0 error · 0 warning' \
  'register(u: { id: number, name: string }) => string' \
  'setup(c: { retries: number, label?: string }) => number'
pin 'pnpm run check docs/examples/constraints/add-pred.js' \
  'scale[x]: argument ⊭ precondition' 'actual:   -1  #exact'
pin 'pnpm run test:cli docs/examples/constraints/add-pred.js' \
  '(1, 3) => 4' '(100, 1) => 101' '(-1, 1) => 0'

# structure/ — pin the shape-mismatch reports. The error-count lines
# lock the width-subtyping positives: the passing excess-slot calls in
# these files must stay errors-free (a new false positive changes the
# count and goes red).
pin 'pnpm run check docs/examples/structure/assign.js' \
  '1 error · 0 warning' \
  'config: assignment ⊭ existing shape' 'missing slot port'
pin 'pnpm run check docs/examples/structure/arg-structure.js' \
  '2 error · 0 warning' \
  'nudo:constraint-violated' 'missing field p.y'

# vs-ts/ — nudo side pins its diagnostics; tsc side pins its own.
pin 'pnpm run check docs/examples/vs-ts/constraints/nudo.js' \
  '2 error · 0 warning' \
  'setDelay[ms]: argument ⊭ precondition' 'actual:   -50  #exact'
pin_empty 'pnpm exec tsc --noEmit --strict docs/examples/vs-ts/constraints/tsc.ts'

# migrate/ — public retire-tsc sample (before → after one-way door)
pin 'pnpm run nudo -- migrate status docs/examples/migrate/before/package.json' \
  'migrate status' 'typescript dep: yes' 'tsc scripts: typecheck, build'
pin 'pnpm run nudo -- migrate strip docs/examples/migrate/before/src/math.ts' \
  'dry' 'math.ts' 'math.js' 'none written'
pin 'pnpm run nudo -- migrate strip docs/examples/migrate/before/src/cart.ts' \
  'dry' 'cart.ts' 'cart.js'
pin 'pnpm run check docs/examples/migrate/after/src/math.js' \
  'lineTotal' 'applyCoupon' 'formatMoney'
pin 'pnpm run check docs/examples/migrate/after/src/cart.js' \
  'cartTotal' 'receipt'
pin 'pnpm run nudo -- migrate verify docs/examples/migrate/after/src/math.js' \
  'OK' 'math.js'
pin 'pnpm run nudo -- migrate retire docs/examples/migrate/before/package.json --dry-run' \
  'dry-run' 'removed typescript' 'nudo check'
pin 'pnpm run nudo -- contract --from-dts docs/examples/migrate/before/src/math.ts' \
  '@nudo:draft' 'NOT a sidecar contract' 'fn({ price: number(), qty: number() }, number())' 'export const lineTotal'
pin 'pnpm run check docs/examples/vs-ts/structure/nudo.js' \
  '2 error · 0 warning' \
  'greet[u]' 'constraint-violated' \
  'config: assignment ⊭ existing shape'
pin 'pnpm exec tsc --noEmit --strict docs/examples/vs-ts/structure/tsc.ts' \
  'error TS2345' 'error TS2353' 'error TS2741'

# algebra/ — pins mirror each file's header-comment promises (actual CLI labels).
pin 'pnpm run check docs/examples/algebra/0-add-intensional.js' \
  '0 error · 0 warning' \
  'add(a: any, b: any) => number | string' \
  'scale(x: number) => number' \
  'twice(x: number) => number'
pin 'pnpm run test:cli docs/examples/algebra/0-add-intensional.js' \
  '(1, 3) => 4' '(number, 1) => number' 'debug "symbolic"'
# check --abs = algebra face. Unconstrained analyze-args
# may still print `unknown` in this view; entry unconstrained params on the
# check signatures face print as `any`.
pin 'pnpm run check docs/examples/algebra/0-add-intensional.js --abs --assume "x>0"' \
  'nudo check --abs' 'assume: x > 0' \
  'number | string' 'conf: partial' \
  'scale(number)' 'term: (x + 1)' 'pred: (x + 1) > 1' \
  'term: ((x + 1) + 1)' 'pred: ((x + 1) + 1) > 2' 'conf: path'
pin 'pnpm run test:cli docs/examples/algebra/a-spread-optional.js' \
  '({ port: 3000, debug: true }) => { host: "localhost", port: 3000, debug: true }' \
  '({  }) => { host: "localhost", port: 8080, debug: false }' \
  '({ host: "api.example.com" }) => { host: "api.example.com", port: 8080, debug: false }'
pin 'pnpm run export:nudo docs/examples/algebra/a-spread-optional.js --format dts' \
  'createConfig(options: { port: number; debug: boolean } | {} | { host: string })' \
  ': { host: "localhost"; port: 3000; debug: true } | { host: "localhost"; port: 8080; debug: false } | { host: "api.example.com"; port: 8080; debug: false }' \
  'Case: call@L24'
pin 'pnpm run test:cli docs/examples/algebra/b-hof-map.js' \
  '([1, 2, 3], (x) => ?) => [2, 4, 6]' \
  '(["a", "b"], (s) => ?) => ["A", "B"]'
pin 'pnpm run test:cli docs/examples/algebra/c-reduce-sum.js' \
  'debug "literal"  ([1, 2, 3, 4, 5]) => 15' \
  'debug "symbolic"  (number[]) => number'
pin 'pnpm run test:cli docs/examples/algebra/d-mixin-meet.js' \
  '({ host: "localhost", port: 8080 }, { port: 3000, debug: true }) => { host: "localhost", port: 3000, debug: true }' \
  '({ id: 1 }, { name: "ada" }) => { id: 1, name: "ada" }'
pin 'pnpm run test:cli docs/examples/algebra/e-index-proj.js' \
  '({ a: 1, b: "x" }, "a") => 1' \
  '({ PATH: "/usr/bin", HOME: "/root" }, "PATH") => "/usr/bin"' \
  'debug "dynamic key"  ({ a: 1, b: "x" }, string) => 1 | "x"'
pin 'pnpm run test:cli docs/examples/algebra/f-async-eff.js' \
  '(42) => promise<{ id: 1, name: "ada" }>'
pin 'pnpm run test:cli docs/examples/algebra/g-narrow-subtract.js' \
  '("abc") => 3' '([1, 2]) => 2' '(5) => -1'
pin 'pnpm run test:cli docs/examples/algebra/h-array-boundary.js' \
  'debug "reduce"  ([1, 2, 3, 4, 5]) => 15' \
  'debug "forEach"  ([1, 2, 3, 4, 5]) => 15' \
  'debug "some"  ([1, 2, 3, 4, 5]) => true'
pin 'pnpm run test:cli docs/examples/algebra/i-map-set.js' \
  'debug "map-get"  ("alice") => { id: "alice", name: "Alice" }' \
  'debug "set-forof"  ([1, 2, 2, 3]) => [1, 2, 3]'
pin 'pnpm run test:cli docs/examples/algebra/j-this-binding.js' \
  '(5) => 25' '(3) => 9'
pin 'pnpm run test:cli docs/examples/algebra/k-try-catch.js' \
  'debug "fold"  () => "inner"' \
  'debug "caught"  () => "boom"'
pin 'pnpm run test:cli docs/examples/algebra/l-primitive-conversion.js' \
  'debug "str"  (5) => "5"' \
  'debug "bool"  ("hi") => true' \
  'debug "num"  ("42") => 42' \
  'debug "int"  ("42px") => 42' \
  'debug "float"  ("3.14") => 3.14'
# sample.js — entry@ fallback; unconstrained params display as any (not unknown).
pin 'pnpm run test:cli docs/examples/algebra/sample.js' \
  'entry@' '(any, any) => number | string' \
  '(any) => number | string' \
  '{ host: "localhost", port: 8080, debug: false }'

# mini-repo/ — pin the cross-file integration claims.
# normalizeId may carry nudo:unknown-inference warning (true unknown return);
# sumAges 无约束 ages 实参 → L2 entry-may-throw（提升是假设、不消除危险）
pin 'pnpm run check docs/examples/mini-repo/user-service.js' \
  '1 error' \
  'sumAges(ages: any) => number | string  throws TypeError' \
  'createService() => { store: MemoryStore, load: (id) => ? }'
pin 'pnpm run test:cli docs/examples/mini-repo/user-service.js' \
  'debug "ages"  ([10, 20, 30]) => 60' \
  '(7) => promise<{ id: 7, name: "u7" }>' '(4) => 5' \
  '(7, 1, 9999) => 7' '(5, 1, 9999) => 5'
# support files are matrix rows too: validators.js shows entry signatures
# with unconstrained params as any; store.js documents class methods without
# call sites falling back to entry@ cases.
pin 'pnpm run check docs/examples/mini-repo/validators.js' \
  'isPositive(n: any) => boolean' \
  'clamp(n: any, lo: any, hi: any) => any'
pin 'pnpm run test:cli docs/examples/mini-repo/validators.js' \
  'entry@L1  (any) => boolean'
pin 'pnpm run test:cli docs/examples/mini-repo/store.js' \
  'MemoryStore.set' 'MemoryStore.get' \
  'entry@'

# interface-derivation/ — layered contract derivation (Phase 2). The root
# contract (lib.nudo.js handwritten add4) loads for lib.js; the downstream
# derived contract (add.nudo.js generated add2) is enforced for add.js.
# D2: default human report is one-line signatures (term/pred/conf behind --verbose/--abs).
pin 'pnpm run check docs/examples/interface-derivation/add.js' \
  'add2(x: number) => number'
pin 'pnpm run check docs/examples/interface-derivation/lib.js' \
  '0 error · 0 warning' \
  'add4(x: number) => number'

# interface-draft/ — code-first draft promises (F6). Primary verb: contract.
pin 'pnpm run contract --draft docs/examples/interface-draft/greet.js' \
  '@nudo:draft' \
  'double  [draft callsite/' \
  'greet  [draft body/' \
  'export const double = ' \
  'body-read { name }' \
  'suggested (body-read, not a contract)' \
  'export const greet = fn({});'

printf -- '--------------------------------------------------------------\n'
printf 'examples verified: %s checks passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
