---
"@nudojs/core": patch
---

Classes now behave like JavaScript classes with respect to computed field
keys, static blocks, private names and async members.

- The computed key of an instance field (`class A { [k()] = 1 }`) was
  evaluated per instance instead of once when the class is defined, so the
  field name could drift between two constructions and the side effects of
  the key expression were missing. The key is now evaluated once, at class
  definition time, and every instance installs the field under that key.
  Computed keys of static fields and methods keep their own evaluation
  point.
- A `static` block always ran after *all* static field initializers, so the
  source order of the class body was lost. `class A { static { A.q = 1 }
  static r = A.q + 1 }` folded `r` to `NaN`; it is now `2`.
- `super` inside a `static` block resolved against the instance prototype
  chain, so it read the wrong binding. It now resolves against the class
  prototype, like in JavaScript.
- Private names were not scoped to their class: a private field of one class
  could be read and written from another class, a derived class shadowed the
  private field of its base class, and reading a foreign private field
  returned a value instead of throwing `TypeError`. Private names are now
  scoped to the class that declares them.
- A `static async` method was not wrapped in the async protocol, so it
  returned the raw value instead of a promise and a `throw` inside the body
  was thrown synchronously at the call site. It now returns a promise and
  rejects, like an instance async method.
- An `async function*` was compiled as a synchronous generator: `next()`
  returned a bare result object instead of a promise, the object had no
  `@@asyncIterator` method, `Object.prototype.toString` reported
  `[object Object]` instead of `[object AsyncGenerator]`, and the object
  wrongly offered the synchronous iteration protocol. Async generators are
  now compiled with the async protocol, in the declaration form, the
  function-expression form and the class-method form. The element domain of
  a `for await` loop over an async generator is taken from the generator
  instead of folding to `unknown`.
