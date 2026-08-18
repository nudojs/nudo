---
sidebar_position: 6
---

# MCP Server (AI Agent Integration)

The `@nudojs/mcp` package provides a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that lets AI coding agents -- such as Claude Code, Cursor, and other MCP-compatible tools -- interact directly with Nudo's type inference engine. Instead of guessing what types a JavaScript function produces, an agent can ask Nudo and get precise answers derived from abstract interpretation.

## What is MCP

The Model Context Protocol is an open standard that lets AI assistants connect to external tools and data sources through a uniform interface. An MCP server exposes a set of **tools** (functions the AI can call) and optionally **resources** (data the AI can read). Clients like Claude Code, Cursor, and others discover and invoke these tools automatically.

For Nudo, this means an AI agent can:

- Explore how types flow through a function without running it
- Check files for type errors as part of a coding workflow
- Query `@nudo:` case coverage for a function
- Trace how each case's inputs map to outputs

This turns type inference from a manual, human-driven process into something an AI agent can use as a reasoning tool.

## Installation

```bash
pnpm add @nudojs/mcp
```

Or install globally if you prefer:

```bash
pnpm add -g @nudojs/mcp
```

## Setup

### Claude Code

Add the MCP server to your Claude Code configuration. Run the following command:

```bash
claude mcp add nudo -- npx @nudojs/mcp
```

Or manually add it to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "nudo": {
      "command": "npx",
      "args": ["@nudojs/mcp"]
    }
  }
}
```

### Cursor

In Cursor, open Settings > MCP > Add new MCP server and configure:

- **Name**: nudo
- **Type**: command
- **Command**: `npx @nudojs/mcp`

### Other MCP Clients

Any client that supports the MCP standard can connect to the server. The server communicates over stdio and requires no additional configuration beyond the command to launch it.

---

## Available Tools

The Nudo MCP server exposes five tools. Each tool accepts JSON parameters and returns text output.

The examples below share one file, `src/config.js`:

```js
const config = { retries: 3, label: "fast" };

// @nudo:case "greeting" ("Ada")
// @nudo:case "anonymous" ("")
function greet(name) {
  return "Hello, " + name;
}
```

### `nudo-what-if`

Set type assumptions and observe inferred types at other positions. This is the primary tool for AI-driven type exploration -- it lets an agent ask "what if X has type Y, what would Z be?" without modifying any source code.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | `string` | Yes | Path to the JavaScript file |
| `bindings` | `Array<{ name: string, type: string }>` | Yes | Type assumptions to apply. `name` is a variable name; `type` is a type expression such as `number` or `string \| null` |
| `target` | `string` | Yes | Variable or expression to get the type of |

**Example scenario**

An agent is about to use the `config` object elsewhere and wants to confirm its inferred shape first:

```json
{
  "file": "src/config.js",
  "bindings": [
    { "name": "config", "type": "{ retries: number, label: string }" }
  ],
  "target": "config"
}
```

**Output**

```
Type of "config": { retries: 3, label: "fast" }
```

The response always has the form `Type of "<target>": <type>`. If the target is not a known binding in the file, the type is reported as `unknown`. Note that in the current implementation the returned type comes from the file's own analysis -- the `bindings` assumptions do not override it.

---

### `nudo-check`

Check a JavaScript file for type errors using Nudo's inference engine. Only diagnostics with error severity are returned -- currently these come from failed `@nudo:` assertions, such as an `@nudo:returns` declaration that does not match the inferred return type.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | `string` | Yes | Path to the JavaScript file to check |

**Example scenario**

After editing a file, ask the agent to verify there are no type issues:

```json
{ "file": "src/config.js" }
```

**Output**

```
No type errors found
```

When errors exist, each one is reported on its own line in the form `Line N: message`. Given this file, where the `@nudo:returns` assertion contradicts the inferred result:

```js
// @nudo:case "double it" (5)
// @nudo:returns (T.string)
function double(x) {
  return x * 2;
}
```

the response is:

```
Line 3: @nudo:returns assertion failed for case "double it": expected string, got 10. Update the @nudo:returns directive to match the inferred type, or fix the function implementation
```

---

### `nudo-type-at`

Get the inferred type at a specific position in a file. Useful when an agent needs to understand what type a variable or expression has at a particular line and column.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | `string` | Yes | Path to the JavaScript file |
| `line` | `number` | Yes | Line number (1-based) |
| `column` | `number` | Yes | Column number (0-based) |

**Example scenario**

An agent wants the type of the `config` variable in `src/config.js`. The variable name starts on line 1 at column 6:

```json
{ "file": "src/config.js", "line": 1, "column": 6 }
```

**Output**

```
{ retries: 3, label: "fast" }
```

The response is the inferred type at that position, or `unknown` when no type information is available there.

---

### `nudo-suggest-case`

Suggest `@nudo:case` directives for a function based on its parameter types.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | `string` | Yes | Path to the JavaScript file |
| `functionName` | `string` | Yes | Name of the function |

**Example scenario**

An agent is documenting `src/config.js` and wants to check `@nudo:case` coverage for `greet`:

```json
{ "file": "src/config.js", "functionName": "greet" }
```

**Output**

```
Function "greet" already has 2 case(s)
```

Because whole-program inference synthesizes cases even for functions without directives, an existing function typically reports its current case count. Other possible responses are `Function "<functionName>" not found` when the name does not exist in the file, and -- for a function with no cases at all -- a `Suggested: /** @nudo:case */` line followed by `function <functionName>(...) { ... }`.

---

### `nudo-trace`

Trace how a type transforms from input to output in a function -- one line per case, showing the argument types and the result type.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | `string` | Yes | Path to the JavaScript file |
| `functionName` | `string` | Yes | Function to trace |

**Example scenario**

An agent needs to understand how `greet` transforms its input:

```json
{ "file": "src/config.js", "functionName": "greet" }
```

**Output**

```
Input: ("Ada") => Output: "Hello, Ada"
Input: ("") => Output: "Hello, "
```

Each line has the form `Input: (<argument types>) => Output: <result type>`. If the function does not exist, the response is `Function "<functionName>" not found`; if it has no cases, the response is `No cases found for "<functionName>"`.

---

## Why This Matters for AI

Traditional AI-assisted coding relies on static analysis tools that require type annotations or on executing code to observe behavior. Nudo's MCP server offers a third path: **type information from abstract interpretation, on demand**.

When an AI agent encounters unfamiliar JavaScript code, it can:

1. **Query inferred types** -- Use `nudo-what-if` and `nudo-type-at` to get the precise inferred type of a binding or a source position, without writing or running any code.
2. **Understand function behavior** -- Use `nudo-trace` to see how each case's argument types map to result types.
3. **Validate changes** -- Use `nudo-check` to catch error-level diagnostics, such as failed `@nudo:returns` assertions, before committing an edit.
4. **Check case coverage** -- Use `nudo-suggest-case` to see how many cases a function currently has, and add directives where coverage is thin.

This is fundamentally different from running a linter or type checker after the fact. The agent can interrogate the type system interactively, forming and testing hypotheses about code behavior in a single conversation turn. The result is more accurate code changes with fewer back-and-forth cycles between the agent and the developer.
