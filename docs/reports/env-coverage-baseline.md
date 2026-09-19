# Env / Node coverage baseline

> **Generated** by `scripts/env-coverage-baseline.ts` (`pnpm run coverage:env`).
> Do not hand-edit numbers — regenerate the report.
>
> **Honest boundary:** resolution rate is *not* a soundness guarantee.
> Categories still recommended for mock are listed below and aligned with
> `docs/design-limitations.md` §八 (call-site ceiling).

- Generated at: `2026-09-18T20:33:49.140Z`
- Harvest budgets: maxFiles=`12`, maxMs=`2500`, disable=`NUDO_HARVEST_NODE=off`

## Summary — Node env probes

| Status | Count |
|---|---:|
| resolved | 48 |
| unknown | 0 |
| mock-required | 2 |
| **total** | 50 |

Resolved ratio (resolved / total): **96%**

### Probe detail (node)

| Probe | Status | Format | Reason |
|---|---|---|---|
| `fs.readFileSync` | resolved | `(string, string \| {  }) => string \| Buffer` | present in handwritten env with concrete Abs shape |
| `fs.writeFileSync` | resolved | `(string, string \| Buffer) => undefined` | present in handwritten env with concrete Abs shape |
| `fs.existsSync` | resolved | `(string) => boolean` | present in handwritten env with concrete Abs shape |
| `fs.statSync` | resolved | `(string) => { isFile: () => boolean, isDirectory: () => boolean, isSymbolicLink: () => boolean, size: number, mtime: unknown, ctime: unknown, atime: unknown, birthtime: unknown, mode: number, uid: number, gid: number }` | present in handwritten env with concrete Abs shape |
| `fs.promises.readFile` | resolved | `(string, unknown) => promise<string \| Buffer>` | present in handwritten env with concrete Abs shape |
| `fs.promises.writeFile` | resolved | `(string, string \| Buffer) => promise<undefined>` | present in handwritten env with concrete Abs shape |
| `fs.promises.mkdir` | resolved | `(string, unknown) => promise<string \| undefined>` | present in handwritten env with concrete Abs shape |
| `node:fs/promises.readFile` | resolved | `(string, unknown) => promise<string \| Buffer>` | present in handwritten env with concrete Abs shape |
| `node:fs/promises.appendFile` | resolved | `(string, string \| Buffer) => promise<undefined>` | present in handwritten env with concrete Abs shape |
| `node:fs/promises.unlink` | resolved | `(string) => promise<undefined>` | present in handwritten env with concrete Abs shape |
| `node:fs/promises.rename` | resolved | `(string, string) => promise<undefined>` | present in handwritten env with concrete Abs shape |
| `node:fs/promises.copyFile` | resolved | `(string, string) => promise<undefined>` | present in handwritten env with concrete Abs shape |
| `node:fs/promises.chmod` | resolved | `(string, number) => promise<undefined>` | present in handwritten env with concrete Abs shape |
| `path.join` | resolved | `(string, string) => string` | present in handwritten env with concrete Abs shape |
| `path.resolve` | resolved | `(string) => string` | present in handwritten env with concrete Abs shape |
| `path.dirname` | resolved | `(string) => string` | present in handwritten env with concrete Abs shape |
| `path.basename` | resolved | `(string, string) => string` | present in handwritten env with concrete Abs shape |
| `path.extname` | resolved | `(string) => string` | present in handwritten env with concrete Abs shape |
| `path.relative` | resolved | `(string, string) => string` | present in handwritten env with concrete Abs shape |
| `path.parse` | resolved | `(string) => { root: string, dir: string, base: string, ext: string, name: string }` | present in handwritten env with concrete Abs shape |
| `path.isAbsolute` | resolved | `(string) => boolean` | present in handwritten env with concrete Abs shape |
| `url.URL` | resolved | `(string, string) => { href: string, origin: string, protocol: string, username: string, password: string, host: string, hostname: string, port: string, pathname: string, search: string, hash: string, toString: () => string, toJSON: () => string }` | present in handwritten env with concrete Abs shape |
| `url.URLSearchParams` | resolved | `(unknown) => { get: (string) => string \| unknown, has: (string) => boolean, set: (string, string) => undefined, append: (string, string) => undefined, delete: (string) => undefined, toString: () => string }` | present in handwritten env with concrete Abs shape |
| `url.fileURLToPath` | resolved | `(string) => string` | present in handwritten env with concrete Abs shape |
| `url.pathToFileURL` | resolved | `(string) => { href: string }` | present in handwritten env with concrete Abs shape |
| `events.EventEmitter` | resolved | `() => EventEmitter` | present in handwritten env with concrete Abs shape |
| `events.once` | resolved | `(unknown, string) => promise<unknown[]>` | present in handwritten env with concrete Abs shape |
| `events.on` | resolved | `(unknown, string) => unknown` | present in handwritten env with concrete Abs shape |
| `node:events.EventEmitter` | resolved | `() => EventEmitter` | present in handwritten env with concrete Abs shape |
| `util.promisify` | resolved | `(unknown) => unknown` | present in handwritten env with concrete Abs shape |
| `util.inspect` | resolved | `(unknown, unknown) => string` | present in handwritten env with concrete Abs shape |
| `util.format` | resolved | `(string) => string` | present in handwritten env with concrete Abs shape |
| `util.types.isDate` | resolved | `(unknown) => boolean` | present in handwritten env with concrete Abs shape |
| `stream.Readable` | resolved | `() => Readable` | present in handwritten env with concrete Abs shape |
| `stream.Writable` | resolved | `() => Writable` | present in handwritten env with concrete Abs shape |
| `stream.Duplex` | resolved | `() => Duplex` | present in handwritten env with concrete Abs shape |
| `stream.Transform` | resolved | `() => Transform` | present in handwritten env with concrete Abs shape |
| `stream.pipeline` | resolved | `(unknown) => unknown` | present in handwritten env with concrete Abs shape |
| `stream.machine-callbacks` | mock-required | `() => Transform` | Node stream machine drives internal callbacks — design-limitations §八 |
| `querystring.parse` | resolved | `(string, string, string, unknown) => ParsedQueryString` | present in handwritten env with concrete Abs shape |
| `querystring.stringify` | resolved | `(unknown, string, string, unknown) => string` | present in handwritten env with concrete Abs shape |
| `crypto.randomUUID` | resolved | `() => string` | present in handwritten env with concrete Abs shape |
| `crypto.createHash` | resolved | `(string) => { update: (string \| Buffer) => unknown, digest: (string) => string \| Buffer }` | present in handwritten env with concrete Abs shape |
| `crypto.randomBytes` | resolved | `(number) => Buffer` | present in handwritten env with concrete Abs shape |
| `process.env` | resolved | `{  }` | present in handwritten env with concrete Abs shape |
| `process.cwd` | resolved | `() => string` | present in handwritten env with concrete Abs shape |
| `process.argv` | resolved | `string[]` | present in handwritten env with concrete Abs shape |
| `os.platform` | resolved | `() => string` | present in handwritten env with concrete Abs shape |
| `Buffer.from` | resolved | `(string \| number[]) => Buffer` | present in handwritten env with concrete Abs shape |
| `child_process.spawn-native` | mock-required | `(string, string[], unknown) => unknown` | native process spawn — mock or env signature only; no side-effect simulation |

### ES / web sample

- ES: resolved 4/4
- Web: resolved 3/3

## Library three-state path

| Package | Kind | Installed here | Classification | Note |
|---|---|---|---|---|
| `commander` | js-source | yes | resolved | JS source present — analysis via execution / checkSource, not d.ts harvest |
| `ms` | js-source | yes | resolved | JS source — infer/check without handwritten mock |
| `@types/node` | types | yes | resolved | .d.ts harvest via harvestNodeTypes / nudo harvest node |
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
- Stream machine callbacks (Node Transform internals) — design-limitations §八
- Dual-entry browser/node variants (call-site records do not cross files)
- Functions with no call-site usage (entry@ fallback is honest)

## Node env module keys

```
child_process
crypto
events
fs
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
