---
"@nudojs/core": minor
"@nudojs/service": minor
"@nudojs/lsp": patch
"@nudojs/env": patch
---

Reorganize the dts pipeline and tighten analysis/diagnostic behavior across the stack.

- `@nudojs/service`: dts emission now goes through a single typed `DtsType` IR. Legacy `absToTSType` / `absToTSTypeB` helpers are no longer exported from the emit surface; class, module, value, signature, JSDoc and assembly stages live in focused modules.
- dts: annotation gates, class inheritance/generic members, validator return widening, `export =` / `import = require`, namespace objects, `unique symbol`, user symbols and unresolved-member ledgers are covered by the new pipeline. Added a `tsc --strict` compile matrix and an independent hand-written `DtsType` oracle.
- `@nudojs/core`: iteration and predicate internals are split into capability, guard, element, spread/rest, for-of/for-in, template-object, user-iterator, nullish, typeguard, discriminant and switch modules behind stable facades.
- tsconfig/module resolution: inherited `paths`/`baseUrl`, `extends` arrays, paths wildcard longest-prefix selection and NodeNext `.js`/`.mjs`/`.cjs` specifier rewrites are covered by regression tests; runtime load and annotation resolution share one rewrite table.
- diagnostics: CLI and LSP share protocol codes, severity and source-range parity tests; scope-dependent diagnostic set differences remain intentional.
- `@nudojs/env` / `@nudojs/lsp`: host Node built-in resolution and path argument verdict order fixes are included.
