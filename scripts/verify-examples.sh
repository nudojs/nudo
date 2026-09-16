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
# Output pins (below) mirror the promises in the example files' header
# comments and the per-directory READMEs: fixed strings that MUST appear in
# the full command output (`pin` / `pin_empty`) or in a generated artifact
# (`pin_file`, e.g. the .d.ts written by `infer --dts`). When engine
# precision changes an output, update the example file AND its pins, or CI
# goes red.
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
# generated artifact (e.g. the .d.ts written by `infer --dts`), not in
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
# files are generated declarations (nudo infer --dts), not runnable examples.
covered=$(sed -n 's/^| `\([^`]*\)` | \*\*\([0-9]*\)\*\*.*$/\1/p' "$matrix" \
  | sed -n 's|.*docs/examples/\([^ ]*\).*|docs/examples/\1|p')
while read -r f; do
  case "$f" in
    *.nudo.js | *.d.ts) continue ;;
  esac
  if ! grep -qxF -- "$f" <<<"$covered"; then
    fail=$((fail + 1))
    printf 'FAIL  matrix coverage: %s has no command row in %s\n' "$f" "$matrix"
  fi
done < <(find docs/examples -type f \( -name '*.js' -o -name '*.ts' \) | sort)

# --- output pins (mirror the example files' documented output claims) ---------

# constraints/ — negative examples pin their diagnostic lines; register.js
# (positive) pins its signatures so shape-refine drift also goes red.
pin 'pnpm run check docs/examples/constraints/set-delay.js' \
  'setDelay[ms]: 实参 ⊭ 前置' 'expected: ms > 0' \
  'needsPositive[x]: 实参 ⊭ 前置' 'expected: x > 0'
pin 'pnpm run check docs/examples/constraints/return-contract.js' \
  'bad: 返回值 ⊭ @nudo:refine return positive' 'expected: return > 0'
pin 'pnpm run check docs/examples/constraints/declared-vs-if.js' \
  'setDelay[ms]: 实参 ⊭ 前置'
pin 'pnpm run check docs/examples/constraints/register.js' \
  '0 error · 0 warning' \
  'register(u)  string  #path' \
  'setup(c)  number  = c.retries  where c.retries ≥ 0 ∧ c.retries ≤ 5  #path' \
  'pred: c.retries ≥ 0 ∧ c.retries ≤ 5'
pin 'pnpm run check docs/examples/constraints/add-pred.js' \
  'scale[x]: 实参 ⊭ 前置' 'actual:   -1  #exact'
pin 'pnpm run infer docs/examples/constraints/add-pred.js' \
  '(1, 3) => 4' '(100, 1) => 101' '(-1) => 0' 'Combined: 101 | 0'

# structure/ — pin the shape-mismatch reports. The error-count lines
# lock the width-subtyping positives: the passing excess-slot calls in
# these files must stay errors-free (a new false positive changes the
# count and goes red).
pin 'pnpm run check docs/examples/structure/assign.js' \
  '1 error · 0 warning' \
  'config: 赋值 ⊭ 原有形状' 'missing slot port'
pin 'pnpm run check docs/examples/structure/arg-structure.js' \
  '2 error · 0 warning' \
  'readXY[p]: 实参结构 ⊭ 形参' 'missing slot y'

# vs-ts/ — nudo side pins its diagnostics; tsc side pins its own.
pin 'pnpm run check docs/examples/vs-ts/constraints/nudo.js' \
  '2 error · 0 warning' \
  'setDelay[ms]: 实参 ⊭ 前置' 'actual:   -50  #exact'
pin_empty 'pnpm exec tsc --noEmit --strict docs/examples/vs-ts/constraints/tsc.ts'
pin 'pnpm run check docs/examples/vs-ts/structure/nudo.js' \
  '2 error · 0 warning' \
  'greet[user]: 实参结构 ⊭ 形参' 'missing slot name' \
  'config: 赋值 ⊭ 原有形状'
pin 'pnpm exec tsc --noEmit --strict docs/examples/vs-ts/structure/tsc.ts' \
  'error TS2345' 'error TS2353' 'error TS2741'

# algebra/ — pins mirror each file's header-comment promises.
pin 'pnpm run check docs/examples/algebra/0-add-intensional.js' \
  'add(a, b)  number | string  = (A1 + A2)  #partial' \
  'scale(x)  number  = (x + 1)  where (x + 1) > 1  #path' \
  'twice(x)  number  = ((x + 1) + 1)  where ((x + 1) + 1) > 2  #path'
pin 'pnpm run infer docs/examples/algebra/0-add-intensional.js' \
  '(1, 3) => 4' 'abs: 4  #exact' '(number, 1) => number' 'abs: number  #widened'
pin 'pnpm run types docs/examples/algebra/0-add-intensional.js --assume "x>0"' \
  'nudo types' 'assume: x > 0' \
  'add(unknown, unknown)' 'number | string' 'conf: partial' \
  'scale(number)' 'term: (x + 1)' 'pred: (x + 1) > 1' \
  'term: ((x + 1) + 1)' 'pred: ((x + 1) + 1) > 2' 'conf: path'
