# C0.5 — Evaluation-driven missing-slot

> Status: **implemented (default off)**. Does **not** reintroduce body-AST slot scans.
> Config: `package.json` → `nudo.analysis.evalMissingSlot`: `"off"` (default) | `"warning"`.
> Roadmap: `2026-05-28-close-ts-dx-gaps.md` C0.5 (optional).

## Problem

C0 removed obligations invented from body AST scans (`if (p.name)` / `p.name` reads do **not** by themselves create required interface slots). After that, “zero-annotation missing field” recall drops on purpose: without a contract or call-site evidence, the engine has no obligation to report.

There remains a **narrow, evaluation-driven** case worth documenting:

1. A call site binds an argument to a **known object Abs** (enumerated shape members, not `unknown`).
2. The callee body **actually evaluates** a property / method access on that binding.
3. The key is absent from the enumerated shape.

That is not an AST pre-scan — it is abstract evaluation running the same code path as production.

## What already exists (evaluation path)

| Observation | Current surface |
|-------------|-----------------|
| Method/property access on a receiver whose type cannot support it | `nudo:no-method` / `nudo:unknown-recv` (service analyzer / B-path) |
| Access on primitive / wrong prim | `nudo:no-method` |
| Result of unmodeled access | Abs `unknown` (honest degradation) |
| Handwritten / generated contract field missing at check time | `nudo:constraint-violated` / shape gold errors (`missing required field`) — **contract** path, not body scan |

So “evaluation saw a miss” is already reportable when eval runs. What C0 forbids is promoting *unexecuted* body reads into interface obligations.

## Optional enhancement (not implemented)

A dedicated diagnostic code for the narrow case above:

| Field | Value |
|-------|--------|
| Code | `nudo:missing-slot` (reserved) |
| Severity | **warning** when enabled; never invents check-gate errors without a contract |
| Trigger | B-path / ast-eval property read on Abs with `shape.k === "obj"` (or branded object) where key ∉ enumerated fields **and** the access node was actually evaluated |
| Evidence | Call-site arg Abs + evaluated access location |
| Config | `package.json#nudo.analysis.evalMissingSlot`: `"off"` (default) \| `"warning"` |
| Forbidden | Static walk of function bodies to collect member names as required slots; using `missing-slot` as an implicit interface obligation in `check` |

### Sample (when enabled)

```js
// calls.js
export function greet(user) {
  return "hi " + user.name;
}

greet({ id: 1 }); // eval: user bound to obj{id:1}; body evaluates user.name
```

Expected **only if** `evalMissingSlot: "warning"`:

```text
[warning] nudo:missing-slot  user.name — call-site object lacks field "name"
  actual:   shape({ id: lit(1) })
  expected: field name
```

With default `off`, the same file stays quiet on the implicit tier (call-site fact `{ id: 1 }` is still visible via `nudo interface` / hover).

### Contract path unchanged

```js
// user.nudo.js
export const greet = fn({ user: shape({ name: string() }) }, string());
```

`greet({ id: 1 })` remains a **check** error (`nudo:constraint-violated` / shape missing field) regardless of `evalMissingSlot` — obligations come from the sidecar, not from the body.

## Non-goals

- Restoring C0-removed AST slot inference
- Using body member reads as `effectiveInterface` params
- Auto-emitting `shape({ name })` into sidecars from body scans (emit still uses call-site domains / refine roots)

## Implementation sketch (future)

1. During B-path member access, when receiver Abs has enumerated object shape and key is absent **and** conf is not `opaque`/`widened` in a way that hides members → optionally `collectDiag({ code: "nudo:missing-slot", … })`.
2. Gate on `analysisConfig().evalMissingSlot === "warning"`.
3. Gold tests: default off = zero new diags on C0 recall cases; on = only eval-hit misses.
4. Keep `check` recall gold green: no new default-on obligations.

## Implementation (landed)

| Piece | Location |
|-------|----------|
| Gate | `setEvalMissingSlotEnabled` / `noteObjSlotMissing` in `core/exec/member-diag.ts` |
| Hook | `$get` closed-obj missing key → note (runtime.ts) |
| Config | `nudo.analysis.evalMissingSlot` in `service/evaluator/config.ts` |
| Diagnostic | analyzer `pushBMemberDiag` maps `code === "nudo:missing-slot"` → warning |
| Tests | `packages/service/src/__tests__/c05-missing-slot.test.ts` |

Handwritten contracts still enforce via `nudo:constraint-violated` regardless of this flag. Product path for drafts remains `nudo interface --draft` (body-read keys as suggestions).

## Related

- `docs/superpowers/plans/2026-05-28-close-ts-dx-gaps.md` §0.1 / C0
- `docs/design-limitations.md`
- `docs/design-analysis-scope.md` — diagnostics noise tiers
- `packages/core/src/algebra/__tests__/check-recall-gold.test.ts` — `arg-missing-slot-ok` cases stay OK by default
- **Product path for “code first → contracts”:** `nudo interface --draft` (`packages/service/src/interface-draft.ts`) — reviewable drafts from call-site/symbolic evidence; writes `*.nudo.draft.js` which is **not** ambient-bound. C0.5 diagnostics would only *hint* missing slots; draft generation is the DX deliverable.
