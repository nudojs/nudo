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

describe("narrow: in operator", () => {
  it("narrows 'key' in obj to objects with that property", () => {
    const env = createEnvironment();
    const objWithFoo = T.object({ foo: T.string });
    const objWithBar = T.object({ bar: T.number });
    env.bind("obj", T.union(objWithFoo, objWithBar));
    const expr = getTestExpr('"foo" in obj');
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueToString(trueEnv.lookup("obj"))).toBe("{ foo: string }");
    expect(typeValueToString(falseEnv.lookup("obj"))).toBe("{ bar: number }");
  });

  it("returns unchanged env when right side is not a union", () => {
    const env = createEnvironment();
    env.bind("obj", T.object({ foo: T.string }));
    const expr = getTestExpr('"foo" in obj');
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueToString(trueEnv.lookup("obj"))).toBe("{ foo: string }");
    expect(typeValueToString(falseEnv.lookup("obj"))).toBe("{ foo: string }");
  });
});
