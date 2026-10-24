---
"@nudojs/lsp": patch
---

The editor shows what the command line shows, at a position the editor can
use.

- A file that only contains `@nudo:assume`, `@nudo:invariant`, `@nudo:throws`
  or `@nudo:budget` was skipped as "not a Nudo file", so those directives
  were never analyzed and the file looked clean. Those files are analyzed
  now.
- A `nudo:directive-syntax` diagnostic was published twice, and one copy
  carried line `-1` — not a valid position in the protocol. It is published
  once, at a valid position.
- The placeholder position used for `nudo:module-missing` and
  `nudo:mock-invalid` was converted to line `-1`. Those two error
  diagnostics now land on a valid line.
- An env diagnostic that names the env rather than a file was filtered out
  because the filter only matched file paths. The unknown-env-name and the
  env-contract diagnostics are visible now.
- The project configuration fingerprint read the raw `autoBind` value while
  the analysis read the normalized one, so a configuration written as a
  non-boolean looked like a different configuration on every keystroke. The
  fingerprint uses the normalized value.
- A path env whose load failed was reported by the service analysis before
  the check ran, and the check's own copy of the diagnostic could be lost. The
  diagnostic reaches the editor in both paths.
