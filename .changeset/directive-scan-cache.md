---
"@nudojs/core": patch
---

Cache directive-scope scanning per AST and version facet keys.

`listFnDirectiveScopes` was re-walking the whole AST for every function query
(`findFnDirectiveScope` is called per function by `checkSource`), i.e.
O(functions × nodes). A WeakMap keyed by the parsed AST makes it one walk per
file: `@babel/parser/lib/index.js` (0.49 MB) check
13,179ms → 4,675ms (-64%). The AST is immutable during analysis and
`parseSource` returns the same object for the same source, so caching cannot
change results; a regression test pins the identity.

`facetKey` now carries a `v1:` prefix (`FACET_KEY_VERSION = 1`) so future
kind/prefix/order semantics changes get a fresh key space; empty facets still
encode as `""`. Facets are also pinned as observation-only (not part of
`leqAbs` / `formatShape`) — promoting a slot to value semantics requires the
Shape migration gate (gold + real-package zero-FP + differential corpus).

兼容性：内部缓存键与性能变化；未使用 facets 的 Abs 键逐字节不变。
