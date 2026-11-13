---
"nudojs": patch
---

Add `--capabilities strict|trusted` to `check`, `test` and `health` (ABS-12 R12-D). `strict` (default, same as `NUDO_CAPABILITIES=strict`) hides side-effectful host globals and `node:` modules: values stay `unknown`, denied names report `nudo:capability-denied`, and the canary suite proves no socket/file/process side effects. `trusted` restores the legacy `builtin-unknown` surface while the hand-written high-risk host-function blocklist stays active. Invalid values fail with a usage error. Docs updated (EN + zh-Hans).
