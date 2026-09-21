---
slug: /guides/health
description: nudo health — analysis errors and solidification drift in CI.
---

# nudo health

`nudo health` reports **analysis errors** and **call-site solidification drift**. It complements `nudo check` (contract gate): health watches whether recorded evidence still matches the code.

```bash
npx nudojs health [paths…] [--watch] [--from paths…] [--json]
```

Exit `1` on drift or analysis errors. Uncovered functions are informational only.

```bash
npx nudojs health src/ --from tests/
```

When generated `call@` directives would change, health reports drift and suggests:

```bash
npx nudojs test lib.js --from test.js --freeze=update
```

`test --freeze` is an **optional** debug solidification tool — the product CI gate remains `nudo check`.

## CI snippet

```yaml
- run: npx nudojs check src/
- run: npx nudojs health src/ --from tests/
```

More recipes: [Recipes](./recipes.md).

## Next

- [nudo check](./check.md)
- [Diagnostics](../reference/diagnostics.md)
- [Call-site discovery](./callsite-discovery.md)
