---
"@nudojs/core": patch
"@nudojs/env": patch
---

Fix: architecture debt A3+A4 — the declared throws face now survives the relation face (no apply) and the construct paths (`new X()` / bind products).

- A3 (relation throws channel): `relationFn` gains an optional `throws` carrier (`impl.relation.throws` — same representation as `AbsApplyResult.throws`, `never`/absent = no throw; not written into the fn shape, which has no throws consumer). The `$call` relation arm routes it through the single `routeApplyThrows` entry (may-throw → `pushThrowExit` into the caller frame; `returnType = never` + throws → `NudoThrow`). env declarations whose host throws but which declare no apply no longer read as "never throws" (false green) — `envFn`'s no-apply branch passes `opts.throws` through (opt-in; no existing declaration changes behavior).
- A4 (construct paths dropped the apply throws slot): the two bare-unpack sites — `$new`'s `impl.apply` branch (`exec/class/construct.ts`) and the bind-product `[[Construct]]` facet (`exec/class/invoke.ts`) — now route through `routeApplyThrows` instead of peeling `.abs`, so constructor-declared throws take effect on `new X()` too (previously call-face only). Under `@nudo:env node`, `new URL(<invalid or abstract>)` now records may-throw `TypeError` instead of silently succeeding; definite always-throw constructor applies surface as `NudoThrow` at the construct point. A source gate forbids reintroducing `isAbsApplyResult(x) ? x.abs : x` peeling in the class dispatch layer.
- Regression pins: `abs-apply-throws-channel.test.ts` (A3/A4 sections + cross-module gold + source gate), `env-bug-s0-mechanism.test.ts` (A3 env-face section incl. ctor-shape relation), and the former false-green pin `env-bug-64` 2.4 rewritten as a positive assertion.
