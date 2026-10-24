---
"@nudojs/parser": patch
---

`@nudo:case` witnesses and expected values now follow JavaScript literal
semantics, and an unreadable expected value can no longer pass silently.

- The numeric branch of the case-argument grammar only recognized a decimal
  regex, so every other legal JavaScript number — exponent notation, hex,
  binary and modern octal literals, numeric separators, a leading or trailing
  dot, a unary sign — was folded into `unknown`. Since `unknown` is the top
  type (`leqAbs(actual, unknown)` always holds), the witness satisfied any
  contract and the assertion passed for the wrong reason. Those forms are now
  parsed with JavaScript literal semantics, so `1e3` is `1000`, `0x10` is `16`,
  `0b101` is `5`, `0o17` is `15`, `1_000` is `1000`, `.5` is `0.5` and `5.` is
  `5`.
- A legacy octal literal was read as decimal (`Number("017")` is `17`), while
  sloppy-mode JavaScript reads it as octal (`017` is `15`). The witness and the
  expected value were therefore a confident **wrong** value. A leading zero now
  means octal (`017` → `15`, `010` → `8`), and a leading zero with `8` / `9`
  keeps sloppy decimal semantics (`08` → `8`).
- Expression-shaped literals — a parenthesized value (`(7)`, `-(7)`), an
  unsigned or negative sign (`+1`, `- 7`), a template literal without
  interpolation (`` `x` ``) and a bigint (`7n`) — were also folded into
  `unknown` and are now recognized.
- An expected value that cannot be parsed was folded into the same `unknown`
  Abs as an explicit `unknown`, so `leqAbs(actual, unknown)` always held and
  the assertion was vacuously true: the report said "1 passed" and the command
  exited with `0`. A parse failure is now distinct from an explicit `unknown`:
  it is reported through the existing `nudo:directive-syntax` channel and the
  assertion fails instead of passing. An explicit `unknown` / `any` keeps its
  meaning of "not constrained".
