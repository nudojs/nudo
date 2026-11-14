---
"@nudojs/core": minor
"@nudojs/env": patch
---

Add `number().finite()` and sound relation-complement narrowing.

`number()` includes `NaN` and `±Infinity`, so a sequential guard such as
`if (x < 1) return 0; return x + y;` cannot assume `x >= 1` on the fall-through
path (`NaN < 1` is false). `number().finite()` adds the missing non-NaN evidence;
when it (or any numeric bound) is present, the evaluator refines the
fall-through / else arm with the complement of the relation guard at runtime
(`$refineRelComplement`, fail-closed without evidence; the arm's Phi and
`$refineNotNaN` also count as evidence). NaN guards (`Number.isNaN(x)`,
`x !== x`, `x === x`, `!Number.isNaN(x)`) establish `ne(x, NaN)` on the arm
where that holds; `Number.isFinite(x)` is one-sided (true arm only). A `const` / `let` /
`var` alias such as `const ok = Number.isNaN(x); if (!ok) { … }` is resolved in
the same function body or at module top level (a written alias name or guarded
variable, loop-header shadowing/assignment, catch parameters and function
boundaries drop the alias). A user-shadowed `Number` disables the builtin
guard fact (fail-closed). De Morgan spellings
(`x < 1 || y < 2`) are complemented per disjunct. The previous unproven results
for bare `number()` are unchanged.

Literal `NaN` / `±Infinity` arguments (including `0/0`, `Number.NaN`,
`Number.POSITIVE_INFINITY`) now violate a `finite` precondition instead of
passing silently; `NaN` and `±Infinity` globals are modeled as literals.

兼容性：新增 builder 方法与非 NaN 证据下的精度收紧；未使用 `.finite()` 的
既有契约输出逐字节不变。
