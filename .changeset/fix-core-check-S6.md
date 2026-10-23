---
"@nudojs/core": patch
---

`nudo check` no longer treats "this entry was never analysed" as "this entry
cannot throw".

- **Class instance methods were invisible to the L2 entry gate.** The
  evidence collector only had a *static* method bridge (`$staticInvoke`).
  That bridge answers "unknown" — without throwing — for a method that is
  not a static method, so an instance method produced no throws evidence at
  all. A public method with an explicit `throw new TypeError()` therefore
  passed `nudo check` with exit code 0, while the same throw in a top-level
  function of the same file was reported. The class branch now also has an
  *instance* method bridge (class value → `new` with `any` constructor
  arguments → invoke), and decides static vs. instance from the class
  declaration in the source — at runtime the two cannot be told apart,
  because the static bridge reports "unknown" for a method it does not own.
  The same file's static methods and top-level functions are unaffected.
- **A method that always throws now has an honest signature.** The
  generalisation path swallowed the throw and reported the method as
  `unknown` ("inference failed"). It now reports `never`, matching how a
  top-level function that always throws is reported.
- **A construct the transpiler rejects no longer turns the gate green.** If
  the transpiler refuses a construct, the whole module is left unanalysed;
  the entry gate used to read that as "no may-throw evidence" and stayed
  green, so two expressions differing only by a `++` got opposite verdicts.
  The transpiler's reason for refusing is now observable, and an entry that
  could not be analysed is reported as "may throw Error" — a sound
  over-approximation, since an unanalysed entry cannot be shown to be
  total. `@nudo:throws Error` or `--ignore-throws Error` accepts it
  explicitly.
