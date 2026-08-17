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

```typescript
import { createServer } from "@nudojs/mcp";

const server = createServer();
server.start();
```

## Tools

### nudo-what-if

Set type assumptions and observe inferred types at other positions.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | Path to the JavaScript file |
| `bindings` | `Array<{name: string, type: string}>` | Type assumptions to apply |
| `target` | `string` | Variable or expression to get the type of |

**Returns:** Type of the target variable under the given assumptions.

### nudo-check

Check a file for type errors and diagnostics.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | Path to the JavaScript file |

**Returns:** List of type errors found, or "No type errors found".

### nudo-type-at

Get the inferred type at a specific position in a file.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | Path to the JavaScript file |
| `line` | `number` | Line number (1-based) |
| `column` | `number` | Column number (0-based) |

**Returns:** The inferred type at the given position, or "unknown".

### nudo-suggest-case

Suggest @nudo:case directives for a function based on its parameter types.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | Path to the JavaScript file |
| `functionName` | `string` | Name of the function |

**Returns:** Suggested @nudo:case directive or info about existing cases.

### nudo-trace

Trace how a type transforms from input to output in a function.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `file` | `string` | Path to the JavaScript file |
| `functionName` | `string` | Function to trace |

**Returns:** Type transformation trace showing input to output for each case.
