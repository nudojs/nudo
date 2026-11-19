---
"@nudojs/core": patch
"@nudojs/service": patch
"nudojs": patch
"@nudojs/lsp": patch
"@nudojs/parser": patch
"@nudojs/harvester": patch
---

Close the BUG-142..173 review batch: one judgment per fact across the evaluator, contract faces, migration commands, and IDE surface.

**Evaluation** — user `@@toPrimitive` / `toString` / `valueOf` hooks are now executed once and their results feed `+ - * /`, relational compares, unary operators, templates, `String()` and `String.prototype.concat` instead of being discarded (BUG-142); conditional mutations inside `for..of` / array HOF callbacks are written back to the live receiver across `$copy` fork arms (BUG-161); `new Date()` carries a valid-time facet so `toISOString()` / `toJSON()` no longer report a false `RangeError` (BUG-154); constructor and host-global `new` paths distinguish non-constructors and expose host prototype members (BUG-151 / BUG-168); `JSON.stringify` handles unions of serializable values (BUG-148).

**Contracts and check** — nested `number()` / `string()` gates reject definite non-primitives, nested `array(...)` requires an array (BUG-150 / BUG-152); `@generated` parameter names that no longer match formals are reported as drift (BUG-147); directive `any()` parses as `any`, and `unknown` serializes as `unknown` (BUG-162); JSDoc optional parameters survive nested type braces (BUG-163); unknown `nudo` / `nudo.check` keys warn, and `nudo init` writes the adoption baseline for typo'd configs (BUG-165); recursion-truncated suggestions emit actionable `adjust` actions (BUG-171), and `@nudo:budget depth` is capped at the host-stack safety ceiling (192) with unsafe quickfixes suppressed (BUG-172).

**Dts / export** — default-export class methods resolve their export slot (BUG-153); class-method parameter annotations are carried through abstract methods and rest parameters (BUG-166 / BUG-173); object-literal member annotations and class return annotations are honored (BUG-156 / BUG-157); `declare global` blocks are mirrored (BUG-167); `contract --from-dts` preserves rest element types (BUG-146); contract emit/draft fall back to symbolic signatures when runtime witnesses are widened or partial (BUG-159); contract sidecar refresh is idempotent (BUG-169) and test freeze converges in one run (BUG-170).

**TS syntax / migration** — namespace declaration merging, `export =`, constructor parameter properties, and `$`-prefixed operator hygiene are preserved through strip/transpile (BUG-149 / BUG-155 / BUG-160 / BUG-164); `migrate retire` judges each `tsc` invocation separately, and `migrate status` resolves subdirectory targets to their owning package (BUG-143 / BUG-145).

**LSP** — `textDocument/signatureHelp` also handles `new K(...)` (BUG-144).

Compatibility: the `@nudojs/core/exec` surface gains `$syncLive`; `CheckAction.kind` gains `adjust`; `check --abs` now seeds TS parameter annotations; `contract --emit` may add contracts for arithmetic return values that were previously skipped as not-projectable. These are additive or stricter-correctness changes, not breaking API removals.
