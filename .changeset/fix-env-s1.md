---
"@nudojs/env": patch
---

The web environment now describes the browser the way the browser behaves.

- The browser constructors are constructible again. `Response`, `Request`,
  `Headers`, `URLSearchParams`, `EventTarget`, `Event` and `CustomEvent` are
  declared with `ctor: true`, so `new X()` no longer reports a may-throw for
  a call that the browser makes happily. `Response` used to be a plain
  object rather than a function at all, which made `new Response()` a
  definite `TypeError`; it is now a constructor whose static `json`,
  `redirect` and `error` live on the constructor itself.
- `Request` no longer copies the whole member table of `Response`. The
  status members `ok`, `status`, `statusText`, `redirected` and `type`
  belong to `Response` only — a native `Request` has no `status` at all —
  so reading `request.status` now yields `undefined` instead of a number.
  `Request` keeps its own members (`method`, `body`, `mode`, `credentials`,
  `cache`, `redirect`, `referrer`, `referrerPolicy`, `integrity`, `signal`,
  `keepalive`, `duplex`, `destination`) and shares `bodyUsed` with
  `Response`.
- `document` and `performance` list their members. A member the table left
  out used to read as `undefined`, and calling it was reported as a
  definite `TypeError` — on `document.getElementsByTagName`,
  `document.forms`, `document.write`, `performance.getEntries` and the
  rest. The collections read as arrays, and `performance` also exposes
  `navigation`, `serverTiming` and `timeOrigin`.
- The global list covers the browser globals that were missing: `alert`,
  `screen`, `DOMParser`, `XMLHttpRequest`, `Worker`, `FileReader`,
  `matchMedia`, `IntersectionObserver`, `getComputedStyle`, `indexedDB` and
  `caches`. Reading an undeclared global is a `ReferenceError`, so the
  missing ones were reported on perfectly ordinary browser code.
- `navigator.hardwareConcurrency` is declared. It used to read as
  `undefined`, which made `navigator.hardwareConcurrency > 4` fold to
  `false` without a word of complaint; it is a number now.
- `AbortSignal.any` is declared, so combining signals no longer reads as a
  definite `TypeError`.
- `location.searchParams` is declared, so `location.searchParams.get("q")`
  no longer reads as a definite `TypeError`; it returns `string | null`.
- `atob`, `btoa`, `TextEncoder` and `TextDecoder` are no longer declared
  by the environment, because the host models them more precisely than the
  environment did. `atob("!!!")` used to look like a call that never
  throws; it now reports the `InvalidCharacterError` the browser raises,
  and valid base64 still folds to the exact string. `new TextDecoder` with
  an unsupported label reported a `TypeError`; it now reports the
  `RangeError` the browser raises. `TextEncoder` and `TextDecoder` are
  classes, so calling either without `new` reports the `TypeError` the
  browser raises, and calling them with `new` reports nothing.
- `queueMicrotask` is no longer declared by the environment. The
  declaration shadowed the check that the argument is callable, so
  `queueMicrotask(1)` looked like a call that never throws; it now reports
  the `TypeError` the browser raises.
