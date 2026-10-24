---
"@nudojs/core": patch
---

`o.p++` and `++o.p` read the member exactly once.

A native `o.p++` is one Get plus one Put. The engine split the update into
an expression part (which evaluated the new value) and a statement-level
rebinding (which wrote the value back), and both parts emitted their own
`readPathSrc(path)` — so the member was read twice. A getter therefore ran
twice (doubling its side effects), and a stateful getter returned a
different value on the second read, which made even the result of the
update wrong (`"1:2"` instead of `"1:1"`).

The member target is now self-contained like the identifier target: the
value is read once, the write-back happens inside the expression, and the
statement-level rebinding no longer adds a second read or a second
increment.
