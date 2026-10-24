---
"@nudojs/core": patch
---

Member write-backs now target an assignable binding, so modules with a
member write-back no longer fail to evaluate when position recording is
enabled.

With position recording on, the member path root used to be wrapped in
`$nodoPos(name, line, column)` — a *read* wrapper used to record where a
value was read. The write-back sites then reused that same expression as
the *assignment target*:

```js
$nodoPos(o, 2, 24) = $del($nodoPos(o, 2, 24), $lit("a"));
```

That is not a valid assignment target, so the generated module threw a
`SyntaxError` when it was compiled, the whole module failed to evaluate,
and every export of that module degraded to `unknown`. The LSP replay
surface keeps position recording on, so hovering over any value in a
module that writes to a member (`o.a = 2`, `delete o.a`,
`Object.defineProperty(o, …)`, `o.a++`) fell back to the declared shape
instead of the evaluated one.

The member path now carries the plain binding name separately from the
instrumented read, and every write-back assigns to the plain name.
