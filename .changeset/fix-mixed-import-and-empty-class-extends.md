---
"@nudojs/core": patch
---

`import d, * as ns from "…"` binds the namespace, and an empty class
expression keeps its `extends` clause.

- The default + namespace import form was flattened into
  `import { default as d, * as ns } from "…"`, which is neither valid ESM
  nor matched by the namespace rewrite (the `*` has to follow the `{`
  directly), so the named branch treated `*` as an imported name and the
  namespace binding folded to `unknown`. The mixed form is now emitted in
  its standard ESM shape and rewritten accordingly.

- A class expression with an empty body took a fast path that emitted
  `$classExpr()` before `classSpecOf` read the `extends` clause, so the
  prototype chain and the class registration were both lost:
  `new B() instanceof A` folded `false` and `extends null` did not raise
  its `TypeError`. An empty body now only takes the fast path when the
  class has no superclass.
