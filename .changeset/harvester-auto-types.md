---
"@nudojs/harvester": minor
---

Auto-inject `@types` during analysis-path harvest and guard oversized dts work.

- Analysis can resolve package roots upward and feed harvested Abs into the B module graph.
- `harvestDts` accepts optional `maxFileBytes` / `maxMs` and skips unreadable or oversized files instead of failing the run.
