---
"@nudojs/core": patch
"@nudojs/service": patch
---

fix(core): more JS semantics soundness — Array.of / .at() / postfix ++-- / ToPrimitive

- `Array.of` packs arguments into a tuple, not an array of the first element
- `.at()` honors ToIntegerOrInfinity (string.at + array.at index)
- postfix `++`/`--` writes back inside the expression
- `+` honors ToPrimitive/ToString for arrays, objects, undefined
- drop dead duplicate `case "promise"` in checkNode
