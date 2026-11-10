---
"@nudojs/core": minor
"nudojs": minor
---

ABS-08: automatic loop-invariant candidates (phase 1 — observation only).

- The loop widener records numeric bounds of scalar loop-carried bindings across observed iteration snapshots. When widening actually happens, these become **candidates** surfaced as `nudo:invariant-inferred` info diagnostics with the observed bound and sample count.
- Candidates never participate in proofs: an observed extreme over a bounded number of iterations is one-sided evidence, not a proved invariant. Only an explicit `@nudo:invariant` declaration enters the proof (audited via `nudo:invariant-relied`) — so inference cannot introduce false greens.
- User declarations override candidates for the same binding (no duplicate hints).
- Bounded loops that never widen produce no candidates (no noise).
- Diagnostics docs updated (EN + zh).
