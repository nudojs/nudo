---
"@nudojs/core": patch
---

Let `checkSource`'s ambient-gated dependency fingerprint reuse the ungated fingerprint computed earlier in the same watch round. `LoadDepsFingerprint` now exposes the existing root sidecars the `ambientAllowed` gate could prune (`gatedSidecars`), and `LoadDepsFingerprintOpts` accepts `loaderIdentity` / `ambientLoaderIdentity` so per-call guard/cache wrappers participate in the round memo through their underlying loader. When no sidecar is filtered out, the gated and ungated fingerprints are byte-identical and the extra disk BFS is skipped; custom loaders with different content keep their own identity and never share, and fingerprints are only memoized for `opts === undefined` calls (a gated result can never leak into an ungated key). `check --watch` hub rounds drop from 718ms to 456ms `analyze` (total 667ms) on the 48-file semver corpus, leaf 345ms -> 210ms. Default (no epoch) behavior is unchanged; pinned by `load-deps-fp-epoch.test.ts`.
