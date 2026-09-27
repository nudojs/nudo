---
"@nudojs/service": patch
---

fix(service): honor `package.json#nudo.check.profile` in `checkConfig` (LSP parity)

The CLI resolves `nudo.check.profile` (`adoption` → L2 `warning`, `strict` →
`error`) but the service `checkConfig` — which the LSP uses for
`nudo-check` diagnostics — only read `nudo.check.entryThrows`. In a project
with `"nudo": { "check": { "profile": "adoption" } }`, `nudo check` printed
`nudo:entry-may-throw` as a **warning** while the IDE showed it as an
**error**.

`checkConfig` now applies the same preset, with the same precedence as the CLI
(`entryThrows` → `profile` → default `error`), and `NudoConfig["check"]`
gains the `profile` field.
