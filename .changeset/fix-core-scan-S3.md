---
"@nudojs/core": patch
---

Call-site contract enforcement now covers class instances, default exports,
and re-export chains, and it applies one literal identity on every argument
position.

- A method call on a class instance (`const c = new C(); c.m(-1)`) was never
  checked. The call graph only recognized members of object literals, so the
  callee name could not be resolved and the whole call was skipped, while the
  contract face and the signature face both claimed the contract was in
  force. Instance members now resolve to the class method they belong to, so
  the call site and the contract face agree.
- A contract on a default export was not enforced across files
  (`import calc from "./a"`). The imported name was recorded as the literal
  export name `default`, but contracts bind by the name the callee declares
  locally, so a hand-written sidecar could never attach and the violation
  passed the gate silently. The callee's local declaration name is now used.
- A re-export chain was cut short by an unrelated local function with the
  same name in the middle module. The chain was only followed when the name
  appeared anywhere in the module's source, so a local function that was
  never exported shadowed the re-export and the contract of the re-exported
  function went unused. The chain now follows the module's exported names,
  which is what the module system itself uses.
- The same literal contract could be satisfied or rejected depending on where
  the argument sat: a scalar argument compared `-0` and `0` as equal, while
  an object field or an array element compared them as different. One
  identity is now used everywhere: `===` plus the NaN exception, so `-0`
  satisfies `lit(0)` and `NaN` satisfies `lit(NaN)`.
