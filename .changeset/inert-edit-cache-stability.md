---
"@nudojs/core": patch
"nudojs": patch
---

Stop invalidating the whole dependency chain for inert edits. Dependency contents now enter every cache key through the same `stableAnalyzeKeySource` projection the entry file already used: trailing comments/whitespace that carry no `@nudo` directive no longer flip the dependency fingerprint (check disk keys, evaluator memo, generalize L0, per-fn memo), while real code, line shifts and `@nudo` directives still do. `check --watch` now evicts only the files that actually changed; dependents rely on the content fingerprints to miss (semantic edit) or hit (inert edit).

Measured on the 48-file semver corpus (dist, clean `NODE_OPTIONS`): hub edit `analyze` 3313ms → 2597ms, leaf 1009ms → 875ms. A single dependent's `analyzeFileAsync` drops from ~663–734ms to 9.9ms after an inert dependency edit, while a semantic edit still misses (172ms). The residual watch cost is the `check` verb's own `checkSource` (~500ms/file, memo keyed by module-map identity), tracked as the next ABS-18 item. Pinned by `load-deps-fp-stable.test.ts` and `abs18-watch-inert-eviction.test.ts`.
