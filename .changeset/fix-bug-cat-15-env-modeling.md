---
"@nudojs/env": patch
---

Fix bug-report category 15 (node / web host environment modeling) — 12 defects.

- BUG-125: `crypto.getRandomValues` (and the `crypto.webcrypto` / `Crypto` / global
  `crypto` faces) now accept the integer TypedArray domain and reject plain Arrays,
  float views and primitives with a definite `TypeError` instead of returning `unknown`.
- BUG-148: host objects that model slots as `unknown` (web `Response.body`,
  `Headers.getSetCookie`, `document.location`; node `Event` / `CustomEvent` / `Request`)
  now carry their real slot types.
- BUG-149: `performance.mark` / `performance.measure` return `PerformanceMark` /
  `PerformanceMeasure` brands instead of throwing.
- BUG-150: `crypto.subtle` call sites widen the rejection reason to
  `OperationError ∪ TypeError` (the static reason stays `OperationError`).
- BUG-153: 13 undeclared browser globals are now modeled (`FormData`, `Blob`,
  `BroadcastChannel`, `DisposableStack`, `AsyncDisposableStack`, `PerformanceMark`,
  `PerformanceObserver`, `ReadableStream`, `ReadableStreamBYOBReader`,
  `ReadableStreamDefaultReader`, `URLPattern`, `WritableStream`,
  `WritableStreamDefaultWriter`).
- BUG-154: `keys` / `values` / `entries` of the iterable families (node `Headers` /
  `FormData`; web `Headers` / `FormData` / `URLSearchParams`) are modeled as total
  iterators instead of degrading to `unknown`.
- BUG-155: `AbortSignal.any` is function-valued, and the 10 `WebAssembly.*` /
  `Temporal.*` members are modeled as constructors.
- BUG-161: the web constructor instance faces keep their brand (12 faces), so
  `instanceof` matches the runtime instead of reporting `Object` / `false`.
- BUG-193: `Buffer`'s static table no longer carries members the host does not have, and
  the `node:buffer` module face is modeled.
- BUG-255: `path.posix` / `path.win32` expose `parse` / `format` from one shared source
  of truth with `path`.
- BUG-256: `process.title` is a string slot (it previously folded to `undefined`).
- BUG-257: `util.types` models all 43 host predicates (35 were missing).

Regression tests: `env-bug-125-*` … `env-bug-257-*` (12 files).

### 追加：`env-bug-64` 负控重钉（依据 BUG-160）

`env-bug-64` 的负控钉的是「删掉 env 声明、回落宿主 ⇒ `TextEncoder.encoding` 退成
`undefined`（**确定的错值**）」，其前提是宿主路**没有**实例面建模。BUG-160 要求的正确行为是
`TextEncoder` 实例面 = `encoding`（只读访问器，恒 `"utf-8"`）+ `encode` / `encodeInto`，且
**成员读不得折 `undefined`** ⇒ 负控改为断言宿主路真值 `'"utf-8"'`（宿主实测同值）；env 声明
面仍是放宽的 `string`，上一行断言未动。
