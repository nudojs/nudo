import { describe, it, expect } from "vitest";
import { T, typeValueEquals, typeValueToString, createEnvironment } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { evaluateFunction } from "../evaluator.ts";

function getFunctionNode(source: string, name: string) {
  const ast = parse(source);
  const stmt = ast.program.body[0];
  if (stmt.type === "FunctionDeclaration" && stmt.id?.name === name) return stmt;
  throw new Error(`Function ${name} not found`);
}

describe("switch narrowing", () => {
  it("narrows discriminated union in switch cases", () => {
    const circle = T.object({ kind: T.literal("circle"), radius: T.number });
    const rect = T.object({ kind: T.literal("rect"), w: T.number, h: T.number });
    const shapeUnion = T.union(circle, rect);

    const source = `
function getArea(shape) {
  switch (shape.kind) {
    case "circle": return shape.radius;
    case "rect": return shape.w;
  }
}
`;

    const fnNode = getFunctionNode(source, "getArea");
    const env = createEnvironment();
    const result = evaluateFunction(fnNode, [shapeUnion], env);

    // shape.radius (circle) and shape.w (rect) are both number
    expect(typeValueEquals(result, T.number)).toBe(true);
  });

  it("narrows typeof in switch", () => {
    const source = `
function describe(x) {
  switch (typeof x) {
    case "string": return x.toUpperCase();
    case "number": return x + 1;
    default: return x;
  }
}
`;

    const fnNode = getFunctionNode(source, "describe");
    const env = createEnvironment();
    const result = evaluateFunction(fnNode, [T.union(T.string, T.number)], env);

    // string.toUpperCase() => string, number + 1 => number, default => string | number
    // All branches return string | number
    const expected = T.union(T.string, T.number);
    expect(typeValueEquals(result, expected)).toBe(true);
  });
});
