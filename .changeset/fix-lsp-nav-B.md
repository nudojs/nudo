---
"@nudojs/lsp": patch
---

LSP: make the navigation face answer per the client's capabilities, encode
URIs correctly, validate rename targets, and give every navigation request
the same file gate.

- **Bug 745 — `workspace/symbol` never returned class members.** The handler
  only walked the *top level* of `documentSymbols`, while class methods and
  class properties live in a symbol's `children` ⇒ they could never appear
  in a workspace search. The handler now walks the tree recursively and
  flattens it into `SymbolInformation[]`, expressing the hierarchy through
  `containerName` (which is what the flat LSP protocol expects).
- **Bug 748 — `filePathToUri` and `uriToFilePath` were not inverses of each
  other.** The encoding side concatenated `file://` with the raw path (so
  `%`, `#`, `?` and spaces were never escaped) ⇒ the server produced URIs
  that were not valid URIs; the decoding side ran a bare
  `decodeURIComponent` ⇒ a malformed percent escape threw an uncaught
  `URIError` and aborted `didOpen` / `didChange` / `didClose`, leaving that
  document with **zero diagnostics**. The encoding side now uses Node's
  `pathToFileURL` and the decoding side uses `fileURLToPath` with a
  `try`/`catch` fallback (malformed input degrades to the undecoded text and
  never throws), so the two are exact inverses; `cacheKey` benefits as well.
  URIs for non-`file:` schemes (`untitled:` …) are still returned verbatim.
- **Bug 749 — `textDocument/documentSymbol` ignored the client's
  capabilities.** The server never kept `params.capabilities`, so it always
  answered with the hierarchical shape and the full `SymbolKind` range even
  when the client declared `hierarchicalDocumentSymbolSupport: false` or a
  restricted `symbolKind.valueSet` (both are protocol violations). The
  navigation handlers now consume the client capabilities that
  `initialize` captured: a client without hierarchical support receives a
  flat `SymbolInformation[]` (`location` instead of
  `range` / `selectionRange` / `children`), and a kind outside the client's
  `valueSet` is clamped to a safe value inside that set (with a note in
  `detail`). When the client sends no capability section at all the default
  answer is kept — hierarchical shape, full `SymbolKind` range.
- **Bug 750 — `textDocument/rename` never validated the new name.** The
  request's `newName` was used as the replacement text verbatim ⇒ a single
  rename could turn the source into invalid JavaScript (an invalid
  identifier, an empty name or a reserved word) and `node --check` would
  fail with a `SyntaxError`. The new name is now checked at the syntax
  level — it must be a legal JavaScript identifier, non-empty and not a
  reserved word — and an invalid name produces no edits at all.
- **Bug 751 — the navigation requests each had their own file gate.** The
  sidecar contract file (`*.nudo.js`) was let through by `definition` only,
  was rejected by the other four navigation requests, and was listed by
  `workspace/symbol`, which had no gate at all ⇒ one coordinate, three
  different answers (the server contradicted itself). `definition` no longer
  has its sidecar escape hatch and `workspace/symbol` now uses the same
  path-level gate, so sidecar contract files are invisible to every
  navigation request. (The cost is that a source symbol can no longer jump
  into its sidecar contract; that capability needs the symbol table to model
  sidecar bindings and is tracked separately.)
