---
"nudojs": patch
---

`nudo export` to stdout now produces one usable module: the Standard Schema
helper is declared once, the four dialects no longer collide on export names,
and the dropped-preds ledger names the face it came from.

- `--format standard` to stdout repeated the whole `__nudoCheck` helper for
  every exported function, because each per-function module carries its own
  copy and the chunks were concatenated as they were. The shared prelude
  (banner + helper) is now emitted once, so the artifact no longer fails to
  compile with `TS2393` / `TS2300`.
- `--format all` to stdout put the zod and the Standard Schema face into the
  same module scope. Both name the same validator `<fn>Input` / `<fn>Output`,
  so the artifact failed with `TS2451`. A top-level name may now be declared
  only once per stream: the first face keeps the product name and a later
  face that would repeat it is renamed (`<fn>OutputStandard`).
- The `dropped preds` ledger was always titled "not projected into zod" even
  when the run produced no zod artifact at all (`--format standard`) and its
  entries come from the Standard Schema face. The title now names the face
  the entries come from, and `--format all` shows one zod ledger and one
  Standard Schema ledger instead of the same title twice.

Artifacts written with `--out` are unchanged: each dialect keeps its own file
and its own product names.
