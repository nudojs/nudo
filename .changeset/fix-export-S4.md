---
"nudojs": patch
---

`nudo export --out` no longer loses artifacts silently: product names are
unique per module, hand-written files are never overwritten, and a failed
write reports what actually landed.

- Two modules could map to the same artifact path. The Standard Schema face
  names its file after the **function** (so two modules exporting a function
  of the same name collided), while the dts / zod / guard faces name theirs
  after the source file **stem** (so `a/lib.js` and `b/lib.js` collided). The
  second export silently overwrote the first one, and the consumer ended up
  with another module's declarations. A product name that is already taken
  by a different module now gets a module-key suffix
  (`lib.323a7411.d.ts`), so both modules keep their artifact.
- Two functions with the same name in one module (two `m` methods of a class)
  were written to the same Standard Schema file — the second write overwrote
  the first. Each function now gets its own file
  (`C.m.nudo.standard.ts`, `C.m.2.nudo.standard.ts`).
- A hand-written `.d.ts` in the output directory was overwritten without a
  word, replacing precise types with `unknown`. `nudo export` now refuses to
  overwrite a file it did not generate (exit 1, `nudo:path-io` diagnostic) and
  leaves the file untouched.
- When a write failed, the artifacts that had already been written were
  dropped from the output: stdout showed no `wrote` line at all while the
  files were on disk. The written list is now replayed, and the error names
  the file that failed instead of only the directory.
- The `fix:` hint for a failed `--out` pointed at `nudo check --out`, an
  option that does not exist (`error: unknown option '--out'`). It now points
  at `nudo export --out` and says what to do.

Artifacts written with `--out` carry a `// nudo-export-module:` marker line
that records which module they belong to; it is used to tell "same module,
updated" from "another module with the same name".
