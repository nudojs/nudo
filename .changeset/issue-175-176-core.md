---
"@nudojs/core": minor
---

Pure-expression equality folding and the `@nudo:invariant` loop lemma close #175/#176 — `const d = a === b ? 0 : Math.max(a.length, b.length); const max = Math.max(a.length, b.length); return max - d` now proves `ge(0)` with no directive, and levenshtein-style DP loops gain a user-declared invariant channel.

- `sub` folds `x − x` to exact `0` (NaN arm preserved) when both operands carry structurally equal terms that pass `isDeterministicTerm` — `len#N` identity-minted leaves plus a deterministic host whitelist (`Math.max/min/…`, arithmetic). Adoption re-anchors, `get` member reads and `arg${i}` placeholders are rejected, so structurally-equal-but-distinct values never fold
- `sub` now consumes `@nudo:assume` premises (symmetric to `divAssumeBounds`): `@nudo:assume d <= max` proves `max - d ≥ 0` — the subtraction formulation of the similarity lemma previously had no working channel
- Domain-shared values (arr element handed to two index reads, for-of single representative, callback element args) are marked at hand-out (`len-sharing.ts`): `abstractLen` mints a fresh `len#N` per read and the reflexivity fold rejects marked operands — `xs[0].length - xs[1].length` no longer falsely folds to `0`
- `@nudo:invariant <name><path> <rel> <number>` (`dp[*][*] >= 0`, scalar `last >= 1`): loop analogue of `@nudo:assume` — parsed in core, seeded per target entry, enforced at loop join/widen on the named binding (element domains / object slots drilled by `[*]`/`.ident`), cleared at call boundaries, audited via `nudo:invariant-relied` info (+ `nudo:invariant-invalid` for bad syntax). Unguarded `dp[m][n]` keeps its honest `number | undefined` OOB read face
- `Array.from({length}, mapFn)` hands the callback a bounded index (`ge(0)`, plus `lt(length)` when the length term is available); the same bounds now apply to abstract-receiver `.map/.forEach/.reduce/...` callback indices and `entries()`; the array-like missing-slot seed no longer pins a false literal `0`
