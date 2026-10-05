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

# @nudo:env 动态 import 按 package.json exports 解析 @nudojs/* → dist。
# 没 build 时 CLI 起不来，每个 pin 都会假红——这里直接拦住并说明原因。
if [ ! -d packages/core/dist ] || [ ! -d packages/env/dist ] || [ ! -d packages/nudojs/dist ]; then
  echo "FAIL: packages/*/dist missing — run 'pnpm run build' before verify:docs"
  exit 1
fi

cli() { pnpm exec tsx packages/nudojs/src/index.ts "$@"; }

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

# verify_scenario <label> <page> <slug> <mode:check|test> <pin>...
# 同一页面里前后的示例互不相邻（各自独立成文件、行号各自从 1 起）时用场景围栏：
# `verify#<slug>` 是主码、`verify-sidecar#<slug>` 是配套侧车，按 slug 单独成文件、
# 单独跑一次。页面所有场景文件彼此独立，因此示例里的 `call@L5` / `entry@L1`
# 这类行号断言可以逐字钉住。
verify_scenario() {
  local label="$1" page="$2" slug="$3" mode="$4"
  shift 4
  local stem out
  stem=$(basename "$page" .md)
  out="$tmp/$stem-$slug.out"
  fences "$page" "verify#$slug" "$tmp/$stem-$slug.js"
  fences "$page" "verify-sidecar#$slug" "$tmp/$stem-$slug.nudo.js"
  [ -s "$tmp/$stem-$slug.nudo.js" ] || rm -f "$tmp/$stem-$slug.nudo.js"
  if [ ! -s "$tmp/$stem-$slug.js" ]; then
    fail=$((fail + 1))
    echo "FAIL [$label] no \`verify#$slug\` fence found in $page"
    return
  fi
  cli "$mode" "$tmp/$stem-$slug.js" > "$out" 2>&1
  pin "$label" "$out" "$@"
}

# quote_pins <label> <page> <source-file> <pin>... — 引用页的每条摘录必须真的
# 出现在源输出（<source-file>）里，同时出现在引用页正文里。引用页与运行结果
# 不允许各自漂移：这是「别页转录」的公共检查。
quote_pins() {
  local label="$1" page="$2" src="$3"
  shift 3
  pin "$label" "$src" "$@"
  local s
  for s in "$@"; do
    if grep -Fq -- "$s" "$page"; then
      pass=$((pass + 1))
    else
      fail=$((fail + 1))
      echo "FAIL [$label] $page does not quote: $s"
    fi
  done
}

# verify_quote_from_page <label> <page> <source-page> <mode> <pin>...
# <page> 转录了 <source-page> 里 verify 围栏的真实运行输出（例如 api/cli-reference
# 摘录 guides/test 的 transcript）。先跑源页拿到真输出，再要求同一条串在引用页里
# 逐字存在。
verify_quote_from_page() {
  local label="$1" page="$2" source_page="$3" mode="$4"
  shift 4
  local stem out
  stem=$(basename "$source_page" .md)
  out="$tmp/$stem.quoted.out"
  fences "$source_page" verify "$tmp/$stem.js"
  fences "$source_page" verify-sidecar "$tmp/$stem.nudo.js"
  [ -s "$tmp/$stem.nudo.js" ] || rm -f "$tmp/$stem.nudo.js"
  if [ ! -s "$tmp/$stem.js" ]; then
    fail=$((fail + 1))
    echo "FAIL [$label] quote source $source_page has no verify fence"
    return
  fi
  cli "$mode" "$tmp/$stem.js" > "$out" 2>&1
  quote_pins "$label" "$page" "$out" "$@"
}

# verify_example_quote <label> <page> <mode> <target-file> <pin>...
# <page> 转录 docs/examples/ 下真实文件的运行输出（那些文件由 verify:examples
# 门禁）。同一条串必须同时出现在真实运行与引用页里。
verify_example_quote() {
  local label="$1" page="$2" mode="$3" target="$4"
  shift 4
  local out
  out="$tmp/example-quote.out"
  cli "$mode" "$target" > "$out" 2>&1
  quote_pins "$label" "$page" "$out" "$@"
}

# verify_scenario_quote <label> <page> <source-page> <slug> <mode> <pin>...
# 同 verify_quote_from_page，但源是「场景围栏」（`verify#<slug>`）：多场景源页
# 的某一段被别页转录时用这条。
verify_scenario_quote() {
  local label="$1" page="$2" source_page="$3" slug="$4" mode="$5"
  shift 5
  local stem out
  stem=$(basename "$source_page" .md)
  out="$tmp/$stem-$slug.quoted.out"
  fences "$source_page" "verify#$slug" "$tmp/$stem-$slug.js"
  if [ ! -s "$tmp/$stem-$slug.js" ]; then
    fail=$((fail + 1))
    echo "FAIL [$label] quote source $source_page has no \`verify#$slug\` fence"
    return
  fi
  cli "$mode" "$tmp/$stem-$slug.js" > "$out" 2>&1
  quote_pins "$label" "$page" "$out" "$@"
}

