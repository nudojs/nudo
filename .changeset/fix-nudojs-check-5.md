---
"nudojs": patch
"@nudojs/core": patch
---

`nudo check` no longer loses a failing input, misreports the gate tier, prints
an unappliable diff, or stays green on a broken sidecar.

- An input file that exists but cannot be read (permissions, I/O) escaped the
  command as a raw `EACCES` message. With `--json` the command printed
  nothing at all, so a CI job got an empty stdout and a non-zero exit code
  without a machine-readable reason. The failure is now reported as a path
  error (`nudo:path-io`) inside the usual JSON envelope, and the human face
  prints the reason plus a `fix:` hint.
- The warning about an unknown `package.json#nudo.check.profile` always said
  `using default strict`, even when an explicit `check.entryThrows` (or a CLI
  flag) had put the gate into a different tier. The message now names the tier
  that is actually in effect, so it can no longer contradict the report.
- `nudo check --fix` printed its own `---`/`+++` header in addition to the
  header of the unified diff, polluted the `+++` path field with the
  `[fix] …` explanation, and used absolute paths (which produced `a//…`).
  The diff now has a single header with a relative path, exactly like the
  sibling `nudo test --freeze --dry-run` output, and can be consumed by
  `git apply`.
- A sidecar that imports something that is not a constraint builder (for
  example `import { totallyBogus } from "@nudojs/core"`) was diagnosed while
  the sidecar was executed, but the diagnosis was dropped as soon as the
  execution result was cached. Because the analyzer runs before the gate, the
  gate itself never saw it: `nudo check` reported success and exited 0 on a
  sidecar that could not be loaded. The diagnosis is now cached together with
  the execution result and reported again on every cache hit, so the gate
  reports `nudo:interface-load` and turns red.
