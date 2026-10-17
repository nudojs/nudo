---
"nudojs": patch
"@nudojs/service": patch
"@nudojs/lsp": patch
"@nudojs/harvester": patch
---

Classify fs "miss" vs "read failure" everywhere. Replaced every
`existsSync(p) && statSync(p)` double call (TOCTOU race + errno swallowing)
with a single `statSync(p, { throwIfNoEntry: false })` per the repo's
load-module convention: ENOENT stays a silent miss, EACCES/EIO surface via the
site's error channel (top-level catch, `reports.push({error})`, exit-1
message, or a logged warning) instead of masquerading as "file absent".
Read-failure catches now branch on `e.code`: sidecar contracts unreadable for
reasons other than ENOENT print a `warning: cannot read sidecar contract …`
in `check`/`check --fix` (no more silent contract-blind green runs);
`@nudo:mock` seed evaluation failures warn in `export` before degrading;
`pnpm-workspace.yaml` read failures other than ENOENT abort `migrate` (a
snapshot/read failure no longer disguises the file as "other" and skips
rollback); mock files that exist but can't be read report `read-failed` with
the errno instead of the misleading "Mock file not found"; npm entry
probes and LSP module-candidate stats log persistent failures instead of
degrading a package's export face to unknown or silently breaking
go-to-definition; `contract --from-dts` path-like arguments that don't exist
now error as `path not found` instead of being treated as npm package names
ending in a misleading `no .d.ts files found`.
