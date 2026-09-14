---
"@nudojs/core": patch
---

Fix directive-case args lost in early-return branches: fold `if (c) return X; …tail` into `return $fork` in B-path transpile, and join partial-return fall-through in AST `evalBlock`. `@nudo:case "A" (92)` on a graded if now yields `"A"`; `nudo test` expected cases pass; doctor-emitted `call@` solidifies correctly.
