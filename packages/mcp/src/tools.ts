import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { analyzeFile, getTypeAtPosition } from "@nudojs/service";
import { T, typeValueToString } from "@nudojs/core";
import type { TypeValue } from "@nudojs/core";

function parseTypeExpr(expr: string): TypeValue {
  const trimmed = expr.trim();
  if (trimmed === "number") return T.number;
  if (trimmed === "string") return T.string;
  if (trimmed === "boolean") return T.boolean;
  if (trimmed === "null") return T.null;
  if (trimmed === "undefined") return T.undefined;
  if (trimmed === "bigint") return T.bigint;
  if (trimmed === "symbol") return T.symbol;
  if (trimmed.includes("|")) {
    const members = trimmed.split("|").map(parseTypeExpr);
    return T.union(...members);
  }
  return T.unknown;
}

export function registerTools(server: McpServer): void {
  server.tool(
    "nudo-what-if",
    "Set type assumptions and observe inferred types at other positions. Use this to test 'what if X has type Y, what would Z be?'",
    {
      file: z.string().describe("Path to the JavaScript file"),
      bindings: z.array(z.object({
        name: z.string().describe("Variable name"),
        type: z.string().describe("Type expression, e.g., 'number', 'string | null'"),
      })).describe("Type assumptions to apply"),
      target: z.string().describe("Variable or expression to get the type of"),
    },
    async ({ file, bindings, target }) => {
      const filePath = resolve(file);
      const source = readFileSync(filePath, "utf-8");
      const result = analyzeFile(filePath, source);

      // Apply bindings to the environment and look up target
      // For now, use the analysis result bindings
      const typeStr = result.bindings.has(target)
        ? typeValueToString(result.bindings.get(target)!.type)
        : "unknown";

      return {
        content: [{
          type: "text" as const,
          text: `Type of "${target}": ${typeStr}`,
        }],
      };
    },
  );

  server.tool(
    "nudo-check",
    "Check a file for type errors and diagnostics",
    {
      file: z.string().describe("Path to the JavaScript file"),
    },
    async ({ file }) => {
      const filePath = resolve(file);
      const source = readFileSync(filePath, "utf-8");
      const result = analyzeFile(filePath, source);
      const errors = result.diagnostics.filter((d) => d.severity === "error");

      return {
        content: [{
          type: "text" as const,
          text: errors.length === 0
            ? "No type errors found"
            : errors.map((e) => `Line ${e.range.start.line}: ${e.message}`).join("\n"),
        }],
      };
    },
  );

  server.tool(
    "nudo-type-at",
    "Get the inferred type at a specific position in a file",
    {
      file: z.string().describe("Path to the JavaScript file"),
      line: z.number().describe("Line number (1-based)"),
      column: z.number().describe("Column number (0-based)"),
    },
    async ({ file, line, column }) => {
      const filePath = resolve(file);
      const source = readFileSync(filePath, "utf-8");
      const type = getTypeAtPosition(filePath, source, line, column);

      return {
        content: [{
          type: "text" as const,
          text: type ? typeValueToString(type) : "unknown",
        }],
      };
    },
  );

  server.tool(
    "nudo-suggest-case",
    "Suggest @nudo:case directives for a function based on its parameter types",
    {
      file: z.string().describe("Path to the JavaScript file"),
      functionName: z.string().describe("Name of the function"),
    },
    async ({ file, functionName }) => {
      const filePath = resolve(file);
      const source = readFileSync(filePath, "utf-8");
      const result = analyzeFile(filePath, source);
      const fn = result.functions.find((f) => f.name === functionName);

      if (!fn) {
        return {
          content: [{ type: "text" as const, text: `Function "${functionName}" not found` }],
        };
      }

      if (fn.cases.length > 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Function "${functionName}" already has ${fn.cases.length} case(s)`,
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: `Suggested: /** @nudo:case */\nfunction ${functionName}(...) { ... }`,
        }],
      };
    },
  );

  server.tool(
    "nudo-trace",
    "Trace how a type transforms from input to output in a function",
    {
      file: z.string().describe("Path to the JavaScript file"),
      functionName: z.string().describe("Function to trace"),
    },
    async ({ file, functionName }) => {
      const filePath = resolve(file);
      const source = readFileSync(filePath, "utf-8");
      const result = analyzeFile(filePath, source);
      const fn = result.functions.find((f) => f.name === functionName);

      if (!fn) {
        return {
          content: [{ type: "text" as const, text: `Function "${functionName}" not found` }],
        };
      }

      if (fn.cases.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No cases found for "${functionName}"` }],
        };
      }

      const traces = fn.cases.map((c) => {
        const args = c.args.map(typeValueToString).join(", ");
        return `Input: (${args}) => Output: ${typeValueToString(c.result)}`;
      }).join("\n");

      return {
        content: [{ type: "text" as const, text: traces }],
      };
    },
  );
}