pin 'pnpm run infer docs/examples/algebra/a-spread-optional.js' \
  '({ port: 3000, debug: true }) => { host: "localhost", port: 3000, debug: true }' \
  '({}) => { host: "localhost", port: 8080, debug: false }' \
  '({ host: "api.example.com" }) => { host: "api.example.com", port: 8080, debug: false }'
pin 'pnpm run infer docs/examples/algebra/a-spread-optional.js --dts' \
  'Generated: docs/examples/algebra/a-spread-optional.d.ts'
# the signature itself lives in the generated artifact, not stdout:
# one widened parameter union, literal-union return, JSDoc case rows.
pin_file docs/examples/algebra/a-spread-optional.d.ts \
  'createConfig(options: { port: number; debug: boolean } | {} | { host: string })' \
  ': { host: "localhost"; port: 3000; debug: true } | { host: "localhost"; port: 8080; debug: false } | { host: "api.example.com"; port: 8080; debug: false }' \
  'Case: call@L24'
pin 'pnpm run infer docs/examples/algebra/b-hof-map.js' \
  '([1, 2, 3], (x) => ...) => [2, 4, 6]' \
  '(["a", "b"], (s) => ...) => ["A", "B"]'
pin 'pnpm run infer docs/examples/algebra/c-reduce-sum.js' \
  'Case "literal": ([1, 2, 3, 4, 5]) => 15' 'abs: 15  #exact' \
  'Case "symbolic": (number[]) => number'
pin 'pnpm run infer docs/examples/algebra/d-mixin-meet.js' \
  '({ host: "localhost", port: 8080 }, { port: 3000, debug: true }) => { host: "localhost", port: 3000, debug: true }' \
  '({ id: 1 }, { name: "ada" }) => { id: 1, name: "ada" }'
pin 'pnpm run infer docs/examples/algebra/e-index-proj.js' \
  '({ a: 1, b: "x" }, "a") => 1' \
  '({ PATH: "/usr/bin", HOME: "/root" }, "PATH") => "/usr/bin"' \
  'Case "dynamic key": ({ a: 1, b: "x" }, string) => unknown' \
  'Combined: 1 | "x" | "/usr/bin"'
pin 'pnpm run infer docs/examples/algebra/f-async-eff.js' \
  '(42) => Promise<unknown>' 'abs: promise<{ id: 1, name: "ada" }>  #path'
pin 'pnpm run infer docs/examples/algebra/g-narrow-subtract.js' \
  '("abc") => 3' '([1, 2]) => 2' '(5) => -1' 'Combined: 3 | 2 | -1'
pin 'pnpm run infer docs/examples/algebra/h-array-boundary.js' \
  'Case "reduce": ([1, 2, 3, 4, 5]) => 15' 'abs: 15  #exact' \
  'Case "forEach": ([1, 2, 3, 4, 5]) => 15' 'abs: 15  #exact' \
  'Case "some": ([1, 2, 3, 4, 5]) => boolean' 'abs: boolean  #exact'
pin 'pnpm run infer docs/examples/algebra/i-map-set.js' \
  'Case "map-get": ("alice") => unknown' \
  'intension: dedup: (arr: A1) => unknown[]' \
  'Case "set-forof": ([1, 2, 2, 3]) => []'
pin 'pnpm run infer docs/examples/algebra/sample.js' \
  'Case "entry@' '# no call sites found; parameters default to unknown' \
  'add: (a: A1, b: A2) => number | string = (A1 + A2)' \
  '{ host: "localhost", port: 8080, debug: false }'

# mini-repo/ — pin the cross-file integration claims.
pin 'pnpm run check docs/examples/mini-repo/user-service.js' \
  '0 error · 0 warning' \
  'createService()  { store: MemoryStore, load: (id) => ? }  #exact'
pin 'pnpm run infer docs/examples/mini-repo/user-service.js' \
  'Case "ages": ([10, 20, 30]) => 60' \
  '(7) => Promise<{ id: 7, name: "u7" }>' '(4) => 5' \
  '(7, 1, 9999) => 7' '(5, 1, 9999) => 5' 'Combined: 7 | 5'
# support files are matrix rows too: validators.js shows body-inferred
# preconditions at entry; store.js documents that class methods don't
# produce standalone infer cases.
pin 'pnpm run infer docs/examples/mini-repo/validators.js' \
  'Case "entry@L1": (unknown) => boolean' \
  'isPositive: (n: A1) => boolean  where A1 > 0' \
  'clamp: (n: A1, lo: A2, hi: A3) => A2 = A2'
pin 'pnpm run infer docs/examples/mini-repo/store.js' \
  'No functions with @nudo:case directives found.'

# interface-derivation/ — layered contract derivation (Phase 2). The root
# contract (lib.nudo.js handwritten add4) loads for lib.js; the downstream
# derived contract (add.nudo.js generated add2) is enforced for add.js.
pin 'pnpm run check docs/examples/interface-derivation/add.js' \
  'add2(x)  number  = (x + 2)  where (x + 2) > 3  #path' \
  'pred: (x + 2) > 3' 'conf: path'
pin 'pnpm run check docs/examples/interface-derivation/lib.js' \
  '0 error · 0 warning' \
  'add4(x)  number | string  #partial'

printf -- '--------------------------------------------------------------\n'
printf 'examples verified: %s checks passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
