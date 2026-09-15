---
"@nudojs/core": patch
"@nudojs/service": patch
"@nudojs/lsp": patch
---

Fix hover, case switching, and NaN folding in Zed-style clients.

- `const n = double(21)` reports the init Abs (`42`) instead of the statement's `unknown` (record the declarator id in `evalVarDecl`).
- `const s = double("a")` is `NaN` (JS `"a" * 2`), not `unknown` — concrete string/boolean lits coerce under ToNumber; `formatAbs` prints `NaN`/`Infinity` instead of `null`.
- Relational compare folds mixed concrete lits (`"a" > 3` → false), so `if (x > 3)` does not join both branches for NaN inputs.
- `joinValues` uses `Object.is` so `join(NaN, NaN)` stays `NaN` (`NaN === NaN` is false).
- `workspace/executeCommand` accepts positional `nudo.selectCase` args from CodeLens (`[uri, fn, index, name]`).
- Hover inside `@nudo:case` functions goes through TypeValue + `activeCases` instead of call-site B-path nodes.
- Param inlay no longer invents `where x > 3` from `if (x > 3) return x` — only explicit `@nudo:refine` contracts show as preconditions.
- Return inlay is a path summary with source param names: `x + 1`, `x | x * 2` (not the refined `number where x>3 | string | …` dump).
- Number range narrowing uses exclusive bounds (`> 3`, not integer-style `>= 4`).
- Concrete `if` tests no longer narrow the tested value into a range (`44 > 3` keeps `x` as `44`).
- True branch of `x > k` on unknown refines to `number>… | string` (JS ToNumber space).
- `flattenSum` keys prim members by term/pred so `number=A1>3` and `number=A1*2` stay distinct paths.
