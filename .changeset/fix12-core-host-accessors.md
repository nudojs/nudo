---
"@nudojs/core": patch
---

Host-global function collection no longer leaks Node lazy-getter warnings, and check hints point at the env directive (fix-12 batch).

- `hostGlobalFnIds` skips accessor properties by descriptor shape (deny-by-default) instead of a name denylist — bare-node embedding consumers no longer emit `ExperimentalWarning`/`DeprecationWarning` for localStorage, punycode (DEP0040), sys (DEP0025), wasi/ffi; only the empirically warning-free, function-valued accessors (`Buffer`, `assert`, `events`, `stream`, `node:test`) are read. Future warning-emitting lazy getters are skipped automatically (fail-closed); parity probe on node 26 confirms an identical 122-function collection set.
- Opaque-result diagnostics now suggest `/// @nudo:env` when the file imports builtin modules with no env active.
