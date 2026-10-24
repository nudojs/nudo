---
"@nudojs/core": patch
---

Destructuring follows the iteration protocol of the value it destructures, and
the temporary names the transpiler generates no longer collide with the names
in the source.

- Array destructuring always read the receiver by index (`$idx(receiver, i)`).
  A user iterable — an object with its own `@@iterator` method — has no index
  slots, so every element folded to a confident `undefined` instead of the
  value the iterator yields. The receiver is now checked with the real
  iteration protocol (`GetIterator` + `IteratorNext`) and the elements are
  taken in iteration order, so the folded value matches JavaScript element by
  element. Values that the engine models itself (arrays, strings, `Set`,
  `Map`, generators, collection iterators) keep their exact element
  domains, and a receiver that is not iterable still throws `TypeError`.
- A destructuring target that is a member expression with a default value
  (`({ a: o.x = 1 } = src)`) dropped the write-back: the member was treated
  as a nested pattern, so the target kept its old value. The member is now
  read, defaulted, and written back.
- The temporary names the transpiler generates for destructuring (`_d0`,
  `_n1`, `_p0`, `_rest0`, …) did not avoid the identifiers used in the
  source. A user declaration with the same name produced a duplicate
  lexical declaration, which is a `SyntaxError`: the whole module failed to
  evaluate and every export folded to `unknown`. Inside a function body the
  temporary also shadowed a module-level binding of the same name and the
  user read a wrong value. The names now avoid the identifiers of the
  source, and the shared counter is pre-seeded so that even the first
  allocation avoids them.

  As part of this, the placeholder function body (`noBody`) is now a single
  shared object. Two separate copies made an identity check for "is this a
  placeholder function" fail across modules, which made the engine's own
  iterators look like user iterables and made
  `[...Array.from('ab').keys()]` throw a `TypeError` that JavaScript does not
  throw.
