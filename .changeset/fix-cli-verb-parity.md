---
"nudojs": patch
---

The command line now answers the same questions as the editor, and stops
answering them differently.

- `nudo check` and `nudo health` disagreed about an export that has no
  contract root: the health report counted it, the check report did not
  mention it. The check report now lists it as `nudo:interface-entry-only`.
- `nudo:mock-invalid` was reported as an error, although the reference says
  it is a warning, and the same file reported it as a warning on another
  path. It is a warning now. The gate itself does not change: an explicit
  contract and the entry-throws rule are unaffected, and a mock file that is
  missing is still an error.
- `nudo test --from` pointed at a file that could not be parsed or evaluated
  reported nothing and exited successfully, which is indistinguishable from
  "no call sites". The failure is reported and the run exits non-zero.
- A `package.json` whose `nudo` key is not an object — or is a falsy value —
  was accepted without a word. The check report now says the configuration
  could not be read, and the "this project has no Nudo configuration yet"
  hint is not shown.
- An import cycle made every file in the cycle report `unknown`. The
  dependency graph is no longer dropped, and a genuinely recursive cycle is
  truncated by the recursion budget instead.
- The vite plugin never read the path-env load failures, so a
  `@nudo:env ./missing.js` that failed to load was invisible during a build.
  The failure is reported now.
- An unreadable dependency was described as a missing file.
