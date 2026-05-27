import { describe, it, expect } from "vitest";
import { T, typeValueEquals, typeValueToString, createEnvironment } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { narrow } from "../narrowing.ts";
import type { ExpressionStatement } from "@babel/types";

function getTestExpr(source: string) {
  const ast = parse(source);
  const stmt = ast.program.body[0] as ExpressionStatement;
  return stmt.expression;
}

describe("narrow: truthiness", () => {
  it("narrows if(x) to exclude null and undefined", () => {
    const env = createEnvironment();
    env.bind("x", T.union(T.string, T.null, T.undefined));
    const expr = getTestExpr("x");
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueEquals(trueEnv.lookup("x"), T.string)).toBe(true);
    const falseType = falseEnv.lookup("x");
    expect(typeValueToString(falseType)).toBe("null | undefined");
  });

  it("narrows if(x) to exclude 0, empty string, false", () => {
    const env = createEnvironment();
    env.bind("x", T.union(T.number, T.string, T.boolean, T.null));
    const expr = getTestExpr("x");
    const [trueEnv, falseEnv] = narrow(expr, env);
    const trueType = trueEnv.lookup("x");
    expect(typeValueToString(trueType)).toBe("number | string | boolean");
  });

  it("does not narrow non-union types", () => {
    const env = createEnvironment();
    env.bind("x", T.string);
    const expr = getTestExpr("x");
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueEquals(trueEnv.lookup("x"), T.string)).toBe(true);
    expect(typeValueEquals(falseEnv.lookup("x"), T.string)).toBe(true);
  });
});
