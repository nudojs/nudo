---
"nudojs": major
"@nudojs/cli": major
---

**BREAKING**: merge `@nudojs/cli` into `nudojs` — one install unit for the `nudo` command.

- **`nudojs` is now the full CLI** (`check` / `test` / `contract` / `export` / `health` / `migrate`), with `bin: nudo` and the previous `@nudojs/cli` dependencies. `nudo --version` prints `nudojs <ver>` (+ `@nudojs/core <ver>` when resolvable).
- **`@nudojs/cli` is a deprecated migration stub** that forwards `nudo` and the module entry to `nudojs` and prints a deprecation line on stderr. Prefer `npm i -g nudojs`. The stub will be unpublished.
- No more "shell ≠ engine" version heads-up: the package you install is the product version.

Migration:

```bash
npm rm @nudojs/cli
npm i -g nudojs   # same `nudo` bin
```

`import "@nudojs/cli"` / `npx @nudojs/cli` keep working via the stub for one beta cycle.
