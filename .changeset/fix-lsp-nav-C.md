---
"@nudojs/lsp": patch
---

LSP: capture the client's capabilities at `initialize`, and give the
navigation/IDE file gate a single source of truth.

- **Bug 749 — the server never kept `params.capabilities`.** `onInitialize`
  only echoed the server's own capability declaration, so no handler could
  answer according to what the client asked for: `textDocument/documentSymbol`
  always answered with the hierarchical shape and the full `SymbolKind` range,
  even when the client declared `hierarchicalDocumentSymbolSupport: false`
  or a restricted `symbolKind.valueSet`. The client capabilities are now
  captured during `initialize` and handed to the navigation handlers through
  the existing `deps` object (no new package export). When the client sends
  no capability section at all the value stays `undefined` and the handlers
  keep the default answer (hierarchical shape, full `SymbolKind` range) — an
  old client must not degrade the server's output. The `initialize` result
  itself is unchanged, so the declared server capability inventory is
  untouched.
- **Bug 751 — every request had its own file gate.** The sidecar contract
  file (`*.nudo.js`) was let through by `definition` only, was rejected by
  the other navigation requests and by all six IDE requests, and was listed
  by `workspace/symbol`, which had no gate at all — one coordinate, three
  different answers. The gate now has a single source of truth
  (`server.ts`'s `isNudoFile`, which explicitly excludes sidecar contract
  files) and the same predicate instance is injected into the navigation and
  the IDE handlers, so both sides answer alike. Sidecar exclusion is also
  spelled out in the predicate itself, so it survives a future drift of the
  path-level suffix table.
