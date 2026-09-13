#!/usr/bin/env bash
# Verify every documented example command against what its docs promise:
#   1. the exit code, from the command matrix in docs/examples/README.md, and
#   2. for pinned commands, the output lines the example files promise.
#
# The command × exit-code matrix is the single source of truth: this script
# parses it, so adding/removing an example or changing a promised exit code
# means editing the matrix only. Every matrix row must parse — a row that
# silently fails to parse would silently drop coverage — so the parsed row
# count is cross-checked against the matrix.
#
# Output pins (below) mirror the promises in the example files' header
# comments and the per-directory READMEs: fixed strings that MUST appear in
# the full command output. When engine precision changes an output, update
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

# --- command matrix (parsed from docs/examples/README.md) ---------------------
# Row format: | `command` | **exit** | description |
matrix=docs/examples/README.md
rows=$(grep -c '^| `' "$matrix")
parsed=0
while read -r code cmd; do
  [ -n "$cmd" ] || continue
  parsed=$((parsed + 1))
  expect "$code" "$cmd"
done < <(sed -n 's/^| `\([^`]*\)` | \*\*\([0-9]*\)\*\*.*$/\2 \1/p' "$matrix")

if [ "$parsed" -ne "$rows" ]; then
  fail=$((fail + 1))
  printf 'FAIL  matrix parse: %s/%s command rows parsed from %s\n' \
    "$parsed" "$rows" "$matrix"
fi

# --- output pins (mirror the example files' documented output claims) ---------

# constraints/ — negative examples pin their diagnostic lines.
pin 'pnpm run check docs/examples/constraints/set-delay.js' \
  'setDelay[ms]: 实参 ⊭ 前置' 'expected: ms > 0' \
  'needsPositive[x]: 实参 ⊭ 前置' 'expected: x > 0'
pin 'pnpm run check docs/examples/constraints/return-contract.js' \
  'bad: 返回值 ⊭ @nudo:refine return positive' 'expected: return > 0'
pin 'pnpm run check docs/examples/constraints/declared-vs-if.js' \
  'setDelay[ms]: 实参 ⊭ 前置'
pin 'pnpm run check docs/examples/constraints/add-pred.js' \
  'scale[x]: 实参 ⊭ 前置' 'actual:   -1  #exact'
pin 'pnpm run infer docs/examples/constraints/add-pred.js' \
  '(1, 3) => 4' '(100, 1) => 101' '(-1) => 0' 'Combined: 101 | 0'

# structure/ — pin the shape-mismatch reports.
pin 'pnpm run check docs/examples/structure/assign.js' \
  'config: 赋值 ⊭ 原有形状' 'missing slot port'
pin 'pnpm run check docs/examples/structure/arg-structure.js' \
  'readXY[p]: 实参结构 ⊭ 形参' 'missing slot y'

# vs-ts/ — nudo side pins its diagnostics; tsc side pins its own.
pin 'pnpm run check docs/examples/vs-ts/constraints/nudo.js' \
  'setDelay[ms]: 实参 ⊭ 前置' 'actual:   -50  #exact'
pin_empty 'npx tsc --noEmit --strict docs/examples/vs-ts/constraints/tsc.ts'
pin 'pnpm run check docs/examples/vs-ts/structure/nudo.js' \
  'greet[user]: 实参结构 ⊭ 形参' 'missing slot name' \
  'config: 赋值 ⊭ 原有形状'
pin 'npx tsc --noEmit --strict docs/examples/vs-ts/structure/tsc.ts' \
  'error TS2345' 'error TS2353' 'error TS2741'

# algebra/ — pins mirror each file's header-comment promises.
pin 'pnpm run check docs/examples/algebra/0-add-intensional.js' \
  'add(a, b)  number | string  = (A1 + A2)  #partial' \
  'scale(x)  number  = (x + 1)  where (x + 1) > 1  #path' \
  'twice(x)  number  = ((x + 1) + 1)  where ((x + 1) + 1) > 2  #path'
pin 'pnpm run infer docs/examples/algebra/0-add-intensional.js' \
  '(1, 3) => 4' 'abs: 4  #exact' '(number, 1) => number' 'abs: number  #widened'
pin 'pnpm run infer docs/examples/algebra/a-spread-optional.js' \
  '({ port: 3000, debug: true }) => { host: "localhost", port: 3000, debug: true }' \
  '({}) => { host: "localhost", port: 8080, debug: false }' \
  '({ host: "api.example.com" }) => { host: "api.example.com", port: 8080, debug: false }'
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
pin 'pnpm run infer docs/examples/algebra/sample.js' \
  'Case "entry@' '# no call sites found; parameters default to unknown' \
  '{ host: "localhost", port: 8080, debug: false }'

# mini-repo/ — pin the cross-file integration claims.
pin 'pnpm run check docs/examples/mini-repo/user-service.js' \
  '0 error · 0 warning' \
  'createService()  { store: MemoryStore, load: (id) => ? }  #exact'
pin 'pnpm run infer docs/examples/mini-repo/user-service.js' \
  'Case "ages": ([10, 20, 30]) => 60' \
  '(7) => Promise<{ id: 7, name: "u7" }>' '(4) => 5' '(7, 1, 9999) => 7'

printf -- '--------------------------------------------------------------\n'
printf 'examples verified: %s checks passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
