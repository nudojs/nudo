---
"@nudojs/core": patch
---

`JSON.stringify` renders regex match results as arrays: a
`String.prototype.match` / `RegExp.prototype.exec` result is a native
Array (only index elements enumerate into JSON), but the engine modeled
it as a plain object shape whose `length`/`index`/`input` slots all
serialized — `JSON.stringify("abc".match(/b/))` folded
`{"0":"b","length":1,"index":1,"input":"abc"}` instead of `["b"]`.
Match/exec/matchAll-element results now register an array view
(`matchArrayViews`) that the three JSON consumers honor by serializing
the 0..n-1 slots as an array, with the `length` slot explicitly
non-enumerable (the only non-enumerable own prop on the native result);
`Object.keys({...m})` enumeration matches native. MatchAll elements are
remodeled as `matchResultAbs` itself, so `[...ms][0].index` /
`.input` fold exactly. The `#136` member-read surface (`m[0]`,
`m.length`, `m.index`, `m.input`, named groups) is unchanged.
