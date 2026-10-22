---
"nudojs": patch
---

`nudo export` now refuses to publish a projection that contradicts the
contract, keeps the four product faces on one public-surface rule, and stops
dropping `@nudo:skip` functions.

- A sidecar (`*.nudo.js`) that failed to load was silently ignored: the
  contract was lost, and the artifacts published the "not declared" case as
  "no constraint" (zod `z.unknown()`) — no message on stderr, exit 0.
  `nudo export` now reports the real `nudo:interface-load` diagnostic and
  exits 1 without publishing anything.
- A contract parameter name that is not in the declared parameter list was
  projected as-is, so the zod face published an `<fn>Input` whose key the
  function signature does not have. `nudo export` now reports
  `nudo:interface-param-mismatch` and exits 1 without publishing anything.
- A contract whose conjunction is unsatisfiable (the source
  `@nudo:contract` contradicts the same-name sidecar) was projected with only
  half of the contract, producing a validator that can never pass.
  `nudo export` now reports `nudo:interface-conflict` and exits 1 without
  publishing anything.
- The dts face projected the module's **public surface** (export / export
  default / CJS exports), while the zod / Standard Schema / guard faces
  projected **every** function — internal implementations included. A module
  with no exports at all still produced three runtime validators while its
  `.d.ts` was silently missing. All four faces now share one export-surface
  rule, and a module with no public surface says so instead of producing
  nothing without a word.
- `@nudo:skip` functions were excluded from the export entry filter (they
  have no case witness by design), so they never reached any product face.
  They are now projected like any other exported function.
