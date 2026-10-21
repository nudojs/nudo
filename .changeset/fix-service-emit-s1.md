---
"@nudojs/service": patch
---

The `.d.ts` product now projects the module's export surface: export names,
classes and re-exports.

- `export default function (…)`, `export default (…) => …`, `exports.compute = …`
  and `const f = …; export { f }` were dropped from the `.d.ts` product even
  though the export face advertised them. They are now declared.
- A declaration is named after the **export name**, not after the local
  binding: `export { internal as publicName }` is declared as
  `publicName`, and `export default function addOne` is declared as
  `export default function addOne`. The local binding name is never
  mistaken for the export name.
- A class is projected as a class: `export class C { … }` becomes
  `export declare class C { … }` with the constructor and the static
  methods inside it. The instance methods are no longer flattened into a
  module-level `C_m` export, which never existed in the source and merged
  with a real export of the same name into a fake overload.
- A class instance type (`User`) referenced by a declaration is declared as
  well, so the `.d.ts` no longer fails to compile with `TS2304: Cannot find
  name 'User'`.
- `export * from "…"` and `export { x } from "…"` are re-emitted, so the
  product's export surface matches the source module's.
