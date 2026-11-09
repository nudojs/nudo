---
"@nudojs/core": major
"@nudojs/service": major
"nudojs": major
"@nudojs/lsp": major
"vite-plugin-nudo": patch
---

Rename the remaining Nudo `interface` terminology to `contract` end to end.

- Core: `effectiveInterface` → `effectiveContract`, `InterfaceSource` → `ContractSource`, `InterfaceTierInfo` → `ContractTierInfo`, `interfaceTierOf` → `contractTierOf`, `takeInterfaceDiags*` → `takeContractDiags*`, and the `algebra/interface/` directory → `algebra/contract/`.
- Service: `emitInterface` / `draftInterface` / `interfaceSurface` → `emitContract` / `draftContract` / `contractSurface`; `interface-*.ts` files → `contract-*.ts`; `ifaceCacheKey` → `contractCacheKey` and the disk-cache namespace `iface` → `contract`.
- Diagnostics: `nudo:interface-*` → `nudo:contract-*` (no alias layer).
- CLI/LSP: CodeLens titles `⚡ persist contract` / `↻ update contract` / `⚡ draft contract`; agent messages `no contract found` / `no contract changes`; `CheckIssue` actions and hover/inlay fields use `contractSource` / `contractDisplay` / `contractActive`.
- Docs, examples (`contract-derivation/`, `contract-draft/`), API snapshots, and website references updated.

TypeScript's `interface` keyword, Babel AST `TSInterface*`, and historical release notes are intentionally unchanged.
