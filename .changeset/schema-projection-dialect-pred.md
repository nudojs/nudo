---
"@nudojs/service": minor
"@nudojs/cli": minor
---

**feat(export)**: dialect-aware schema projection + Standard Schema runtime path; CLI product face is `schema`/`standard`.

Service:
- `absToSchemaSource` / `projectAbsToSchema` / `absToSchemaNode` — SchemaNode carries refinements (`gt/ge/lt/le`, `int`, string `min/max`) and `dropped` notes.
- `absToZodSchema` remains a deprecated alias → `absToSchemaSource(a, { dialect: "zod" })`.
- New `absToStandardSchemaModule` / `validateSchemaNode` — Standard Schema v1 modules (`~standard`, vendor `nudo`) with runtime enforcement of the same refinements. Zero third-party validator deps.

CLI:
- `nudo export --format schema [--dialect zod]` → `*.nudo.schema.<dialect>.ts`
- `nudo export --format standard` → `<fn>.nudo.standard.ts`
- Standard export prefers **contract domains** (`effectiveInterface` → `constraintToEntryAbs`); without a contract, args are the join of observed call-site Abs — not a pinned literal
- `--format zod` remains a deprecated alias of `schema --dialect zod` (stderr warning; removed next major)
- Help/docs narrative: dts / guard / schema / standard
