---
sidebar_position: 8
---

# Call-Site Discovery

`@nudo:case` directives give you precise control over inference, but writing them for every exported function in a real library is a lot of manual work — and hand-written cases rarely match how a function is *actually* used. Call-site discovery flips the direction: instead of you describing inputs to Nudo, Nudo reads your existing usage sites — tests, examples, upstream applications — harvests the real argument shapes and results, and synthesizes cases from them.

```bash
nudo infer lib/ --callsites test/
```

## Quick Start

Given a small library:

```js
// lib/slugify.js
module.exports = function slugify(title) {
  return title.toLowerCase().replace(/ /g, "-");
};
```

...and a test that exercises it:

```js
// test/slugify.test.js
const slugify = require("../lib/slugify");

it("slugifies titles", () => {
  expect(slugify("Hello World")).toBe("hello-world");
});
```

Run inference over the library with the tests as usage sites:

```bash
nudo infer lib/ --callsites test/
```

Output:

```
=== slugify ===

Case "call@5": ("Hello World") => "hello-world"

Combined: string
```

The case was not written by anyone — it was harvested from line 5 of the test file, which is why it is named `call@5`. Every recorded call site becomes one synthesized case; multiple call sites to the same function union into the combined type, exactly like hand-written `@nudo:case` directives do.

### Options

