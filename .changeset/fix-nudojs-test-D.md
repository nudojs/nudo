---
"nudojs": patch
---

`nudo test --watch` no longer swallows a failed file, and `nudo test --from`
no longer lets an unresolvable import pass silently.

- **Bug 926 — `nudo test --watch` kept the gate green when a file failed to
  analyze.** The shared watch loop (`startWatch`, used by the `check` /
  `test` / `health` watch faces) caught the exception thrown by a single
  file, printed one stderr line and moved on — without ever setting a
  non-zero exit code. The watch face was therefore the only place where a
  broken file stayed green: `nudo check --watch`, `nudo health --watch` and
  the non-watch `nudo test` all exit 1 on the same directory. The per-file
  catch now marks the round red (`process.exitCode = 1`), in the full round
  and in the incremental round alike, matching the exit-code semantics the
  same file states ("the exit code is the gate state of the most recent
  round"). A broken file still does not abort the round — one bad file must
  not stop the others from being analyzed.
- **Bug 1060 — `nudo test --from <callsite>` silently accepted a callsite
  file whose imports do not resolve.** Importing a module that does not
  exist, or a name the module does not export, evaluated successfully (the
  lenient loader stubs out the unresolved import) but the call sites were
  lost: the command printed no `call@` record, fell back to `entry@`, and
  exited 0 — a false green, because the user believes the call sites were
  verified while nothing was. Syntax errors and top-level throws were
  already reported (that was the half of the previous fix); module
  resolution failures are now reported the same way. The callsite probe
  asks the engine for the module-graph issues it already computes
  (`missing` / `missing-export` / `unreadable` / `json-invalid` — the same
  set the main analysis channel reports as `nudo:module-missing`), and a
  callsite file that carries one is reported as a callsite load failure
  (`nudo:path-missing-callsite`) with a non-zero exit code. The probe now
  runs for every callsite file, not only for the ones that produced zero
  records: an unresolved import produces a record pointing at a function
  that does not exist, so the record count alone never revealed it.
