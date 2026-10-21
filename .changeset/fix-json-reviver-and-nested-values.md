---
"@nudojs/core": patch
---

`JSON.stringify` and `JSON.parse` handle the values the language
handles.

- `JSON.parse` calls the reviver. The callback used to be dropped
  entirely, so its side effects never happened; `JSON.stringify` has
  always called its replacer, and the two now agree.
- A nested built-in no longer makes `JSON.stringify` report a possible
  `TypeError`. `JSON.stringify({p: Promise.resolve(1)})` is
  `'{"p":{}}'`, and the same holds for a `Map`, a `Set` or a
  generator object nested in the value.
- A replacer that is not callable is ignored, as in the language.
  `JSON.stringify({a: 1}, new Map())` is `'{"a":1}'` and does not
  report a throw; a constructor such as `Map` is callable and is still
  reported as a possible `TypeError`.
