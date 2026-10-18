---
"@nudojs/core": patch
---

Follow-up to the member-surface and throws-domain clusters: the fn face
of `Function.prototype` (host `fn.prototype` member read, Bug 92) and the
proto projection used by `Object.getPrototypeOf` (`protoBrandAbs`) were
two distinct Abs values for the same native object, so
`Object.getPrototypeOf(g) === Function.prototype` folded wrong-exact
`false`. `functionProtoAbs()` is now the single resident value used by
both the fn-shape and base-class-value arms of `protoOfRecv` and the
host-function `.prototype` read (Bug 58/85 suite restored; native
`extends null` class values still resolve to `Function.prototype`).
`@nudo:invariant` levenshtein main-target case now splits its L2
expectation (`ignoreThrows: ["RangeError"]`) for the legitimate
`Array.from` array-like-length may-throw added with Bug 129, and the
#136 regex-capture signatures are re-pinned to their sound domains —
the zero-iteration arm of `while ((m = re.exec(s))) … return null` now
joins (Bug 99), so `parts`/`named`/`orAlt` keep their native `null`
arm instead of the previously pinned unsound exact.
