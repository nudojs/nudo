---
"@nudojs/lsp": patch
---

Cross-file navigation follows the module graph the editor actually shows.

- A default export had no cross-file references: `export default function
  greet()` in one file and `import greet from "./a.js"` in another — the
  definition jumped across files, but the references of that definition
  were empty. The export name of a symbol is now resolved before the
  importers are matched, so `default` is a first-class export name and the
  importing file shows up in the references.
- A namespace import was read as if it named a single export:
  `import * as ns from "./def.js"` made every occurrence of `ns` a
  reference to *every* export of the imported file, including the ones the
  file never mentions. A namespace import now contributes only its member
  accesses (`ns.beta`), and a bare `ns` is not a reference.
- Renaming an exported symbol across files edited the wrong side of an
  aliased import: `import { oldName as alias }` became
  `import { oldName as newName }` — the imported name was left behind, so
  the import no longer resolved and the module failed to load — while the
  alias, which is a separate local binding, was renamed. The imported side
  of the import specifier is edited now, the alias and its call sites are
  left alone, and renaming the alias itself no longer reaches into the
  imported module.
- The fallback that jumps to a same-named export in the workspace fired
  on member accesses: `o.helper` jumped to an unrelated
  `export function helper` in another file. The fallback applies to plain
  identifiers only.
- Cross-file definition, references and rename read the file from disk
  instead of the editor buffer, so an unsaved edit was invisible and the
  positions were off by the number of unsaved lines. The open document is
  the source of truth now, and the disk is only a fallback.
- A re-export was invisible to references and rename: `export { a } from
  "./m.js"` established no edge, so renaming `a` in `m.js` left the
  re-export untouched and broke the module. The re-export edge is followed
  now, in both directions: the references of a re-export cover the target
  module, and renaming either side keeps the two in sync.
- The sidecar contract lookup pointed at bindings the engine never
  consumes. Only an exported `fn({ … }, …)` binding is a contract (a value
  template such as `number().gt(0)` is reported as `not fn() form` and has
  no effect), so go-to-definition no longer sends the user to a binding
  that cannot take effect.
