---
"@nudojs/core": minor
---

fix(dx): sidecar load failure reported once (#64) + contract/DX improvements

1. **Sidecar load failure dedup** (defect): a broken `*.nudo.js` no longer
   reports the same `nudo:interface-load` once per source export. Unrelated
   exports are filtered by the sidecar's export names before exec; module-level
   failures dedup by (path, reason) with one message and `(affects N bindings)`
   — wording no longer says `for 'X'` (reads like X itself is broken).

2. **L2 entry-may-throw actions**: the most honest fix (sidecar `fn({ … })`
   param contract) is now the first suggested action, ahead of `@nudo:throws`.

3. **Destructured param contracts render**: `decide({ grade, findings })` with
   a sidecar field contract shows `{ grade, findings }: { grade: string, … }`
   instead of `decide(_p0: any)`.

4. **`@nudo:budget` function-level budget knob**:
   `@nudo:budget forks=20000` / `calls=… depth=…` raises the call/fork budget
   for that function's evaluation only (restored after). Truncation
   suggestions point at this knob instead of only global `maxForks`.
