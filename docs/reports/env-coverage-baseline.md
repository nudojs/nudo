# Env / Node coverage baseline

> **Generated** by `scripts/env-coverage-baseline.ts` (`pnpm run coverage:env`).
> Do not hand-edit numbers — regenerate the report.
>
> **Honest boundary:** resolution rate is *not* a soundness guarantee.
> Categories still recommended for mock are listed below and aligned with
> `docs/design/limitations.md` §2 (call-site ceiling).

- Generated at: `2026-09-19T02:48:47.229Z`
- Harvest budgets: maxFiles=`12`, maxMs=`2500`, disable=`NUDO_HARVEST_NODE=off`

## Summary — Node env probes

| Status | Count |
|---|---:|
| resolved (leaf-clean format) | 26 |
| resolved (signature-level; format still mentions unknown/any) | 23 |
| unknown | 0 |
| mock-required | 2 |
| **total** | 51 |

Resolved ratio (resolved / total): **96.1%**
Leaf-clean ratio (format has no unknown/any token / total): **51%**

### Probe detail (node)

| Probe | Status | Leaf | Format | Reason |
|---|---|---|---|---|
| `fs.readFileSync` | resolved | clean | `(string, string \| {  }) => string \| Buffer` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.writeFileSync` | resolved | clean | `(string, string \| Buffer) => undefined` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.existsSync` | resolved | clean | `(string) => boolean` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.statSync` | resolved | mentions-unknown | `(string) => { isFile: () => boolean, isDirectory: () => boolean, isSymbolicLink: () => boolean, size: number, mtime: unknown, ctime: unknown, atime: unknown, birthtime: unknown, mode: number, uid: number, gid: number }` | present in env; signature-level — format still mentions unknown/any leaves |
| `fs.readFile-callback` | resolved | mentions-unknown | `(string, options?: unknown, unknown) => undefined` | present in env; signature-level — format still mentions unknown/any leaves |
| `fs.promises.readFile` | resolved | mentions-unknown | `(string, unknown) => promise<string \| Buffer>` | present in env; signature-level — format still mentions unknown/any leaves |
| `fs.promises.writeFile` | resolved | clean | `(string, string \| Buffer) => promise<undefined>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `fs.promises.mkdir` | resolved | mentions-unknown | `(string, unknown) => promise<string \| undefined>` | present in env; signature-level — format still mentions unknown/any leaves |
| `node:fs/promises.readFile` | resolved | mentions-unknown | `(string, unknown) => promise<string \| Buffer>` | present in env; signature-level — format still mentions unknown/any leaves |
| `node:fs/promises.appendFile` | resolved | clean | `(string, string \| Buffer) => promise<undefined>` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
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
| `url.URL` | resolved | clean | `(string, base?: string) => { href: string, origin: string, protocol: string, username: string, password: string, host: string, hostname: string, port: string, pathname: string, search: string, hash: string, toString: () => string, toJSON: () => string }` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `url.URLSearchParams` | resolved | mentions-unknown | `(unknown) => { get: (string) => string \| unknown, has: (string) => boolean, set: (string, string) => undefined, append: (string, string) => undefined, delete: (string) => undefined, toString: () => string }` | present in env; signature-level — format still mentions unknown/any leaves |
| `url.fileURLToPath` | resolved | clean | `(string) => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `url.pathToFileURL` | resolved | clean | `(string) => { href: string }` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `events.EventEmitter` | resolved | mentions-unknown | `(options?: unknown) => EventEmitter` | present in env; signature-level — format still mentions unknown/any leaves |
| `events.once` | resolved | mentions-unknown | `(unknown, string) => promise<unknown[]>` | present in env; signature-level — format still mentions unknown/any leaves |
| `events.on` | resolved | mentions-unknown | `(unknown, string) => unknown` | present in env; signature-level — format still mentions unknown/any leaves |
| `node:events.EventEmitter` | resolved | mentions-unknown | `(options?: unknown) => EventEmitter` | present in env; signature-level — format still mentions unknown/any leaves |
| `util.promisify` | resolved | mentions-unknown | `(unknown) => unknown` | present in env; signature-level — format still mentions unknown/any leaves |
| `util.inspect` | resolved | mentions-unknown | `(unknown, unknown) => string` | present in env; signature-level — format still mentions unknown/any leaves |
| `util.format` | resolved | mentions-unknown | `(...args: unknown) => string` | present in env; signature-level — format still mentions unknown/any leaves |
| `util.types.isDate` | resolved | mentions-unknown | `(unknown) => boolean` | present in env; signature-level — format still mentions unknown/any leaves |
| `stream.Readable` | resolved | mentions-unknown | `(options?: unknown) => Readable` | present in env; signature-level — format still mentions unknown/any leaves |
| `stream.Writable` | resolved | mentions-unknown | `(options?: unknown) => Writable` | present in env; signature-level — format still mentions unknown/any leaves |
| `stream.Duplex` | resolved | mentions-unknown | `(options?: unknown) => Duplex` | present in env; signature-level — format still mentions unknown/any leaves |
| `stream.Transform` | resolved | mentions-unknown | `(options?: unknown) => Transform` | present in env; signature-level — format still mentions unknown/any leaves |
| `stream.pipeline` | resolved | mentions-unknown | `(...streams: unknown) => promise<undefined>` | present in env; signature-level — format still mentions unknown/any leaves |
| `stream.machine-callbacks` | mock-required | — | `(options?: unknown) => Transform` | Node stream machine drives internal callbacks — limitations §2 |
| `querystring.parse` | resolved | mentions-unknown | `(string, sep?: string, eq?: string, options?: unknown) => ParsedQueryString` | present in env; signature-level — format still mentions unknown/any leaves |
| `querystring.stringify` | resolved | mentions-unknown | `(unknown, sep?: string, eq?: string, options?: unknown) => string` | present in env; signature-level — format still mentions unknown/any leaves |
| `crypto.randomUUID` | resolved | clean | `() => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `crypto.createHash` | resolved | mentions-unknown | `(string) => { update: (string \| Buffer) => unknown, digest: (string) => string \| Buffer }` | present in env; signature-level — format still mentions unknown/any leaves |
| `crypto.randomBytes` | resolved | clean | `(number) => Buffer` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `process.env` | resolved | mentions-unknown | `{  }` | present in env; signature-level — format still mentions unknown/any leaves |
| `process.cwd` | resolved | clean | `() => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `process.argv` | resolved | clean | `string[]` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `os.platform` | resolved | clean | `() => string` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `Buffer.from` | resolved | clean | `(string \| number[]) => Buffer` | present in handwritten env with concrete Abs shape (format has no unknown leaf) |
| `child_process.spawn-native` | mock-required | — | `(string, string[], unknown) => unknown` | native process spawn — mock or env signature only; no side-effect simulation |

### ES / web sample

- ES: resolved 4/4
- Web: resolved 3/3

## Library three-state path

| Package | Kind | Installed here | Classification | Note |
|---|---|---|---|---|
| `commander` | js-source | yes | resolved | JS source present — analysis via execution / checkSource, not d.ts harvest |
| `ms` | js-source | yes | resolved | JS source — infer/check without handwritten mock |
| `@types/node` | types | yes | resolved | .d.ts harvest via harvestNodeTypes / nudo env harvest node |
| `left-pad` | none | no | absent | if installed without types and no JS eval path → mock/hint required |

### Three-state harvest rule

| Import target | Analysis path |
|---|---|
| JS source package (e.g. `commander`, `ms`) | Execute/analyze source — `checkSource` / `analyzeFile`; no handwritten mock required for zero-FP gate |
| `@types/*` / package ships `.d.ts` | `harvestDts` / `harvestNodeTypes` / `nudo harvest` → env injection |
| Neither JS analysis path nor types | **mock-required** — use `@nudo:mock` / path `@nudo:env` / sidecar hint |

## Still mock-recommended categories

- Native bindings (process spawn, native addons)
- Dynamic `require` / computed module graphs
- Stream machine callbacks (Node Transform internals) — limitations §2
- Dual-entry browser/node variants (call-site records do not cross files)
- Functions with no call-site usage (entry@ fallback is honest)

## Node env module keys

```
child_process
crypto
events
fs
fs/promises
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
