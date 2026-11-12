---
"@nudojs/core": patch
---

Speed up Abs key serialization on cold full-tree analysis: `termKey` now accumulates `app` arguments in a loop instead of allocating an intermediate array with `map().join(",")`. Output is byte-for-byte identical, pinned by `term-key-serialization.test.ts`. On the synthetic 120-file corpus with a clean host env, one cold `analyzeFile` pass drops from ~13.3s to ~10.0s (about 25% faster) with unchanged RSS. A WeakMap memo of term keys was evaluated and rejected: despite a 75% repeat-call rate, lookup cost plus resident strings made it slower (21.6s) and raised RSS to 881 MiB.
