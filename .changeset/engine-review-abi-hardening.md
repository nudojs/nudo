---
"@nudojs/core": minor
"@nudojs/service": patch
---

Engine review batch: harden the transpile↔runtime ABI, converge class-graph
identity, and add compile/emit guard rails. No public API changes.

ABI single-sourcing (#1): `$`-prefix semantics (rt.ts module param face +
analyze-strip strip-keep predicate) now consume one explicit table
(`isRuntimeOpName` / `MODULE_FACE_ONLY_OPS` in transpile/runtime-import.ts);
a drift guard pins the binding-table `$`-key set ≡ truth table (the 4
internal helpers that accidentally rode the prefix filter are now explicit).

Runtime state (#2/#8/#9/#12): state.ts split into phi.ts / host-bridge.ts /
exit-stacks.ts with state.ts kept as a byte-identical re-export facade
(75 value exports + type face verified unchanged); load-time setter
injections for the member/class dispatch cycle converge into exec/hooks.ts
(removes the `var`-hoisting TDZ defense); may-throw's AsyncLocalStorage +
module-level syncCtx dual-write and the bare newTargetStack now run on
collector-scope slots; isHostGeneratorFn checks the Bug 325 fnKind stamp
before the source-shape regex (regex kept as hoisting-window fallback,
documented); narrow.ts sum-filter boilerplate ×5 collapsed into
filterSumMembers; guardedPrologueEntry factory covers $in/$del/$delRes;
toIOIArg no longer routes through toIOI's absent-folding (private
ioiNumberOf core, both helpers derived).

Class graph (#3/#4): inheritance-chain walks (statics/method lookup, super
family, error-family and JSON-face walks) prefer the per-value `superSpec`
reference resolved at definition time — multi-module same-name parent
classes no longer cross-contaminate via the last-wins bare-name registry
(name table kept for display/builtin fallback, collision observation
unchanged); all brand-rebranding sites ($super, $new exit) route through a
single `rebrandClassAbs` primitive that transfers the full side-table set
(inventory + per-table rationale in rebrand.ts header).

Transpile (#5/#6/#7): TranspileOptions' 44 fields regrouped into
BaseEmitOpts/FlowCtx/NamingCtx/InjectCtx (type-level only, zero call-site
churn); new transpile-output-hygiene test parses generated output for the
full differential corpus and asserts every `__`-prefixed binding comes from
the allocator whitelist (9.5k bodies / 7.8k declaration sites); new
async-gen compile guard transpiles+compiles all 39 await-position shapes
without the disableAsyncGen retry (pins the Bug 1139 false-green class).

Service (#10/#11): eval-cache 6-dim key comparison unified into a single
evalCacheEntryMatches predicate (read-hit + write-back shared); CJS member
dispatch exception handling pinned by a drift-gate test (shares no skeleton
with core's export-slot path — rationale documented); stale TypeValue /
ast-eval "fallback path" comments rewritten to describe the actual
single-engine behavior, write-only dead sets removed.
