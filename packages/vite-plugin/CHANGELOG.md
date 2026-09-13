# vite-plugin-nudo

## 0.3.0

### Minor Changes

- 5786fa5: Ship TypeScript-aware defaults and Abs check diagnostics in the Vite plugin.

  - Default include covers `.js` / `.mjs` / `.ts` / `.mts`; exclude also skips `*.d.ts`.
  - Glob matching is a real anchored RegExp (not `endsWith` heuristics).
  - Runs `analyzeFileAsync` plus `checkSource` so Abs constraint issues surface as Vite warnings/errors.
  - Exposes `clearAnalysisSessionCaches` for long-lived Vite processes.

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0
  - @nudojs/service@0.3.0

## 0.2.1

### Patch Changes

- @nudojs/service@0.2.1

## 0.2.0

### Minor Changes

- 6c38283: docs and ci
- 9f7f819: fix pkg info
- c175f71: version

### Patch Changes

- Updated dependencies [6c38283]
- Updated dependencies [9f7f819]
- Updated dependencies [c175f71]
  - @nudojs/service@0.2.0

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.

### Patch Changes

- Updated dependencies
  - @nudojs/service@0.1.0
