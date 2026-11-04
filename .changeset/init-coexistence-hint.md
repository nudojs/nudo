---
"nudojs": minor
---

Feat: `nudo init` coexistence pointer + copy-paste default client configs (LSP-G4 DX).

- init: after writing the adoption baseline, when the target package has `tsconfig.json` / `jsconfig.json`, init appends a coexistence hint block — the VS Code command `nudo.coexistence.apply` ("Nudo: Apply coexistence settings") and the coexistence-guide recipe URL (`include`/`exclude` / `mode: "directives"`). Print-only: no tsconfig / editor settings are rewritten; the minimal-write discipline (Bug 681) and the existing init boundaries (B676/677/678/680, Bug 1144, Bug 229) are unchanged, and the idempotent no-write path prints no hint.
- website (EN + zh-Hans mirrors): lsp-clients Setup notes upgraded to copy-paste default config blocks — the Zed `settings.json` block now ships `semantic_tokens: "combined"` inline (previously prose-only); Neovim lspconfig and Helix `languages.toml` blocks are labeled as complete copy-whole defaults. zed.md Settings gets the same semantic_tokens fold. Known-gaps G4 rows (both locales) note the init pointer; `docs/design/lsp-client-gaps.md` G4 status records it.
