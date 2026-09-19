---
"@nudojs/core": patch
"@nudojs/env": minor
"@nudojs/lsp": patch
"@nudojs/service": minor
---

**BREAKING (behavior)** `@nudojs/service`: handwritten `@nudojs/env` now **wins** over harvest / module-graph modules on overlapping module keys and export names (`mergeHarvestUnderEnv`). This restores the documented B8 priority — harvest only fills missing slots. If analysis relied on harvest overwriting a handwritten env export, update or remove that slot.

- `@nudojs/service` (minor): public harvest helpers — `mergeHarvestUnderEnv`, `clearNodeHarvestCache`, `getNodeHarvestCacheSize`, `isHarvestNodeDisabled`, `HARVEST_NODE_DEFAULT_*`. Negative harvest outcomes (`not-found` / `no-dts` / `failed`) are cached in-process; `NUDO_HARVEST_NODE=off` stays explicit and uncached.
- `@nudojs/env` (minor): add `events` / `stream` / `querystring` modules and high-frequency `fs.promises` / `util` slots. Variadic / optional Node APIs declare **min arity + rest/optional labels** (not N fixed required slots) — e.g. `path.join` → `(string, ...paths: string) => string`.
- `@nudojs/core` (patch): `formatShape` renders fn rest labels (`...paths`) and optional labels (`options?`).
- `@nudojs/lsp` (patch): freeze inventory constants in `public-api.ts`; agent slash requests register from `NUDO_AGENT_TOOL_NAMES` (no second hardcoded list).

Migration for env consumers who need bit-stable hover/format strings: pin `@nudojs/env` `~0.3.0` after the next release, and prefer **leaf-clean** coverage counts over raw resolved ratios.
