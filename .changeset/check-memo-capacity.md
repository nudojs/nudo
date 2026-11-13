---
"@nudojs/core": patch
---

Fix whole-file `checkSource` memo thrashing on medium monorepos: raise `MAX_CHECK_MEMO` from 256 to 1024 (aligned with `MAX_GENERALIZE_MEMO`). A sequential full scan over more files than the LRU capacity evicts the very next entry to be read, dropping the hit rate to zero — warm `check all` degenerated into a full recompute (real corpus: 43.9s; a 200-file control run inside the old capacity was 433.7ms). The per-round `evalRunMemo` keeps its own 256 bound. The cache stays bounded: the LSP resident-session memory discipline is unchanged.
