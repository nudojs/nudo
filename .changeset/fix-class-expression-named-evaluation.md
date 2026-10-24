---
"@nudojs/core": patch
---

An anonymous class expression now takes its name from the binding it is
assigned to, as in JavaScript.

- `const K = class { … }` produced a class whose `name` was the synthetic
  `"AnonymousClass"`, because the transpiler fixed the class name at
  emission time and never applied the language's NamedEvaluation rule. The
  same happened for `K = class { … }` and for `{ K: class { … } }`.
- The binding name is now passed back into the class expression, so `K.name`
  is `"K"`. A name written on the class itself (`class Named { … }`) still
  wins, and the name applies only to that class expression — a nested class
  expression inside the class body stays unnamed.
- The visible `name` of a class is now separate from the internal class name
  the engine uses for its own bookkeeping: an unbound class expression has
  the empty name (`""`), like in JavaScript, while the internal name is still
  available for the emitted code.
