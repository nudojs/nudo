---
"@nudojs/service": patch
---

`nudo contract --emit` now writes sidecars that are valid, compilable and
byte-faithful, and it no longer contradicts the LSP lens or the check face.

- A value-level template in the sidecar (`export const classify = number()`)
  was treated as a handwritten **function** contract, so the emitter refused
  to persist anything for that name ("handwritten wins — skipping") while the
  code lens showed the function as having *no* contract. The clash set now
  follows the same rule as the tier face (only `fn(…)` bindings are
  contracts); a non-contract binding that occupies the export name is
  replaced in place by the generated section, so the sidecar becomes valid
  and the contract takes effect.
- A generated section could collide with an **import local binding** of the
  same name, which made the whole sidecar unloadable
  (`Identifier 'x' has already been declared`) and silently dropped every
  contract of that file — while the tool reported success. Import locals are
  now part of the binding allocation, so the section falls back to an alias
  binding (`const _nudo_1 = …; export { _nudo_1 as x };`).
- `--emit --fn <name>` no longer reorders the existing `@generated` sections:
  the sections are replaced in place, so a refresh produces a content-only
  diff instead of a pure reordering (which made `--exit-on-diff` fail in CI
  on the first run).
- The sidecar keeps its own byte shape: the generated sections now use the
  sidecar's dominant line ending (a CRLF sidecar no longer becomes a
  mixed CRLF/LF file), and a UTF-8 BOM is preserved instead of being
  silently dropped (a no-op emit no longer reports a change).
- A sidecar for a **TypeScript** source (`*.nudo.ts`) now declares the
  builders its generated section uses, so the product compiles
  (`tsc --noEmit --strict` reported `Cannot find name 'lit'` / `'fn'`
  before). The declaration is type-only and keeps the runtime behaviour of
  the JavaScript sidecar (builders are injected by the sidecar loader).
- The `nudo:interface-emit-denied` message now names the **source file**
  that was rejected and states that the allowlist patterns match the source
  file path, so an allowlist copied from the documentation is not refused
  forever.
- The emit summary is the single place where diagnostics are rendered: a
  diagnostic is printed once, and the CLI and the LSP agent face agree.
