# @nudojs/mcp

Model Context Protocol (MCP) server for Nudo type inference. Enables AI coding agents (Claude Code, Cursor, Copilot) to understand JavaScript types through Nudo's inference engine.

## Installation

```bash
pnpm add @nudojs/mcp
```

## Quick Start

```typescript
import { createServer } from "@nudojs/mcp";

const server = createServer();
server.start();
```

## Tools

| Tool | Description |
|------|-------------|
| `nudo-what-if` | Set type assumptions and observe inferred types at other positions |
| `nudo-check` | Check a file for type errors and diagnostics |
| `nudo-type-at` | Get the inferred type at a specific position |
| `nudo-suggest-case` | Suggest `@nudo:case` directives for a function |
| `nudo-trace` | Trace how types transform from input to output |

## Configuration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "nudo": {
      "command": "node",
      "args": ["path/to/@nudojs/mcp/dist/index.js"]
    }
  }
}
```

## Documentation

See the [MCP Server guide](https://nudojs.github.io/nudo/docs/guides/mcp-server) for full documentation.
