---
"@nudojs/env": patch
---

Node `fs` / `fs/promises` / `path` / `os` declarations now match what the
host actually does, so the checker no longer reports calls as safe when
the host throws, and no longer invents values the host cannot produce.

- `os.cpus()` describes the whole per-CPU record. The result was missing
  the `times` member, so reading `cpus()[0].times.user` produced an exact
  `undefined` and the engine concluded the call must throw a `TypeError`.
  The record now carries `times` with `user` / `nice` / `sys` / `idle` /
  `irq`, as the host does.
- The `node:path` family checks the types of its arguments. A path
  argument that definitely is not a string makes the call throw a
  `TypeError`, which is what the host does — `path.join(123)` and
  `path.isAbsolute(123)` both fail that way. An argument the engine
  cannot pin down makes the call possibly throw instead. A bad argument
  no longer produces a confident value either: `path.basename("/x/y.txt",
  5)` used to report the string `"y.txt"`, a name the host never returns.
  Variadic members (`join`, `resolve`) are checked across every
  argument, and the optional suffix of `basename` still accepts
  `undefined`, as the host does. `path.posix` and `path.win32` follow the
  same rules.
- The synchronous `node:fs` members report that they may throw. The
  host throws an `Error` (with a `code` such as `ENOENT`) when a path is
  missing or a permission is denied, but the declaration claimed the call
  could never fail. The call is now marked as possibly throwing an
  `Error`; it is not marked as always throwing, because the engine
  cannot know whether the path exists. `existsSync` still never throws,
  and `rmSync` with `force: true` keeps ignoring a missing path.
- `fs/promises` results use the same member tables as the synchronous
  family. The promise-family result was a trimmed copy, so reading
  `mtimeMs`, `nlink` or `isBlockDevice()` off it produced an exact
  `undefined` instead of the number or boolean the host returns, and
  the `Dirent` of `readdir` had no shape at all. `readdir` now also
  follows the host and returns names when `withFileTypes` is not set and
  directory entries when it is.
- `statSync` and `fs.promises.stat` report the `undefined` the host
  returns for `throwIfNoEntry: false`. The result was declared as never
  `undefined`, so the checker reported the call as safe and went on to
  give a confident `boolean` or `number` for a member read that the host
  answers with a `TypeError`.
