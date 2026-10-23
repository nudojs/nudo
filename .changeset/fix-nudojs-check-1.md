---
"nudojs": patch
---

`nudo check` no longer bails out early on a flag combination, and the JSON
machine face now reports usage errors inside the same envelope as every other
failure.

- `--fix` combined with `--json` / `--abs` / `--gha` / `--gitlab` / `--watch` /
  `--verbose` / `--from` / `--what-if` used to abort with a bare usage string,
  so a CI job that combined two flags got no machine-readable answer at all.
  The combination is now rejected through the normal JSON envelope
  (`ok: false` plus a `pathErrors` entry carrying the machine code
  `nudo:usage-error`), and the process exit code is decided only by `ok`.
- `--dry-run` combined with `--write` used to run the write path, so a
  supposedly read-only invocation still mutated files on disk. The dry-run
  flag now wins, and the write path is not entered.
- `--watch` together with `--json` used to fall back to the human face and
  print a second, different report. The JSON face is now honoured in watch
  mode as well (`jsonFace` is an optional field, so the existing callers are
  unaffected).
