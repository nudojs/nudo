---
"@nudojs/core": patch
"@nudojs/env": patch
"@nudojs/service": patch
---

Make `@nudo:env` actually affect inference: declaration-only fnSigs (readFileSync) now become relationFns instead of unknown-on-call, B-path `$invoke` implements string methods and filters union members, and `collectAbsCallRecords` merges env modules so call@ cases no longer overwrite correct B-path results.
