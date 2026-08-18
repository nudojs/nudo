---
sidebar_position: 5
---

# @nudojs/mcp

API reference for the Nudo MCP server package. This package exposes Nudo's type inference capabilities as MCP tools, enabling AI assistants to query type information and diagnostics.

## Installation

```bash
pnpm add @nudojs/mcp
```

## Server Setup

`@nudojs/mcp` is a ready-to-run stdio server. Its entry point creates the MCP server, registers all five tools, and connects over stdio -- there is no `createServer()`-style programmatic API to import:

```typescript
// package entry point (src/index.ts)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.ts";

const server = new McpServer({ name: "nudo", version: "0.1.0" });
registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
```

To use the server, configure your MCP client to launch it over stdio. See the [MCP Server guide](../guides/mcp-server.md) for Claude Code, Cursor, and generic client setup.

## Tools

### nudo-what-if

Set type assumptions and observe inferred types at other positions.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | Path to the JavaScript file |
| `bindings` | `Array<{ name: string, type: string }>` | Type assumptions to apply. `name` is a variable name; `type` is a type expression such as `number` or `string \| null` |
| `target` | `string` | Variable or expression to get the type of |

**Returns:** `Type of "<target>": <type>` -- the inferred type of the target, or `unknown` if it is not a known binding. The type comes from the file's own analysis; the `bindings` assumptions do not override it.

### nudo-check

Check a file for type errors and diagnostics.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | Path to the JavaScript file |

**Returns:** One `Line N: message` line per error-level diagnostic (for example a failed `@nudo:returns` assertion), or `No type errors found` when there are none.

### nudo-type-at

Get the inferred type at a specific position in a file.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | Path to the JavaScript file |
| `line` | `number` | Line number (1-based) |
| `column` | `number` | Column number (0-based) |

**Returns:** The inferred type at the given position, or `unknown`.

### nudo-suggest-case

Suggest @nudo:case directives for a function based on its parameter types.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | Path to the JavaScript file |
| `functionName` | `string` | Name of the function |

**Returns:** One of `Function "<functionName>" not found`, `Function "<functionName>" already has N case(s)`, or `Suggested: /** @nudo:case */` followed by `function <functionName>(...) { ... }`.

### nudo-trace

Trace how a type transforms from input to output in a function.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | Path to the JavaScript file |
| `functionName` | `string` | Function to trace |

**Returns:** One `Input: (<argument types>) => Output: <result type>` line per case, or `Function "<functionName>" not found` / `No cases found for "<functionName>"`.
