---
"@nudojs/service": minor
"@nudojs/cli": minor
"@nudojs/lsp": minor
---

**feat(export)+review P0–P2**: dialect-aware schema export, Standard Schema path, CLI/LSP honesty fixes.

Service / schema:
- `absToSchemaSource` / `projectAbsToSchema` / `absToSchemaNode` — SchemaNode carries refinements and `dropped` notes.
- Projection prefers core `absToConstraint` (parity for `eq(self,lit)` → `z.literal`, or-literal unions, int/bounds/string length).
- `absToZodSchema` remains a deprecated alias → `absToSchemaSource(a, { dialect: "zod" })`.
- New `absToStandardSchemaModule` / `validateSchemaNode` — Standard Schema v1 modules (`~standard`, vendor `nudo`).

CLI:
- `nudo export --format schema [--dialect zod]` → `*.nudo.schema.<dialect>.ts`
- `nudo export --format standard` → `<fn>.nudo.standard.ts` (contract-first domains; joinAbs when no contract)
- `--format zod` remains a deprecated alias of `schema --dialect zod`
- Deprecated `infer --json`: stdout is **one** JSON document (test cases only); check --json stays a separate command
- `--ignore-throws` now **merges** with `package.json#nudo.check.ignoreThrows` (additive)

LSP:
- Gate codes (`nudo:entry-may-throw` etc.) keep Error **and Warning** under `analysis.diagnostics=off|errors` so IDE matches CLI when `entryThrows=warning`

Docs/product copy:
- Day1 sidecar example uses `fn({ params }, returns?)` (not bare `number().gt(0)` on a function export)
- Migration tables / help / generated markers use `schema`/`standard` and `nudo contract --emit`
