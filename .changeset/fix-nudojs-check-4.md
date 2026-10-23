---
"nudojs": patch
"@nudojs/core": patch
---

`nudo check` and `nudo check --fix` now analyse the same program, and the gate
no longer accepts TypeScript-only syntax in a `.js` file.

- `nudo check --fix` fed the analyzer a different input set than `nudo check`:
  the auto-bind setting, the project directory and the injected modules were
  missing, and the mock environment was not assembled. A project could pass
  the gate and still be reported as broken by `--fix`, or the other way
  around. Both commands now build their analyzer input through one shared
  constructor.
- `--fix` also materialised plans for findings that had been downgraded to a
  warning, so a diagnostic that no longer blocks the gate still wrote a
  sidecar into the user's repository. Only error-level findings are
  materialised now.
- A `.js` file containing TypeScript-only syntax (`private x = 0`, `x as T`)
  was parsed happily, so the gate reported success on a file that Node cannot
  even load. The parser now picks its plugins from the file extension, and the
  check face reports the syntax error instead.
- A project-level path environment (`package.json#nudo.env`) was resolved
  relative to the analysed file rather than to the project root, so a
  subdirectory file could not find the environment it declared.
- Environments are merged with the harvested ones under the same precedence
  the test and service faces use, so a harvested export that does not collide
  with a handwritten environment is no longer dropped.
