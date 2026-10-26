---
"@nudojs/env": patch
---

Update env source comments: the env-skip list is now the derived `getEnvShadowSkipGlobals` (namespace identity routing + host intrinsic names) rather than the old `ENV_SHADOW_SKIP_GLOBALS` constant. Comment-only; no runtime behaviour change.
