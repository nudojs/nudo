---
"nudojs": patch
---

`nudo check --gitlab` and the disk cache no longer lose or duplicate results.

- `--gitlab` annotations were emitted a second time on stdout in addition to
  the collected rows, so a CI log carried the same finding twice. When the
  caller collects the rows, they are no longer printed as well.
- A run that produced both a per-file result and a whole-project result
  entered the disk cache twice under two different keys, so the second entry
  could be served for the first one's input. Both entries now collapse into a
  single cache entry.
