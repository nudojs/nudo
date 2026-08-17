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
- Suggest and validate `@nudo:` directives
- Trace the full type transformation path from input to output

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

The Nudo MCP server exposes five tools. Each tool accepts JSON parameters and returns structured text output.

### `nudo-what-if`

Set type assumptions for function parameters and observe the inferred return type. This is the primary tool for AI-driven type exploration -- it lets an agent ask "what would the type be if these inputs had these types?" without modifying any source code.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | `string` | Yes | Path to the JavaScript file |
| `function` | `string` | Yes | Name of the function to analyze |
| `assumptions` | `Record<string, string>` | Yes | Map of parameter names to type assumptions |

**Example scenario**

You are reviewing a utility function and want to know what happens when one argument is `null`:

```
Tool: nudo-what-if
{
  "file": "src/utils.js",
  "function": "formatUser",
  "assumptions": {
    "user": "null",
    "fallback": "\"anonymous\""
  }
}
```

**Output**

```
Assumptions:
  user: null
  fallback: "anonymous"

Inferred return type: "anonymous"

Type flow:
  user → null
  user.name → never (access on null)
  user?.name ?? fallback → "anonymous"
```

The agent can use this to reason about null safety, default values, and edge cases without executing the code.

---

### `nudo-check`

Check a JavaScript file for type errors using Nudo's inference engine. Returns a list of diagnostics similar to what the CLI produces, but in a structured format suitable for programmatic consumption.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | `string` | Yes | Path to the JavaScript file to check |

**Example scenario**

After editing a file, ask the agent to verify there are no type issues:

```
Tool: nudo-check
{
  "file": "src/parser.js"
}
```

**Output**

```
src/parser.js: no errors found.
```

Or if there are issues:

```
src/parser.js:
  12:5 - Cannot access property "length" on type number
  24:10 - Type "hello" is not assignable to parameter of type number
```

---

### `nudo-type-at`

Get the inferred type at a specific position in a file. Useful when an agent needs to understand what type a variable, expression, or return value has at a particular line and column.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | `string` | Yes | Path to the JavaScript file |
| `line` | `number` | Yes | Line number (1-based) |
| `column` | `number` | Yes | Column number (1-based) |

**Example scenario**

An agent is trying to understand what type `result` holds after a series of operations:

```
Tool: nudo-type-at
{
  "file": "src/transform.js",
  "line": 18,
  "column": 12
}
```

**Output**

```
Position: src/transform.js:18:12
Expression: result
Inferred type: string | number
```

---

### `nudo-suggest-case`

Analyze a function and suggest `@nudo:case` directives that would exercise its different code paths. This helps an agent generate meaningful test inputs for type inference.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | `string` | Yes | Path to the JavaScript file |
| `function` | `string` | Yes | Name of the function to analyze |

**Example scenario**

An agent is helping write documentation or tests and needs to know what kinds of inputs a function handles:

```
Tool: nudo-suggest-case
{
  "file": "src/validators.js",
  "function": "validateEmail"
}
```

**Output**

```
Suggested cases for validateEmail:

  @nudo:case "valid email" ("user@example.com")
  @nudo:case "empty string" ("")
  @nudo:case "missing @" ("userexample.com")
  @nudo:case "null input" (null)
  @nudo:case "undefined input" (undefined)

Each case exercises a distinct code path through the function.
```

The agent can then add these directives to the file and run inference to verify the function's behavior across all paths.

---

### `nudo-trace`

Trace how types transform from input to output through a function. Shows each intermediate step of the type computation, making it possible to follow the full data flow.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | `string` | Yes | Path to the JavaScript file |
| `function` | `string` | Yes | Name of the function to trace |

**Example scenario**

An agent needs to understand a complex transformation pipeline:

```
Tool: nudo-trace
{
  "file": "src/transform.js",
  "function": "processData"
}
```

**Output**

```
Trace for processData:

  input: { raw: string, count: number }
  raw.split(",") -> string[]
  .map(s => s.trim()) -> string[]
  .filter(Boolean) -> string[]
  .slice(0, count) -> string[]

  Return type: string[]
```

This gives the agent a step-by-step view of how types change at each operation, which is valuable for debugging type mismatches and understanding unfamiliar code.

---

## Why This Matters for AI

Traditional AI-assisted coding relies on static analysis tools that require type annotations or on executing code to observe behavior. Nudo's MCP server offers a third path: **what-if analysis through abstract interpretation**.

When an AI agent encounters unfamiliar JavaScript code, it can:

1. **Explore type flow** -- Use `nudo-what-if` to test different input types and see how they propagate, without writing or running any code.
2. **Understand boundaries** -- Use `nudo-trace` to see exactly where a type narrows, widens, or transforms through a function.
3. **Validate changes** -- Use `nudo-check` to verify that an edit does not introduce type errors before committing it.
4. **Generate test cases** -- Use `nudo-suggest-case` to discover the interesting input scenarios a function should handle.

This is fundamentally different from running a linter or type checker after the fact. The agent can interrogate the type system interactively, forming and testing hypotheses about code behavior in a single conversation turn. The result is more accurate code changes with fewer back-and-forth cycles between the agent and the developer.
