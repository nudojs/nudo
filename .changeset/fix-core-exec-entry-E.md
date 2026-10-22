---
"@nudojs/core": patch
"@nudojs/service": patch
---

Family 04 (core execution / entry), shard E — fixes for bugs 990, 1031 and 286.

- **Bug 1031 (core)**: an `export { … };` specifier statement placed **before** a
  class declaration made every method of that class collapse to `unknown`.
  `ctorParamCountOf` treated the specifier statement as a declaration and
  dereferenced `declaration.type` on a `null` declaration, raising a
  `TypeError` inside the class-method bridge. The bridge swallowed the error
  in an empty `catch {}`, so the method signature silently degraded to
  `unknown` and picked up a misleading `nudo:opaque-result` diagnostic. Worst
  of all, a violated return-type contract on such a method was downgraded from
  an **error** to a **warning**, so `nudo check` exited `0` and let the
  violation through. The null declaration is now skipped explicitly, and the
  bridge distinguishes an internal failure from a failed evaluation run
  instead of swallowing it silently. The behaviour no longer depends on the
  order of the `export { … };` statement.
- **Bug 990 (core)**: `collectAbsExports` decided between the re-export branch
  and the local-export branch by testing whether a module table was supplied at
  all. With no module table, `export { a } from "./m.js"` was handled as a
  local export and invented a named export, and `export { default } from
  "./m.js"` invented a `default` export — the very existence of a `default`
  slot is protocol-level information, so consumers were told the module has a
  default export it does not have. The branch now only looks at whether the
  statement has a source: an unreachable source yields no export slots at all,
  matching the "module table present but module missing" case. `bindImports`
  also resolves `import { default as d } from "./m.js"` through `mod.default`,
  so it now matches `import d from "./m.js"` instead of binding `unknown`.
- **Bug 286 (service)**: call records for namespace member calls
  (`ns.helper(…)`, both ESM `import * as ns` and CJS `require`) only carried the
  member name, never the receiver. The attribution side splits the callee name
  on a dot, so the split never happened: `targetModule` / `targetExport` stayed
  empty, the record was dropped by the matching side, and the **error-level**
  `nudo:interface-domain-exceeds` gate never fired for out-of-domain calls
  across a namespace import. Such records now carry the receiver's local
  binding name (`ns.helper`), the same shape class member calls already use
  (`Brand.method`), and a CJS `require` binding is registered as a namespace
  import. Ordinary calls (local functions, named imports, host globals) keep
  their existing record names.
