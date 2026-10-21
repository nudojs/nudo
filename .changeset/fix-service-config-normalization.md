---
"@nudojs/service": patch
---

Project configuration is normalized once, and every product reads the same
normalized value.

- A `nudo` key whose value is not an object — `"nudo": true` — was ignored
  without a word, and it also suppressed the "this project has no Nudo
  configuration yet" hint. The key now stops the search for an ancestor
  configuration (the documented rule is "the nearest `package.json` that
  contains a `nudo` key"), the package is treated as having no Nudo
  configuration, and a note on stderr says so.
- A `nudo` key holding a falsy value (`false` / `null` / `0` / `""`) did not
  stop the search either, so a sub-package silently inherited the root
  package's `check.ignoreThrows` and `nudo.env`. Presence now stops the
  search, whatever the value is.
- `nudo.contract.autoBind` was passed through verbatim. A non-boolean value
  made `check` and `contract`/`export` disagree — one side treated it as
  "off", the other as "on" — and the disk cache could not tell the values
  apart, so a wrong conclusion was cached. The value is normalized to a
  boolean once, and a non-boolean falls back to `true` with a note.
- `nudo.check.entryThrows` with an invalid value printed "using error" while
  the gate actually used the value the `profile` preset selects. The note now
  names the value in effect.
- `nudo.cache: ""` did not override `NUDO_CACHE_DIR`; an explicit empty
  string now means "off", like `false` does.
- `NUDO_MAX_FORKS` with an invalid value fell through to
  `nudo.analysis.maxForks`, so the run quietly used a budget the user had
  not asked for. An invalid value now falls back to the default and says so.
- `nudo.analysis.maxForks` and the session cache limit are per-project
  settings, but they were written into process-wide slots only when the
  project configuration was looked up for the first time. Two projects
  analyzed in a different order got different results. They are now applied
  on every lookup, so the same project and configuration always give the same
  answer.
- A `package.json#nudo.env` entry that is not an array, or an array with a
  non-string element, is reported instead of crashing the loader.
