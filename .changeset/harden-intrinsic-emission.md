---
"@nudojs/core": patch
---

fix(core): transpile emissions no longer depend on host `undefined` / `NaN` / `Infinity` identifier identity

Follow-up hardening after the env-injection skip fix:

- emit `$lit(void 0)` / `$lit(0/0)` / `$lit(1/0)` instead of `$lit(undefined)` /
  `$lit(NaN)` / `$lit(Infinity)` so generated code never reads those identifiers;
- omit `$fork`'s third argument when there is no `else` arm (previously emitted a
  bare `undefined` sentinel that broke if the name was shadowed);
- share one `HOST_INTRINSIC_NAMES` table between transpile folding and the env
  inject skip set, so the two lists cannot drift;
- free-assignment / fork-binding filters exclude all three intrinsics, not just
  `undefined`.
