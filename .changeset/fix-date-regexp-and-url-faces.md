---
"@nudojs/core": patch
---

Dates and regular expressions now keep their state, and a URL keeps its
query parameters.

- `Date.prototype.set*` update the time value. The setters used to do
  nothing, so the rendered date was stale.
- `Date.prototype.toJSON` returns `null` for an invalid date (a time
  value of `NaN`), as in the language, instead of a string.
- The result of `RegExp.prototype.exec` and of a non-global `match` is
  array-like again, so array methods, spreading and `for…of` work on
  it.
- A `URL` carries its `searchParams`, and a `URLSearchParams` carries
  its entries. `new URL("https://x/?a=1").searchParams.get("a")` is
  `"1"`, `searchParams.get("z")` is `null`, `searchParams.size` is the
  number of entries, and `searchParams.toString()` is the query
  string. `set`, `append` and `delete` update the same object.
