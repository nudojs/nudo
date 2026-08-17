import { describe, it, expect } from "vitest";
import { T, typeValueToString, createEnvironment } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { narrow } from "../narrowing.ts";
import type { ExpressionStatement } from "@babel/types";

function getTestExpr(source: string) {
  const ast = parse(source);
  const stmt = ast.program.body[0] as ExpressionStatement;
  return stmt.expression;
}

describe("narrow: discriminated unions", () => {
  it("narrows shape.kind === 'circle' to circle member", () => {
    const env = createEnvironment();
    const circle = T.object({ kind: T.literal("circle"), radius: T.number });
    const rect = T.object({ kind: T.literal("rect"), w: T.number, h: T.number });
    env.bind("shape", T.union(circle, rect));
    const expr = getTestExpr('shape.kind === "circle"');
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueToString(trueEnv.lookup("shape"))).toBe('{ kind: "circle", radius: number }');
    expect(typeValueToString(falseEnv.lookup("shape"))).toBe('{ kind: "rect", w: number, h: number }');
  });

  it("narrows shape.kind !== 'circle' (inverted)", () => {
    const env = createEnvironment();
    const circle = T.object({ kind: T.literal("circle"), radius: T.number });
    const rect = T.object({ kind: T.literal("rect"), w: T.number, h: T.number });
    env.bind("shape", T.union(circle, rect));
    const expr = getTestExpr('shape.kind !== "circle"');
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueToString(trueEnv.lookup("shape"))).toBe('{ kind: "rect", w: number, h: number }');
    expect(typeValueToString(falseEnv.lookup("shape"))).toBe('{ kind: "circle", radius: number }');
  });
});
