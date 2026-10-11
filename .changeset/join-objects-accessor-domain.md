---
"@nudojs/core": patch
---

Fix unsound getter loss on object joins: `joinAbs`/`joinObjects` built the merged object as a fresh Abs identity without migrating the accessor side table, so a getter arm joined with a data arm read as its `undefined` placeholder (`{ get q() { return 42; } }` joined with `{ q: 0 }` read `undefined | 0` instead of `42 | 0`). Mixed arms now fold the getter's read domain (evaluated with its original receiver, same as `$spread`) into the data slot; arms sharing the identical accessor definition (aliases, migrated immutable updates such as loop-widening frames) migrate the registration whole so reads keep dispatching through the side table. The accessor table moved to a leaf module `algebra/accessors.ts` so `objects.ts` can consume it without an import cycle; `annotateJoinPath`'s re-wrap now migrates registrations to the final identity.
