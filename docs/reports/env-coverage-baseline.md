# Env / Node coverage baseline

> **Generated** by `scripts/env-coverage-baseline.ts` (`pnpm run coverage:env`).
> Do not hand-edit numbers — regenerate the report.
>
> **Honest boundary:** resolution rate is *not* a soundness guarantee.
> Categories still recommended for mock are listed below and aligned with
> `docs/design/limitations.md` §2 (call-site ceiling).

- Generated at: `2026-09-23T08:53:34.783Z`
- Harvest budgets: maxFiles=`12`, maxMs=`2500`, disable=`NUDO_HARVEST_NODE=off`

## Summary — Node env probes

| Status | Count |
|---|---:|
| resolved (leaf-clean format) | 64 |
| resolved (signature-level; format still mentions unknown/any) | 6 |
| unknown | 0 |
| mock-required | 2 |
| **total** | 72 |

Resolved ratio (resolved / total): **97.2%**
Leaf-clean ratio (format has no unknown/any token / total): **88.9%**

### Probe detail (node)

| Probe | Status | Leaf | Format | Reason |
|---|---|---|---|---|
| `fs.readFileSync` | resolved | clean | `(string, options?: string \| { encoding?: string, flag?: string }) => string \| Buffer` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.writeFileSync` | resolved | clean | `(string, string \| Buffer, options?: string \| { encoding?: string, flag?: string }) => undefined` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.existsSync` | resolved | clean | `(string) => boolean` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.statSync` | resolved | clean | `(string, options?: { bigint?: boolean, throwIfNoEntry?: boolean }) => { isFile: () => boolean, isDirectory: () => boolean, isSymbolicLink: () => boolean, isBlockDevice: () => boolean, isCharacterDevice: () => boolean, isFIFO: () => boolean, isSocket: () => boolean, size: number, mtime: Date, ctime: Date, atime: Date, birthtime: Date, mtimeMs: number, ctimeMs: number, atimeMs: number, birthtimeMs: number, mode: number, uid: number, gid: number, ino: number, dev: number, nlink: number }` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.readdirSync` | resolved | clean | `(string, options?: { encoding?: string, withFileTypes?: boolean, recursive?: boolean }) => Array<string \| Dirent>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.mkdirSync` | resolved | clean | `(string, options?: { recursive?: boolean, mode?: number }) => string \| undefined` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.rmSync` | resolved | clean | `(string, options?: { recursive?: boolean, force?: boolean, maxRetries?: number, retryDelay?: number }) => undefined` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.readFile-callback` | resolved | clean | `(string, options?: string \| { encoding?: string, flag?: string }, CallbackFn) => undefined` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.promises.readFile` | resolved | clean | `(string, options?: string \| { encoding?: string, flag?: string }) => promise<string \| Buffer>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.promises.writeFile` | resolved | clean | `(string, string \| Buffer, options?: string \| { encoding?: string, flag?: string }) => promise<undefined>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.promises.mkdir` | resolved | clean | `(string, options?: { recursive?: boolean, mode?: number }) => promise<string \| undefined>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `node:fs/promises.readFile` | resolved | clean | `(string, options?: string \| { encoding?: string, flag?: string }) => promise<string \| Buffer>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `node:fs/promises.appendFile` | resolved | clean | `(string, string \| Buffer, options?: string \| { encoding?: string, flag?: string }) => promise<undefined>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `node:fs/promises.unlink` | resolved | clean | `(string) => promise<undefined>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `node:fs/promises.rename` | resolved | clean | `(string, string) => promise<undefined>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `node:fs/promises.copyFile` | resolved | clean | `(string, string) => promise<undefined>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `node:fs/promises.chmod` | resolved | clean | `(string, number) => promise<undefined>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `path.join` | resolved | clean | `(string, ...paths: string) => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `path.resolve` | resolved | clean | `(...paths: string) => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `path.dirname` | resolved | clean | `(string) => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `path.basename` | resolved | clean | `(string, ext?: string) => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `path.extname` | resolved | clean | `(string) => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `path.relative` | resolved | clean | `(string, string) => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `path.parse` | resolved | clean | `(string) => { root: string, dir: string, base: string, ext: string, name: string }` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `path.isAbsolute` | resolved | clean | `(string) => boolean` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `path.sep` | resolved | clean | `string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `path.posix` | resolved | clean | `path.PlatformPath` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `path.win32` | resolved | clean | `path.PlatformPath` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `url.URL` | resolved | clean | `(string, base?: string) => { href: string, origin: string, protocol: string, username: string, password: string, host: string, hostname: string, port: string, pathname: string, search: string, hash: string, toString: () => string, toJSON: () => string }` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `url.URLSearchParams` | resolved | clean | `(init?: string \| Record<string, string> \| string[][]) => { get: (string) => string \| null, getAll: (string) => string[], has: (string) => boolean, set: (string, string) => undefined, append: (string, string) => undefined, delete: (string) => undefined, toString: () => string, size: number }` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `url.fileURLToPath` | resolved | clean | `(string) => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `url.pathToFileURL` | resolved | clean | `(string) => { href: string }` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `events.EventEmitter` | resolved | clean | `(options?: { captureRejections?: boolean }) => EventEmitter` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `events.once` | resolved | clean | `(EventEmitter, string) => promise<EventArgs>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `events.on` | resolved | clean | `(EventEmitter, string) => AsyncIterator` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `node:events.EventEmitter` | resolved | clean | `(options?: { captureRejections?: boolean }) => EventEmitter` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `util.promisify` | resolved | clean | `(CallbackFn) => PromiseFn` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `util.inspect` | resolved | mentions-unknown | `(any, options?: { showHidden?: boolean, depth?: number, colors?: boolean, customInspect?: boolean, maxArrayLength?: number, breakLength?: number, compact?: boolean, sorted?: boolean }) => string` | present in env; signature-level — format still mentions unknown/any leaves |
| `util.format` | resolved | mentions-unknown | `(...args: any) => string` | present in env; signature-level — format still mentions unknown/any leaves |
| `util.types.isDate` | resolved | mentions-unknown | `(any) => boolean` | present in env; signature-level — format still mentions unknown/any leaves |
| `util.inherits` | resolved | clean | `(Function, Function) => undefined` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `util.callbackify` | resolved | clean | `(PromiseFn) => CallbackFn` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `stream.Readable` | resolved | clean | `(options?: { highWaterMark?: number, objectMode?: boolean, encoding?: string, autoDestroy?: boolean, emitClose?: boolean }) => Readable` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `stream.Writable` | resolved | clean | `(options?: { highWaterMark?: number, objectMode?: boolean, encoding?: string, autoDestroy?: boolean, emitClose?: boolean }) => Writable` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `stream.Duplex` | resolved | clean | `(options?: { highWaterMark?: number, objectMode?: boolean, encoding?: string, autoDestroy?: boolean, emitClose?: boolean }) => Duplex` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `stream.Transform` | resolved | clean | `(options?: { highWaterMark?: number, objectMode?: boolean, encoding?: string, autoDestroy?: boolean, emitClose?: boolean }) => Transform` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `stream.pipeline` | resolved | clean | `(...streams: Stream) => promise<undefined>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `stream.machine-callbacks` | mock-required | — | `(options?: { highWaterMark?: number, objectMode?: boolean, encoding?: string, autoDestroy?: boolean, emitClose?: boolean }) => Transform` | Node stream machine drives internal callbacks — limitations §2 |
| `querystring.parse` | resolved | clean | `(string, sep?: string, eq?: string, options?: { maxKeys?: number }) => ParsedQueryString` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `querystring.stringify` | resolved | clean | `(StringifyInput, sep?: string, eq?: string, options?: { maxKeys?: number }) => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `crypto.randomUUID` | resolved | clean | `() => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `crypto.createHash` | resolved | clean | `(string) => Hash` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `crypto.randomBytes` | resolved | clean | `(number) => Buffer` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `process.env` | resolved | clean | `Record<string, string \| undefined>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `process.cwd` | resolved | clean | `() => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `process.argv` | resolved | clean | `string[]` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `process.nextTick` | resolved | clean | `(CallbackFn) => undefined` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `process.exitCode` | resolved | clean | `number \| undefined` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `process.version` | resolved | clean | `string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `process.platform` | resolved | clean | `string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `os.platform` | resolved | clean | `() => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `os.homedir` | resolved | clean | `() => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `os.tmpdir` | resolved | clean | `() => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `os.EOL` | resolved | clean | `string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `os.cpus` | resolved | clean | `() => { model: string, speed: number }[]` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `Buffer.from` | resolved | clean | `(string \| number[] \| Buffer) => Buffer` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `Buffer.alloc` | resolved | clean | `(number, fill?: string \| number \| Buffer, encoding?: string) => Buffer` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `Buffer.concat` | resolved | clean | `(Buffer[]) => Buffer` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `assert.ok` | resolved | mentions-unknown | `(any, message?: string \| Error) => undefined` | present in env; signature-level — format still mentions unknown/any leaves |
| `assert.strictEqual` | resolved | mentions-unknown | `(any, any, message?: string \| Error) => undefined` | present in env; signature-level — format still mentions unknown/any leaves |
| `assert.deepStrictEqual` | resolved | mentions-unknown | `(any, any, message?: string \| Error) => undefined` | present in env; signature-level — format still mentions unknown/any leaves |
| `child_process.spawn-native` | mock-required | — | `(string, string[], options?: { cwd?: string, env?: Record<string, string \| undefined>, stdio?: string \| string[] }) => ChildProcess` | native process spawn — mock or env signature only; no side-effect simulation |

