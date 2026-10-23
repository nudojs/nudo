---
"nudojs": patch
---

Two reported `nudo check` defects were already fixed by earlier releases; this
change only adds regression pins that keep them fixed.

- A string in `package.json#nudo.env` is rejected with a shape warning and the
  environment list is ignored; it is no longer expanded character by character.
- A cycle in the module graph no longer discards the whole dependency graph,
  so a cyclic and an acyclic project produce the same result.
