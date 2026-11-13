---
"nudojs": patch
---

Speed up `check --watch` incremental rounds by reusing the evaluator injection object per file across rounds and by memoizing dependency fingerprints within a round. `checkMemoKey` keys on `moduleMapId(modules)` (identity), so rebuilding the injection for every file on every round made the check memo miss; the injection is now cached under the exact analysis-input identity (stable source × dependency fingerprints × env names/contents × preload state × autoBind × analysis config), and dependency fingerprints computed by the injection key, `analyzeFile` and the printer are shared inside a round. On the 48-file semver corpus an inert edit round drops from 2600ms to 718ms for a hub file (`total` 929ms, under the 1s target) and to 345ms / 555ms for a leaf; semantic edits still recompute the dependency chain. Diagnostics collected during injection assembly are replayed on a cache hit, and truncated / read-error fingerprints opt out of the cache (fail-closed).
