---
"@nudojs/core": patch
"@nudojs/service": patch
---

Add the `nudo:capability-denied` diagnostic (ABS-12 R12-D, strict by default). Host globals and `node:` modules classified as denied now report this code — values stay `unknown` and are never executed natively — instead of `nudo:builtin-unknown`; denied modules are reported at the import/require site. Module classification only covers builtins (`node:` prefix or `module.builtinModules`), so relative paths and npm packages keep their existing missing-module channel. `NUDO_CAPABILITIES=trusted` (or `setCapabilityMode("trusted")`) restores the previous `builtin-unknown` surface and limits runtime identity blocking to the hand-written high-risk list; unclassified names (typos) remain `builtin-unknown` in both modes. Docs updated (EN + zh-Hans). Pinned by `capability-diagnostics.test.ts` (strict/trusted, globals/modules/typos).
