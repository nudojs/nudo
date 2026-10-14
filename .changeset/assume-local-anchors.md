---
"@nudojs/core": minor
---

`@nudo:assume` name resolution extends from parameters only to parameters ∪ top-level `const`/`let`/`var` locals of the anchored function's body (#165).

- names resolve against plain `Identifier` declarators among the body's direct statements — destructuring, nested blocks, and `for`-init declarations stay out; unknown names fail with `nudo:assume-invalid` (`name(s) not bound as parameters or top-level locals`)
- locals follow SSA semantics — the lemma anchors the bound value at its definition point and applies to the end of the scope; after a reassignment the relevance conservatively lapses (no fold)
- anchoring activates only in the target function's own frame — callee frames see an empty premise slot, so same-name locals there cannot mismatch
- constant bounds still belong to sidecars; since a sidecar cannot reach a function's own locals, a local's constant contract goes on the producing callee's return (e.g. a levenshtein sidecar `return number().ge(0)`)
