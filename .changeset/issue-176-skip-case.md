---
"@nudojs/service": minor
"nudojs": minor
---

`@nudo:skip` no longer kills `@nudo:case` evaluation (#176) — the declared face and runtime ground truth are no longer a trade-off.

- A skipped function keeps `combinedAbs` from its declared return face (dts/sidecar/draft consumers unchanged), while declared `@nudo:case` directives are evaluated and asserted as usual; `nudo test` prints the skip note and the case assertions in the same block (previously the cases vanished entirely: "no declared @nudo:case expectations")
- `nudo check` behavior is byte-identical (caseMode none — no case evaluation, no synthesized entry@ for skipped functions)
