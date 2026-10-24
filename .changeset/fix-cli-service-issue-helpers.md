---
"nudojs": patch
---

`nudo check` now explains mock-load failures with the suggestion that fits
the failure, instead of one generic sentence.

- A duplicate `@nudo:mock-module` declaration (`nudo:mock-invalid`) used to
  be answered with "Fix the @nudo:mock expression", which points at the
  wrong problem. It now says to remove the duplicate declaration and keep
  one directive per module specifier.
- A mock file that does not export the named binding
  (`nudo:module-missing`) used to be answered with "Create the mock file",
  although the file exists. It now names the missing export and the mock
  file path, and suggests adding the export or dropping it from the
  directive.
- Diagnostics, severities and exit codes are unchanged; only the
  suggestion line differs. `nudo check` and `nudo migrate verify` now use
  the same helpers as the editor and agent surfaces, so all of them report
  the same suggestion for the same file.
