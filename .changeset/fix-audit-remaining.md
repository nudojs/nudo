---
"@nudojs/core": patch
"@nudojs/service": patch
"nudojs": patch
---

Resolve the remaining audit batch: type-text mapping, entry domains, narrowing, dts/validator projection, builtins, and contract-draft evidence.

- TS annotations: same-file interface/type-alias references, generic type parameters and constraints, function/method signatures, index signatures, literal terms (including hex/bin/oct/BigInt/separators), readonly tuples, tuple labels, intersection merging, `keyof`, indexed access and template literal types now map into the entry domain. Explicit `unknown` annotations are declarations, not inference failures.
- Check/entry: default initializers, destructured defaults, rest annotations and optional-parameter undefined arms seed the same entry domain used by dts/guard/zod/standard; local `let`/`var` annotations feed assignment reconciliation.
- Narrowing: `typeof` narrows `unknown` and member targets, user-defined type predicates participate in call-site narrowing, `in` produces union pruning facts, member logical assignments write back, and switch/fallback arms apply negated guard facts.
- dts/validators: annotation gates recognize rest tuples, global lib type names and `typeof` value references; literal and readonly declarations survive observed returns; class fields/accessors and object methods keep their signatures; module value aliases, default interfaces, `export type`, class expressions, user symbols and `unique symbol` render correctly.
- Builtins: `Object.fromEntries` expands typed entry arrays; `String.match` and array iterators retain per-index/element domains; `flat` no longer joins the original element domain; abstract index reads do not invent an undefined arm.
- Architecture: one annotation resolver now owns type-parameter / same-file / imported / built-in / `typeof` name resolution, and one `buildEntryDomain` feeds check, L2, service entry witnesses, dts and validators. Unresolvable annotations surface as `nudo:annotation-unresolved` instead of silently falling back to `any`.
- Annotation names: relative / package `types` / tsconfig `paths` modules are resolved for type imports; explicit `unknown` and generic parameters now use provenance/term namespaces instead of silent `any`.
- Provenance: `Abs` gains a `provenance` facet (`declared` / `observed` / `asserted` / `inferred` / `synthetic`); dts and validator projection use it to preserve declared literals and drop synthetic OOB arms at the boundary.
- `contract --draft`: coercion calls and operator uses are not type evidence; drafts import the constraint `lit` alias, strip single-line JSDoc tails, keep throws in suggested bodies, and preserve generalized return obligations.
