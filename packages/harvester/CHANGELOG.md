# @nudojs/harvester

## 0.2.0

### Minor Changes

- 5786fa5: Auto-inject `@types` during analysis-path harvest and guard oversized dts work.

  - Analysis can resolve package roots upward and feed harvested Abs into the B module graph.
  - `harvestDts` accepts optional `maxFileBytes` / `maxMs` and skips unreadable or oversized files instead of failing the run.

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0
