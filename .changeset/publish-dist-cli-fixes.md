---
"@nudojs/cli": patch
"@nudojs/core": patch
"@nudojs/parser": patch
"@nudojs/service": patch
"@nudojs/env": patch
"@nudojs/harvester": patch
"@nudojs/lsp": patch
"vite-plugin-nudo": patch
---

Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
