---
"nudojs": patch
---

`nudo migrate status` now reports the truth about a package: the nudo gate
is detected from the **command text**, the dependency scope covers
`peerDependencies`, `.ts` counts stop at workspace package boundaries, a
`tsc` script blocks even when no `.ts` file is left, a broken
`package.json` is reported instead of being read as "empty", and the
`blockers` list no longer carries the `—` placeholder (the JSON face
reports `[]`).

- The "no nudo check/test script yet" blocker matched the **script name**
  (`/check|test/`) while the scripts it looked at were collected by
  **command text**. A package already running `nudo check .` under a name
  like `lint` or `typecheck2` was reported as having no gate — and the
  blocker never went away after `migrate retire`, which rewrites the script
  to `npx nudojs check .` (a form the old `/\bnudo\b/` pattern did not even
  match). The gate is now detected from the command text
  (`nudo check` / `nudo test` / `npx nudojs check`).
- The dependency scope merged only `dependencies` and `devDependencies`,
  so a package carrying `typescript` in `peerDependencies` was reported as
  `typescript dep: no` with no "typescript still in dependencies" blocker,
  while `migrate retire` on that same package did remove the dependency.
  All four dependency fields are now merged by one shared helper.
- `tsFiles` / `tsxFiles` were counted by a plain directory walk, so the
  root row of a workspace repeated every nested package's sources. Each
  row now counts only the files of its own package.
- The "tsc still in scripts" blocker was gated on `tsFiles > 0`, so a
  package with a `tsc` script and no TypeScript source left — exactly the
  case worth retiring — reported no blocker at all.
- A `package.json` with a JSON syntax error was silently read as "no
  dependencies, no scripts", which `nudo check` contradicts. `migrate
  status` now reports the parse failure (in `blockers` and in the new
  `packageJsonError` field of the JSON face).
- The `—` placeholder for "no blocker" leaked into the `blockers` string
  (`1 tsc line(s) in .github/workflows; —`) and into the JSON `blockers`
  array, where a machine consumer counted it as one more blocker. The
  placeholder is gone: no blockers means no entry, and the JSON face
  reports `[]`.
- A `scripts` entry whose value is `null` is valid JSON (npm reads it as
  "no command") but crashed `migrate status` with a bare
  `Cannot read properties of null (reading 'split')`. Non-string script
  values are now treated as "no command".
