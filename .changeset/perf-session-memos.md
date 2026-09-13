---
"@nudojs/core": minor
"@nudojs/service": minor
"@nudojs/cli": minor
---

Speed up repeated analysis with layered memos and tighter cache contracts.

- Shared parse/AST LRU, `generalizeFromAst` L0–L3 (instantiate, α-equivalence, dep fingerprint + LRU), Abs module cache, and session-wide memos with an incremental after-edit path.
- Host cache-eviction contract, AST/function-fingerprint memory caps, conservative call-scan depth cap, and fail-open truncated dependency fingerprints.
- Fix session-memo staleness and identity holes so after-edit results stay correct.
