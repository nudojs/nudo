---
sidebar_position: 5
---

# Agent API

Reference for the agent-facing surface of `@nudojs/lsp`. All five agent commands live inside the Nudo language server and are reached through standard `workspace/executeCommand` calls or custom LSP requests — there is no separate server process or protocol to install. For connection setup (LSP→MCP bridges, native LSP clients, VS Code), see the [Agent Integration Guide](../guides/mcp-server.md).

## Commands

| Command | Custom request alias | Purpose |
|---------|---------------------|---------|
| `nudo.whatIf` | `nudo/whatIf` | Apply type assumptions to bindings and read the inferred type of a target |
| `nudo.suggestCase` | `nudo/suggestCase` | Check `@nudo:case` coverage; when every case is synthesized, return paste-ready directives |
| `nudo.trace` | `nudo/trace` | List each case's argument types → result type for a function |
| `nudo.selectCase` | `nudo/selectCase` | Switch the active case used for hover/diagnostics |
| `nudo.getActiveCases` | `nudo/getActiveCases` | Read the active case index of every function in a file |

`nudo.whatIf`, `nudo.suggestCase`, and `nudo.trace` return MCP-style text content — `{ content: [{ type: "text", text }] }` — so results drop straight into agent tooling. `nudo.selectCase` returns `{ success: true }`; `nudo.getActiveCases` returns `Record<string, number>`.

## Conventions

- **`file` parameter** — every command takes a `file` string, accepting either a `file://` URI or a bare path. Files that are not open in an editor are read from disk.
- **Editor-style requests** — the `nudo/selectCase` and `nudo/getActiveCases` requests additionally accept editor-style `{ uri, ... }` params (this is what the VS Code extension's CodeLens uses). Agents should always use `file`.
- **Type expressions** — see [Type expressions](#type-expressions) below.

---

## nudo.whatIf

Set type assumptions and observe the inferred type at another position — the primary tool for AI-driven type exploration.

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | `file://` URI or path to the JavaScript file |
| `bindings` | `Array<{ name: string, type: string }>` | Type assumptions to apply. `name` is a variable name; `type` is a type expression such as `number` or `string \| null` |
| `target` | `string` | Variable or expression to get the type of |

**Returns:** `{ content: [{ type: "text", text }] }` where `text` is `Type of "<target>": <type>` — the inferred type of the target **under the assumed bindings**, or `unknown` if it is not a known binding.

**Example** — given `const y = Number(x.trim())`, assume `x` is `string` and ask what `y` becomes:

```json
{
  "command": "nudo.whatIf",
  "arguments": [
    {
      "file": "src/app.js",
      "bindings": [{ "name": "x", "type": "string" }],
      "target": "y"
    }
  ]
}
```

```text
Type of "y": number
```

## nudo.suggestCase

Suggest `@nudo:case` directives for a function based on its parameter types.

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | `file://` URI or path to the JavaScript file |
| `functionName` | `string` | Name of the function |

**Returns:** `{ content: [{ type: "text", text }] }` with one of four outcomes:

- `Function "<functionName>" not found` — the file has no such function.
- `Suggested: /** @nudo:case */` followed by `function <functionName>(...) { ... }` — the function has no cases at all (only functions skipped by inference end up with zero cases).
- `Function "<functionName>" already has N case(s)` — the function has handwritten (or entry-only) `@nudo:case` cases; they are left untouched.
- Every case was synthesized from call sites — the reply is directive text that can be pasted into the source directly above the function, e.g.:

```text
Function "add" has 2 synthesized case(s); suggested directives:
/**
 * @nudo:case "call@L2" (1, 2)
 * @nudo:case "call@L3" ("x", "y")
*/
```

Cases whose arguments cannot be serialized as directives (functions, Promises, instances, …) are dropped and reported in a trailing `(M case(s) skipped: not serializable as directives)` line; if none of the cases is serializable, the reply falls back to `Function "<functionName>" already has N case(s) (none serializable as directives)`.

## nudo.trace

Trace how a type transforms from input to output in a function — one line per case.

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | `file://` URI or path to the JavaScript file |
| `functionName` | `string` | Function to trace |

**Returns:** `{ content: [{ type: "text", text }] }` with one `Input: (<argument types>) => Output: <result type>` line per case, or `Function "<functionName>" not found` / `No cases found for "<functionName>"`.

## nudo.selectCase

Switch the active case of a function. The active case drives hover types, diagnostics, and inlay hints until changed again.

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | `file://` URI or path to the JavaScript file |
| `functionName` | `string` | Name of the function |
| `caseIndex` | `number` | 0-based index of the case to activate |

**Returns:** `{ success: true }`. The server revalidates the document with the new active case and refreshes CodeLens.

## nudo.getActiveCases

Read the active case index of every function in a file.

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | `file://` URI or path to the JavaScript file |

**Returns:** `Record<string, number>` mapping function name → active case index, e.g. `{ "parse": 1, "greet": 0 }`.

## Type expressions

The `type` field of `nudo.whatIf` bindings accepts a primitive or a `|`-separated union of primitives:

| Expression | Meaning |
|------------|---------|
| `number` \| `string` \| `boolean` | The primitive type |
| `null` \| `undefined` | The corresponding singleton |
| `bigint` \| `symbol` | The remaining primitives |
| `string \| null` | Union — "string or null" |

## Diagnostics

Type errors (failed `@nudo:returns` assertions, unreachable code, …) are available as LSP diagnostics in both directions:

- **Push**: `textDocument/publishDiagnostics` after each analysis
- **Pull**: `textDocument/diagnostic` on demand

Pull mode is the natural fit for agents: open (or point at) a file, send `textDocument/diagnostic`, and read the severity-1 entries — no command call needed.

## Migration from the MCP server

The standalone `@nudojs/mcp` package is retired; its tools map onto the commands above:

| Old MCP tool | Replacement |
|--------------|-------------|
| `nudo-what-if` | `nudo.whatIf` — `bindings` are now actually applied (previously ignored) |
| `nudo-check` | Pull diagnostics via `textDocument/diagnostic` |
| `nudo-type-at` | `nudo.whatIf` with empty `bindings` and `target` set, or LSP hover |
| `nudo-suggest-case` | `nudo.suggestCase` |
| `nudo-trace` | `nudo.trace` |

See the [migration section](../guides/mcp-server.md#migrating-from-the-mcp-server) of the guide for connection-level changes.
