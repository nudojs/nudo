---
"@nudojs/core": patch
---

Methods of a class are dispatched by the method itself, and the prototype
of an instance is modelled.

- Calling a method that was taken off an object — `const m = o.m; m()` —
  was reported as a definite `TypeError`, and the same happened when the
  method was borrowed with `call`, `apply` or `bind`. The method body is
  executed now, with the receiver the call site provides.
- `delete X.prototype.m` did not remove the method from the registry, so
  the method was still readable, still reported as present and still
  callable. It is removed now, and calling it raises a `TypeError`.
- `instanceof` compared the **name** of the constructor of the instance
  with the name on the right-hand side, ignoring the real prototype chain.
  After `F.prototype = {}` or `Object.setPrototypeOf(f, null)`, the
  instance still was reported as an instance, and the answer was an
  exact `true` — a confident answer that sends a type guard down the
  wrong branch. The instance records its prototype now, the check follows
  that chain, and a prototype that cannot be decided folds to `boolean`
  instead of `true`. Assigning a non-object to `F.prototype` raises a
  `TypeError`, as the specification says.
- `new.target` inside an instance field initialiser was the class value
  instead of `undefined`. The field initialiser is evaluated outside the
  constructor frame now, so `new.target` is `undefined` there, as in
  JavaScript.
- A constructor of an unmodelled built-in, such as `Intl.Collator`, was
  branded with an internal placeholder name. The placeholder leaked into
  the type of the value, into the generated declaration file and into the
  generated schema, where it made the product unusable. The brand carries
  the real name now, and the generated products no longer contain the
  placeholder.
