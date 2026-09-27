---
"@nudojs/core": patch
---

fix(core): RegExp.exec precision with non-literal subject + nullish return prefilter

Two return-path defects that both show up in the classic "parse and return null
on no-match" shape:

1. `execRegexBrand` documented "exec → null|tuple 的保守并" for a subject that
   is not a string literal but returned `undefined` instead. The caller then fell
   through to the "method not found" path and the result became the Abs
   `undefined`: `typeof m` folded to the literal `"undefined"`, `m === null` folded
   to `false`, capture groups stayed unknown, and `Number(m[1])`-style returns
   collapsed. `exec` now returns the conservative `null | array(string|undefined)`.

2. `checkReturnConstraint` reported a `null` return as violating a `shape({...})`
   contract. lit `null`/`undefined` cannot satisfy any constraint, so reporting
   it is a false positive (`return null` means "no value", not "wrong value").
   Nullish evidence is now prefiltered there too, matching the parameter-side
   prefilter (`scan-injected-domain`, T4 caveat).

Real-world case: a `parseVersion(v)` that returns `null` for unparsable input
and `{ major: Number(m[1]), … }` otherwise — with #40's sum distribution the
remaining report was the nullish member alone.