### ES / web sample

- ES: resolved 4/4
- Web: resolved 3/3

## Library three-state path

| Package | Kind | Installed here | Classification | Note |
|---|---|---|---|---|
| `commander` | js-source | yes | resolved | JS source present — analysis via execution / checkSource, not d.ts harvest |
| `ms` | js-source | yes | resolved | JS source — infer/check without handwritten mock |
| `@types/node` | types | yes | resolved | .d.ts harvest via harvestNodeTypes (analysis auto-fill) |
| `left-pad` | none | no | absent | if installed without types and no JS eval path → mock/hint required |

### Three-state harvest rule

| Import target | Analysis path |
|---|---|
| JS source package (e.g. `commander`, `ms`) | Execute/analyze source — `checkSource` / `analyzeFile`; no handwritten mock required for zero-FP gate |
| `@types/*` / package ships `.d.ts` | `harvestDts` / `harvestNodeTypes` → analysis auto-fill env injection |
| Neither JS analysis path nor types | **mock-required** — use `@nudo:mock` / path `@nudo:env` / sidecar hint |

## Still mock-recommended categories

- Native bindings (process spawn, native addons)
- Dynamic `require` / computed module graphs
- Stream machine callbacks (Node Transform internals) — limitations §2
- Dual-entry browser/node variants (call-site records do not cross files)
- Functions with no call-site usage (entry@ fallback is honest)

## Node env module keys

```
assert
child_process
crypto
events
fs
fs/promises
node:assert
node:child_process
node:crypto
node:events
node:fs
node:fs/promises
node:os
node:path
node:querystring
node:stream
node:url
node:util
os
path
querystring
stream
url
util
```

JSON twin: `docs/reports/env-coverage-baseline.json`
