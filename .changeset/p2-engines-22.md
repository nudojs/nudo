---
"@nudojs/core": minor
"@nudojs/parser": minor
"@nudojs/service": minor
"@nudojs/env": minor
"@nudojs/harvester": minor
"@nudojs/lsp": minor
"nudojs": minor
"vite-plugin-nudo": minor
---

**BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.
