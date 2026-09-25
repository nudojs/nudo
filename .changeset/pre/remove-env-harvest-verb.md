---
"@nudojs/cli": major
"nudojs": major
---

feat!: remove `env harvest` from the product CLI face

Harvest is not a user task. Product verbs are `check` / `test` / `contract` / `export` / `health`.

- **BREAKING:** `nudo env harvest` (and the `env` command group) is removed. Third-party `@types` still auto-fill during analysis via module-graph harvest; env-package generation stays available as the `@nudojs/harvester` library.
- Handwritten `@nudojs/env` remains the fixed product env (`es` / `web` / `node`) and still wins over harvest on overlapping modules/exports.
- Scripts that called `nudo env harvest` should either rely on analysis auto-fill or call `harvestDts` / `emitEnvModule` from `@nudojs/harvester` directly.
