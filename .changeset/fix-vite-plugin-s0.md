---
"vite-plugin-nudo": patch
---

Internal restructuring only — no behaviour change.

The plugin entry point was split into three package-internal modules so the
individual concerns can be maintained separately:

- `scope.ts` — module id normalisation and analysis-scope decisions
  (include/exclude matching, the `shouldAnalyzeFile` guard, `config.root`).
- `check-assembly.ts` — assembling the `checkSource` call and turning its
  issues into diagnostics.
- `report.ts` — the diagnostic reporting loop, `failOnError` aggregation, the
  build-end summary, and the single message-rendering outlet.

`index.ts` is now a thin shell that only wires the plugin hooks together. The
plugin's public surface is unchanged: the package still exports exactly one
runtime symbol (`default`). The three new modules are not re-exported from the
entry point and are not part of the package's `exports` map, so they stay
internal.

The public behaviour of the plugin — which files are analysed, which
diagnostics are reported, and what the build end summary says — is unchanged
by this restructuring.