# test: three independent scenarios on one page (subtract report / entry-only
# fallback / failing declared assertion). Each keeps its own file so the page's
# line-number claims (`call@L5`, `entry@L1`) are pinned verbatim.
verify_scenario test-math packages/website/docs/guides/test.md math test \
  'call@L5  (5, 3) => 2' \
  'call@L6  (1, 10) => -9' \
  '2 synthetic case(s) printed above'
verify_scenario test-entry packages/website/docs/guides/test.md entry test \
  'entry@L1  (any) => any   throws TypeError'
verify_scenario test-dbl packages/website/docs/guides/test.md dbl test \
  'debug "double"  (2) => 4' \
  'debug "bad"  (3) => 6' \
  '✗ 1 passed · 1 failed · 0 unchecked' \
  'expected: 7' \
  'actual:   6' \
  'nudo:case-expected'

# cli-reference transcribes the gated runs above (check heads from guides/check,
# test reports from guides/test) — every quoted line must still match the run.
verify_scenario_quote cli-reference-test-quotes packages/website/docs/api/cli-reference.md packages/website/docs/guides/test.md math test \
  'call@L5  (5, 3) => 2' \
  'call@L6  (1, 10) => -9'
verify_scenario_quote cli-reference-entry-quotes packages/website/docs/api/cli-reference.md packages/website/docs/guides/test.md entry test \
  '(any) => any   throws TypeError'
verify_quote_from_page cli-reference-check-quotes packages/website/docs/api/cli-reference.md packages/website/docs/guides/check.md check \
  'getName(user: any) => any  throws TypeError' \
  'subtract(a: any, b: any) => number'

# troubleshooting shows the Day-0 face (no contract yet) as its own scenario —
# the quoted block and the FAQ's explanation are the same run.
verify_scenario troubleshooting-day0 packages/website/docs/getting-started/troubleshooting.md day0 check \
  'scale(x: any) => number | string' \
  '2 error · 0 warning · 0 info · 2 fn'

# case-study-retire quotes real retire examples (files gated by verify:examples).
verify_example_quote case-study-quotes-migrate packages/website/docs/guides/case-study-retire.md check docs/examples/migrate/after/src/math.js \
  'OK' \
  'signatures'
# （2e5aeb35 起：Bug 22 精确 undefined 不再报 unknown-inference；
#  原生 ms() 未完全 harvested 的面是 L2 entry-may-throw 警告）
verify_example_quote case-study-quotes-retire-real packages/website/docs/guides/case-study-retire.md check docs/examples/retire-real/after/src/age.js \
  'formatAge(durationMs: number) => string' \
  'parseAge(text: string) => undefined' \
  'nudo:entry-may-throw'
verify_example_quote case-study-quotes-retire-debug packages/website/docs/guides/case-study-retire.md check docs/examples/retire-debug/after/src/logger.js \
  'createLogger(namespace: any) => unknown'

# --- verified pages (pins mirror the output blocks on each page) ---------------

# quick-start: sidecar auto-binds, the violating call gates, signatures print.
verify_check quick-start packages/website/docs/getting-started/quick-start.md \
  'nudo:constraint-violated' \
  'expected: x > 0' \
  'scale(x: number) => number' \
  'formatName(first: string, last: string) => string'

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

# export-ecosystem: call-site evidence + sidecar contract project to Standard
# Schema validators (one module per function; names `<fn>_<param>` / `<fn>Return`).
verify_export_standard export-ecosystem packages/website/docs/guides/export-ecosystem.md \
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
# The lap fences add: accepted sidecar bindings (lineTotal/greet/tag tighten
# the signatures), the violating lineTotal(-1, 5) call gates on the tightened
# pred, and the stale @generated wrap segment drifts — warning only.
verify_check contract packages/website/docs/guides/contract.md \
  'nudo:constraint-violated' \
  'expected: x > 0' \
  'needsPositive(x: number) => number' \
  'lineTotal(qty: number, price: number) => number' \
  'greet(user: { name: string }) => string' \
  'expected: qty > 0' \
  'nudo:interface-drift' \
  'wrap[text]: persisted @generated segment ≠ today'\''s call-site domain'

# abs: @nudo:case witnesses across concrete/symbolic/mixed args.
verify_test abs packages/website/docs/concepts/abs.md \
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