| Argument | Description |
|----------|-------------|
| `<target>` | File or directory to analyze. Directories are scanned recursively. |
| `--callsites <paths...>` | One or more usage-site files or directories (tests, examples, apps). Directories are scanned recursively. |
| `--emit-cases [mode]` | Write the harvested cases back into the analyzed file as `@nudo:case` directives (`add` fills in functions without case directives; `=update` re-synchronizes generated ones) — see [Persisting harvested results](#persisting-harvested-results) |

## How It Works

Call-site discovery runs in two phases.

### Phase 1 — Harvest

For each usage-site file, the evaluator runs the file's top-level statements and captures every call it can observe:

- **Top-level evaluation** — `require` calls, setup code, and direct calls at module top level execute, so their argument values are captured as concrete type values.
- **Test callback injection** — callbacks passed to `it`, `test`, and `describe` are invoked with `unknown` parameters, which executes the test body and captures the calls inside it. The callback bodies execute inside the evaluator — the test framework itself never runs. Only calls that resolve to functions in the analyzed targets are kept.
- Each observed call produces a **CallRecord**: the callee name, the argument types, the result type, whether the call threw, and the call location.

The test suite is never actually run against your code — the harvesting pass executes the *shape* of the test file inside Nudo's evaluator, not your real modules.

### Phase 2 — Match and Synthesize

The harvested records are matched against functions defined in the analyzed files through three routes:

1. **Export name** — the usage site bound an export by name (e.g. `const { merge } = require("@hapi/hoek")`), so the record targets the function exported as `merge`. Re-exports and barrels are handled by tagging a function at its first definition site and collecting later export names into its aliases.
2. **Function name** — the record's callee name matches a declared function in the target file.
3. **Single-export module path** — a file whose only export is the function itself (`module.exports = function f() {}`) is matched by module path, because every such module's export name is the same (`default`) and name matching alone would collide across files.

Matched records are injected into `analyzeFile` as synthesized `call@L` cases, where `L` is the line of the call in the usage-site file. Functions that receive no records at all still get an `entry@L` case with `T.unknown` parameters so their signature is emitted — they are marked as entry-only.

## Safety Design

Mining real usage sites is only useful if the records can be trusted. Three guards keep bad records out:

- **Attribution gate.** A record only participates in matching for a file if the module it was resolved from (via the call's function module or the bound export's target module) actually points at that file. Without this gate, a same-named helper defined inside a test file would smear its record across every file that happens to declare a function with the same name — in one trial, a single test-helper record polluted 22 files with 51 fake "precise" results.
- **Usage-site leak marking.** Records captured while executing usage-site code are marked as such. They are trusted as *argument evidence* (the shapes callers pass are real), but the evaluator never mistakes a test-local evaluation environment for the library's own.
- **`never` / `never` filtering.** A record whose result type is `never` *and* whose throw type is `never` did not really return — evaluation was interrupted mid-call (for example an `await` inside a `new Promise(async ...)` executor). Such records are filtered out before injection instead of being treated as "returns never".

## Trial Results

Run against two real libraries, with their own test suites as usage sites:

| Library | Version | Precise rate | Errors |
|---------|---------|--------------|--------|
| `@hapi/hoek` | 9.3.0 (25 files, 42 functions) | 54.8% → **98.6%** | 291 → **0** |
| `@discoveryjs/json-ext` | 0.5.7 | 77.8% → **91.8%** | 41 → **0** |

No directives were written for either library — every case in the second column of results is synthesized from a recorded call site.

## Known Boundaries

- **Entry-only fallback.** Functions that no usage site calls still produce an `entry@L` case, but with `T.unknown` parameters — the signature exists, the types do not.
- **Nested functions.** The matching chain resolves top-level and hoisted declarations. Function expressions defined *inside* another function body do not currently participate in name matching.
- **Dual-entry variants.** When the same behavior is reachable through two entry shapes (exported directly and re-wrapped, for example), each entry contributes its own recorded cases; the combined type is the union of both entries, which can be wider than either entry alone.

## Persisting Harvested Results

Harvested cases exist only within the run that harvested them — the records are matched, injected as `call@L` cases, printed, and then discarded. `--emit-cases` persists them: it writes the synthesized cases back into the analyzed file as real `@nudo:case` directives, so the shapes survive outside the harvesting run.

```bash
nudo infer lib/ --callsites test/ --emit-cases         # add: fill in functions that have no case directives
nudo infer lib/ --callsites test/ --emit-cases=update  # update: re-synchronize previously generated directives
```

`add` only fills in functions with no case directives at all. `update` goes further: it strips the previously generated `call@` directives, re-analyzes the stripped source, and writes the refreshed set back — which is why it also surfaces *drift* at the usage sites. A test that changed its arguments shows up as a diff; `--emit-cases=update --dry-run --exit-on-diff` turns that into a CI gate that exits `1` on any non-empty diff. Both modes are idempotent (`No changes.` on a synced file).

### Merge policy

Emission never touches hand-written work; it only manages its own `call@` directives:

| Function's existing cases | `--emit-cases` (add) | `--emit-cases=update` |
|---------------------------|----------------------|------------------------|
| Hand-written `@nudo:case` (name not starting with `call@`) | never touched | never touched |
| Generated `call@` directives | not touched — reported `already-generated` | fully re-synchronized: added, changed, or deleted to match current call evidence (JSDoc blocks left empty are removed) |
| No directives, but call evidence exists | directives written | directives written |
| No call sites at all (entry-only) | not written — reported `entry-only` | not written — reported `entry-only` |

### Limitations

- **Serializable shapes only.** Directive text can express primitives (`T.number`/`T.string`/`T.boolean`/`T.unknown`/`T.never`), literals, plain objects, arrays, tuples, and unions. Cases whose arguments contain functions, Promises, class instances, `bigint`, or `symbol` values cannot be frozen — they are skipped and reported as `no-serializable-cases` (the function's remaining serializable cases are still written).
- **`call@` is a reserved prefix.** Any `@nudo:case` whose name starts with `call@` is treated as generated: `update` may rewrite or delete it. Don't name hand-written cases `call@…`.

End-to-end workflow examples (bootstrap and drift detection) are in the [CLI guide — Persisting cases as directives](/docs/guides/cli#persisting-cases-as-directives); the programmatic flow over these functions is documented under [service API — Case Emission](/docs/api/service#case-emission).

## Programmatic API

The service package exposes both phases:

```typescript
import { collectCallRecords, analyzeFile } from "@nudojs/service";

// Phase 1: harvest call records from a usage-site file
const records = collectCallRecords(usagePath, usageSource);

// Phase 2: analyze with external records injected as call@L cases
const result = analyzeFile(filePath, source, activeCases, records);
```

| Export | Description |
|--------|-------------|
| `collectCallRecords(filePath, source)` | Runs phase 1 on a usage-site file and returns its call records. |
| `analyzeFile(filePath, source, activeCases?, externalCallRecords?)` | `analyzeFile` accepts harvested records as its fourth parameter; they are matched and injected as `call@L` cases. |

See the [service API reference](/docs/api/service) for the full `AnalysisResult` shape.

## Next Steps

- **[Language Semantics](/docs/guides/semantics)** — what the evaluator can do with the shapes call-site discovery hands it: `this` binding, promises, iterables, and more.
- **[CLI Usage](/docs/guides/cli)** — all `nudo infer` and `nudo watch` options.
