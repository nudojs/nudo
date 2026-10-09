---
"@nudojs/core": patch
---

fix(core): generalize display (hover intension) renders destructured params as `{ a, b }` via `formalParamSignatureNames` instead of the `_p0` evaluation placeholder, while entryReqs preds and promoted entryShapes/fnRels lookups keep using the placeholder keys (#138)
