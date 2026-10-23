---
"@nudojs/core": patch
"nudojs": patch
---

`nudo check --json` no longer ships the engine's internal variable ids, and its
signatures now match the ones printed on the terminal.

- The machine-readable signature fields rendered the abstract value's `term` /
  `pred` unconditionally. Those terms mix in the engine's internal variable
  ids (`len#0`, `len#2`, …), which are minted by a **process-wide counter**, so
  the id a file got depended on the file's position in the command line.
  Checking three identical files gave `len#0` / `len#2` / `len#4`, and swapping
  the order swapped the ids — the JSON payload of a single file was a function
  of its argument position rather than of its contents. The internal ids are now
  replaced by a **stable name** (`len#2` → `len`), so the abstract term and
  predicate evidence survives while the drifting number is gone.
- `signatures[].display` is now rendered with the same `formatShape` projection
  the terminal uses, so the machine face and the human face of one command
  agree: `nudo check` prints `f() => number` while `--json` used to report
  `number = len#0 where len#0 ≥ 0 #path` for the very same function. The
  confidence marker and the branch-join note are still available — through the
  `conf` field and the `detail` / `abs` fields.