# mental-model: Day0 any face + Day1 contract gate on the same scale().
verify_check mental-model packages/website/docs/getting-started/mental-model.md \
  'scale(x: number) => number' \
  'nudo:constraint-violated' \
  'expected: x > 0' \
  'actual:   0  #exact'

# error-faces: five faces in one check — pred bound, return refine, length,
# entry may-throw, assign-mismatch.
verify_check error-faces packages/website/docs/guides/error-faces.md \
  '5 error' \
  'nudo:constraint-violated' \
  'nudo:entry-may-throw' \
  'nudo:assign-mismatch' \
  'expected: ms > 0' \
  'expected: return > 0' \
  'expected: length(s) ≥ 1' \
  'missing slot port' \
  'getName(user: any) => any  throws TypeError' \
  'nudo contract --draft'

# errors-vs-typescript: the ten-scenario catalog — all `verify` blocks concatenate
# into one file (unique top-level names), all `verify-sidecar` blocks into one
# sidecar (fn bindings auto-bind by name; builders imported once, in block 1).
# Pins mirror the per-scenario text blocks — every issue entry on the page is a
# verbatim slice of this single run. Exit code not asserted: the page teaches
# failing gates on purpose (12 errors across the ten scenarios —
# 2e5aeb35 起场景 6 的无约束 + 亦记 L2 entry-may-throw)。
verify_check errors-vs-typescript packages/website/docs/guides/errors-vs-typescript.md \
  '12 error · 0 warning · 0 info · 10 fn' \
  'setDelay(ms: number) => number' \
  'greet(u: { id: number, name: string }) => string' \
  'inc(x: any) => number | string' \
  'getName(user: any) => any  throws TypeError' \
  'nudo:constraint-violated' \
  'nudo:entry-may-throw' \
  'nudo:assign-mismatch' \
  'expected: ms > 0' \
  'expected: missing field u.name' \
  'missing slot port' \
  'expected: return > 0' \
  'expected: x > 0' \
  'expected: length(s) ≥ 1' \
  'prim string ⊭ prim number' \
  'nudo contract --draft'

# hof-relations: fnRels keep HOF result shapes derivable — apply-style relays,
# map/filter relation sites, and the entry face of relation-consuming exports.
verify_test hof-relations packages/website/docs/concepts/hof-relations.md \
  'call@L5  ((n) => ?, 5) => 7' \
  'call@L6  ((s) => ?, "hi") => "hi!!"' \
  'call@L11  ([1, 2, 3, 4], (n) => ?, (n) => ?) => [20, 40]' \
  'call@L16  ([{ id: 1 }, { id: 2 }, { id: 3 }], (r) => ?) => [1, 2, 3]'

# CLI ↔ docs verb drift: every primary verb named in cli.md / cli-reference.md
# must be registered in packages/nudojs; every registered command must appear
# in the reference page. Catches docs that invent or forget product verbs.
cli_verbs_en=$(grep -oE 'nudo (check|test|contract|export|health|migrate)' \
  packages/website/docs/guides/cli.md packages/website/docs/api/cli-reference.md \
  | sed 's/.*nudo //' | sort -u)
