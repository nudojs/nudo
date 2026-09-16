---
"@nudojs/core": patch
"@nudojs/service": patch
"@nudojs/cli": patch
"@nudojs/lsp": patch
---

Review fixes on feat/interface Phase 1:

- **autoBind kill-switch**: analyzer's cross-file `nudo:interface-domain-exceeds` path now reads `package.json#nudo.interface.autoBind` (was silently ambient-loading sidecars when `autoBind: false`).
- **`nudo check --callsites`**: inject usage-site call records so CI gate can surface `nudo:interface-domain-exceeds` (previously only reachable via analyze/interface paths).
- **Sidecar auto-bind coverage**: `localNamedExports` accepts local `export { x }` / `export { local as exported }` list form (was declaration-only; silent miss for common style).
- **Directory targets**: `isNudoTargetPath` excludes `*.nudo.js` / `*.nudo.ts` so check/infer/doctor no longer treat contract modules as source.
- **VS Code client**: documentSelector includes TypeScript; file watcher covers `**/*.{js,mjs,ts}` (includes `.nudo.ts` sidecars).
- **LSP emit**: failed `interfaceEmit` no longer claims "sidecar written" and skips the invalidation path.
- **UX**: first `--emit` with empty default targets prints a `--fn`/`--all` tip; `--fn`/`--all` without `--emit` warn; CodeLens titles use "interface" not "refine"; domain-exceeds message is English (matches other diagnostics).
