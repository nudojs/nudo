---
"@nudojs/lsp": patch
---

The code-action face of the language server no longer crashes and no longer
writes broken code into the user's sources.

- The language server captured the agent-tool dependencies before the server
  had finished initializing, so every `textDocument/codeAction` request threw
  and the whole face was unavailable. The dependencies are now read on demand.
- The quick fix for a missing call-site field wrote the literal `undefined`
  into the source, which then failed the very check it was meant to fix. The
  placeholder is now `null`, and the violation is still reported afterwards.
- The quick fix that adds a field to a contract inserted it into the
  parameter list instead of the parameter's shape, producing a sidecar that
  no longer parsed. The insertion point is now located through the syntax
  tree, and a field that is already declared is not offered at all.
- The quick fix that inserts a call-site field used a textual heuristic that
  could land inside a string literal. The insertion point is now located
  through the syntax tree, and the fix is not offered when there is no object
  argument.
- The quick fix that writes a sidecar inserted the new declaration at the
  top of the file, which left the previous contents in place and produced a
  file with a duplicate export. The edit now covers the existing sidecar, and
  a plan that would duplicate an export is not offered.
