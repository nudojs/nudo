---
"@nudojs/service": minor
---

新增两个诊断码 `nudo:module-unreadable`（模块**存在但不可读**）与
`nudo:json-invalid`（JSON 语法非法）⇒ **新诊断码**属增量（additive）⇒ minor。

Modules are resolved the way Node resolves them, and a dependency that
cannot be loaded is named for what it is.

- `require("./data")` was reported as "module not found" even when
  `data.json` sat right next to it, and `import "./data"` was accepted even
  when only `data.js` existed. The CommonJS and the ESM resolution rules are
  applied separately now: `require` follows the `require` condition and
  resolves extensionless paths, `import` follows the `import` condition and
  requires the extension.
- A bare package with a conditional `exports` map always resolved to the
  CommonJS build, because the conditions were ordered with `require` first.
  The condition is now chosen by the kind of import.
- `node_modules` was searched in one directory only. The search now walks up
  the tree the way Node does.
- A package's own `#imports` mapping was not supported at all and produced
  no diagnostic, so the imported value silently collapsed to `unknown`. It is
  resolved now, and an unresolvable `#` specifier is reported.
- A dependency that exists but cannot be read (`EACCES` and friends) was
  folded into "file not found" — a statement about the opposite of the fact —
  and, in the check path, escaped as an uncaught error that killed the whole
  run. "Unreadable" and "absent" are separate outcomes now, and an unreadable
  dependency is reported as `nudo:module-unreadable`.
- A `.json` dependency was loaded as JavaScript, failed, and was dropped
  without a word. Its value is imported now; invalid JSON is reported as
  `nudo:json-invalid` instead of being called a missing module.
