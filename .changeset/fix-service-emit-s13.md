---
"@nudojs/service": patch
---

`nudo contract --emit` no longer writes a derived contract twice for the same
downstream export, no longer lets one root overwrite another root's contract,
and no longer keeps the generated section of an export the source no longer
has.

- Two handwritten contracts in the **same** root file that call the same
  downstream export produced two derived rows for one export name, so the
  target sidecar got two `@generated` sections exporting the same name. That
  file is not valid ESM (`SyntaxError: Duplicate export of 'add2'`), so the
  sidecar never loaded and the derived contract silently degraded to a
  no-op (`add2(x: any)`). The roots are now aggregated per downstream export
  into a single derived row whose parameter domain is the **union** of the
  roots' domains (the widest one), and the sidecar is checked for duplicate
  export names before it is written — Babel does not report them, so the
  check is explicit now.
- When **different** root files derive the same downstream export, the last
  writer simply replaced the previous section, so the snapshot covered only
  the call sites of one root and the result depended on the order in which
  the commands were run. The write now merges the new derivation with the
  existing section (again the widest domain) and records every contributing
  root in the section header, so the same source tree produces the same
  snapshot whatever the order is.
- A generated section whose export no longer exists in the target source was
  never removed: it stayed in the sidecar as an export that does not exist at
  runtime and permanently held on the name, so a hand-written contract for a
  new function of the same name made the whole sidecar fail to load. The
  derived path now drops those stale sections and no longer derives a
  contract for an export the target does not have.

The update path of the derived emitter also stopped appending the sections it
did not rewrite a second time — they are already in place, so the sidecar
used to end up with the same section twice (and an invalid export name).
