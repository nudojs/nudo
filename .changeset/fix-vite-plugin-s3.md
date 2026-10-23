---
"vite-plugin-nudo": patch
---

The build plugin no longer hides contract failures or drops diagnostics.

**Breaking behavior changes**

- `nudo.analysis.diagnostics: "off"` no longer silences the **contract gate**.
  Previously the check-gate diagnostics (L1 `nudo:constraint-violated`, L2
  `nudo:entry-may-throw`) were merged into the display path and filtered
  together with it, so an `off` project reported **zero** diagnostics and a
  build with `failOnError: true` still **passed** — a green CI on a broken
  contract. The gate channel is now separate: error-level check diagnostics
  are reported and still fail the build under `failOnError: true`, in every
  diagnostics tier including `off`. The display path (evaluator diagnostics,
  path-env failures, and check warnings/info) keeps the old tier semantics.

- `build.logLevel: "silent"` now silences **everything** the plugin prints.
  The build summary used to be written with a bare `console.log`, which
  escaped Vite's logger: a silent build still printed
  `[nudo] Analysis complete: N error(s), M warning(s)` while none of the N
  diagnostics were shown. The summary now goes through Vite's logger, so a
  silent build prints nothing at all.

**Fixes**

- `failOnError: true` reported only the **first** error-level diagnostic and
  dropped the rest, while the build summary counted them all ("2 error(s)"
  next to a single reported error). The first error still fails the build;
  every remaining error-level diagnostic is now reported as well, so the
  summary count and the number of reported diagnostics agree.

- Diagnostics without a source position were rendered as `:0:0` (a line that
  does not exist) or `:1:0` (an invented first line). A diagnostic with no
  position now omits the `:line:col` part entirely, matching the CLI, which
  prints no location for the same diagnostic.

- The evaluator-side diagnostics dropped their `(nudo:code)` suffix, so a
  single build log mixed two text formats and `grep '(nudo:'` only found half
  of the diagnostics. Every diagnostic now carries its code, and the two
  sources use the same format.
