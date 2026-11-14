---
"@nudojs/core": patch
"@nudojs/parser": patch
"@nudojs/service": patch
---

Propagate the source filename into parse-mode selection for pure-JS paths.

`parseSource` already skips the strip-types pass for `.js/.mjs/.cjs/.jsx`
(structurally a no-op there), but service / transpile / module-graph / fingerprint
/ directive-scan call sites omitted the filename, so JS sources were parsed in
ts mode and paid two extra full-AST walks. Threading `filename` from
`analyzeFile`, `transpileModule`/`runTranspiled`, the abs module graph, load-deps
fingerprints, directive extractors and `localNamedExports` drops a 9.14 MB
self-contained JS file from 20,755ms to 14,594ms (-29.7%); the remaining
strip-types share in the profile is ~2% (`checkSource` path 1.7%).

兼容性：解析模式由文件扩展名决定（缺省仍为 ts 模式，未知扩展名行为不变）；
`.js` 里的 TS-only 语法仍是 syntax-error（Bug 114 / Bug 451 口径不变）。
