---
"@nudojs/core": patch
"@nudojs/service": patch
"@nudojs/lsp": patch
---

Final review pass on feat/interface Phase 1:

- **LSP emit bound live**: `handleInterfaceEmit` now passes `agentToolDeps` so `workspaceRoots` reach `assertEmitTargetAllowed` (was dead in production).
- **Emit fail-closed**: empty `workspaceRoots` rejects; no ancestor-`package.json` authorization fallback; `realpath` blocks symlink escape; refuse writes under `node_modules`.
- **autoBind kill-switch complete**: threaded through scan `generalizeFromAst` / same-file `eiOpts`; empty `fromFile` no longer ambient-binds `.nudo.js`.
- **Conflict skip**: conflicted params no longer also emit call-site `constraint-violated`; detect eq/eq and eq/bound unsat.
- **Return contracts**: string length bounds (`string().min/max`) enforced via domain membership.
- **Perf/stability**: file-local `effectiveInterface` memo in check; `take*Since` on memo hit/miss (no LSP diag theft); `shift` rejects non-finite offsets; `@generated` marker requires adjacent comment block; add-mode empty targets no longer rewrite trailing whitespace; emit tmp name randomized.