for verb in $cli_verbs_en; do
  if ! grep -q "\.command(\"$verb\")" packages/nudojs/src/commands/*.ts; then
    printf 'FAIL cli-docs: documented verb `%s` is not registered in packages/nudojs\n' "$verb"
    fail=$((fail + 1))
  else
    pass=$((pass + 1))
  fi
done
for f in packages/nudojs/src/commands/*.ts; do
  # Only files that register a CLI command (skip shared helpers).
  verb=$(grep -oE '\.command\("[a-z-]+"' "$f" | head -1 | sed 's/.*"\(.*\)"/\1/')
  [ -n "$verb" ] || continue
  if ! grep -q "nudo $verb" packages/website/docs/api/cli-reference.md; then
    printf 'FAIL cli-docs: registered command `%s` missing from api/cli-reference.md\n' "$verb"
    fail=$((fail + 1))
  else
    pass=$((pass + 1))
  fi
done

# CLI ↔ docs flag drift: every long option registered on a product command must
# be documented in api/cli-reference.md (en). Same discipline as the verb audit
# above — catches flags that ship silently or get documented before existing.
# (-z lets \s span the newline of multi-line `.option(\n  "--flag <v>"` calls.)
cli_flags=$(grep -hzoE '\.option\(\s*"--[a-z-]+' packages/nudojs/src/commands/*.ts \
  | tr '\0' '\n' | grep -oE '\--[a-z-]+' | sort -u)
for flag in $cli_flags; do
  if ! grep -qF -- "$flag" packages/website/docs/api/cli-reference.md; then
    printf 'FAIL cli-docs: registered flag `%s` missing from api/cli-reference.md\n' "$flag"
    fail=$((fail + 1))
  else
    pass=$((pass + 1))
  fi
done

# 反向审计：文档里写出的每个长 flag 必须是真注册过的产品开关——防止文档
# 发明一个从未实现的 flag（或漏删已删除的 flag）。guides/cli.md 的命令行
# 用法串同口径。
# `--no` 只是 `--no-draft` / `--no-workflows` 的书写前缀，不是 flag 本身。
for flag in $(grep -ohE '\--[a-z][a-z-]+' \
  packages/website/docs/api/cli-reference.md packages/website/docs/guides/cli.md \
  | sort -u); do
  case "$flag" in
    --no) continue ;;
  esac
  if printf '%s\n' "$cli_flags" | grep -qxF -- "$flag"; then
    pass=$((pass + 1))
  else
    printf 'FAIL cli-docs: docs document flag `%s`, not registered in packages/nudojs\n' "$flag"
    fail=$((fail + 1))
  fi
done

# zh ↔ en fence parity: tagged code blocks are language-independent — the zh
# translation may only translate prose. Any byte drift in a `verify` /
# `verify-sidecar` fence (en page vs zh mirror) is a doc bug and goes red here,
# because only the en fences are executed above.
zh_docs_root="packages/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current"
# (repo paths are space-free; a plain for-loop avoids process substitution,
# which can block under some CI shells when children inherit its pipe fd)
for page in $(find packages/website/docs -name '*.md' | sort); do
  rel=${page#packages/website/docs/}
  zh_page="$zh_docs_root/$rel"
  if [ ! -f "$zh_page" ]; then
    printf 'FAIL zh-parity: no zh mirror for %s\n' "$rel"
    fail=$((fail + 1))
    continue
  fi
  for tag in verify verify-sidecar $(grep -oE '^```(js|javascript) verify(-sidecar)?#[a-z0-9-]+' "$page" | sed 's/^```[a-z]* //' | sort -u); do
    fences "$page" "$tag" "$tmp/par-en.js"
    fences "$zh_page" "$tag" "$tmp/par-zh.js"
    if [ -s "$tmp/par-en.js" ] || [ -s "$tmp/par-zh.js" ]; then
      if cmp -s "$tmp/par-en.js" "$tmp/par-zh.js"; then
        pass=$((pass + 1))
      else
        printf 'FAIL zh-parity: `%s` fence drift between en and zh in %s\n' "$tag" "$rel"
        diff -u "$tmp/par-en.js" "$tmp/par-zh.js" | sed 's/^/    /'
        fail=$((fail + 1))
      fi
    fi
  done
done

printf -- '--------------------------------------------------------------\n'
printf 'doc examples verified: %s checks passed, %s failed\n' "$pass" "$fail"

if [ "$REPORT_MODE" -eq 1 ]; then
  # 覆盖率：js/javascript 围栏总数 vs 打 verify 标签并被真实执行的数量。
  # 输出为 CI 友好行，便于后续作为阈值门禁的输入。
  # 页面覆盖率下限（ratchet 门禁）：verified_pages / pages_with_js 的百分比不得低于此值。
  # 该值只升不降（ratchet）；调整需 docs 团队签核并在提交说明里附新的测量值。
  # 测量基线 2026-09-28：23/38 页 = 60.5%（en docs，```js|javascript 围栏 vs verify/verify-sidecar；
  # errors-vs-typescript 十场景页全量 verify 落地后测得），取 5 的整数倍向下留量 → 60。
  MIN_VERIFY_PAGE_COVERAGE=60
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
        '```js verify'|'```javascript verify'|'```js verify-sidecar'|'```javascript verify-sidecar'|'```js verify#'*|'```javascript verify#'*|'```js verify-sidecar#'*|'```javascript verify-sidecar#'*)
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

  # 页面覆盖率下限：低于 MIN_VERIFY_PAGE_COVERAGE 即失败（给新增带 js 围栏但未打
  # verify 标签的页面兜底 —— 要么补 verify 围栏，要么下调需 docs 团队签核）。
  page_pct=$(awk -v a="$verified_pages" -v b="$pages_with_js" 'BEGIN { printf "%.1f", b ? 100 * a / b : 0 }')
  if awk -v p="$page_pct" -v m="$MIN_VERIFY_PAGE_COVERAGE" 'BEGIN { exit (p < m) ? 0 : 1 }'; then
    printf 'doc verify coverage floor violated: %s%% of pages with js fences verified < MIN_VERIFY_PAGE_COVERAGE=%s\n' \
      "$page_pct" "$MIN_VERIFY_PAGE_COVERAGE" >&2
    exit 1
  fi
fi

[ "$fail" -eq 0 ]
