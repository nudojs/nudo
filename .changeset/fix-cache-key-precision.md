---
"@nudojs/core": patch
"@nudojs/service": patch
"@nudojs/harvester": patch
---

Fix stale-cache windows in cache keys and session eviction. `nodeHarvestCacheKey`
floored `mtimeMs` to whole seconds (same-second, same-size rewrites of
`@types/node` reused a stale harvest — now uses the raw float mtime, matching
the repo-wide `mtimeMs+size` strict-equality contract). The path-env cache
key/validation only compared `mtimeMs` (coarse-mtime filesystems could keep
serving a stale `defineEnv` factory and re-register it, self-perpetuating — now
`mtimeMs+size`, and the direct-import URL query carries `size` so the ESM
module cache can't replay old content). The path-env fallback copy filename
hashed only `path:mtime` — rewritten content now hashes into the filename so a
changed file gets a new URL and the ESM cache invalidates naturally. Harvest
caches (`harvestCache`, node not-found cache) had no production eviction —
`clearAnalysisSessionCaches()` now clears both, so `pnpm install` / watcher
rounds see upgraded or newly installed `@types` without a process restart.
`checkMemoKey` now normalizes `filePath` via `stablePathKey` (same file no
longer occupies two entries under different path shapes).
