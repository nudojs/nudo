import { describe, it, expect } from "vitest";
import { T, typeValueEquals, typeValueToString, createEnvironment } from "@justscript/core";
import { parse } from "@justscript/parser";
import { narrow } from "../narrowing.ts";
import type { ExpressionStatement } from "@babel/types";

function getTestExpr(source: string) {
  const ast = parse(source);
  const stmt = ast.program.body[0] as ExpressionStatement;
  return stmt.expression;
}

describe("narrow: typeof", () => {
  it("narrows typeof x === 'number' on union", () => {
    const env = createEnvironment();
    env.bind("x", T.union(T.number, T.string));
    const expr = getTestExpr('typeof x === "number"');
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueEquals(trueEnv.lookup("x"), T.number)).toBe(true);
    expect(typeValueEquals(falseEnv.lookup("x"), T.string)).toBe(true);
  });

  it("narrows typeof x === 'string' on union", () => {
    const env = createEnvironment();
    env.bind("x", T.union(T.number, T.string, T.boolean));
    const expr = getTestExpr('typeof x === "string"');
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueEquals(trueEnv.lookup("x"), T.string)).toBe(true);
    const falseType = falseEnv.lookup("x");
    expect(typeValueToString(falseType)).toBe("number | boolean");
  });

  it("narrows typeof x !== 'number' (inverted)", () => {
    const env = createEnvironment();
    env.bind("x", T.union(T.number, T.string));
    const expr = getTestExpr('typeof x !== "number"');
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueEquals(trueEnv.lookup("x"), T.string)).toBe(true);
    expect(typeValueEquals(falseEnv.lookup("x"), T.number)).toBe(true);
  });
});

describe("narrow: strict equality", () => {
  it("narrows x === null", () => {
    const env = createEnvironment();
    env.bind("x", T.union(T.null, T.number));
    const expr = getTestExpr("x === null");
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueEquals(trueEnv.lookup("x"), T.null)).toBe(true);
    expect(typeValueEquals(falseEnv.lookup("x"), T.number)).toBe(true);
  });

  it("narrows x === 1", () => {
    const env = createEnvironment();
    env.bind("x", T.union(T.literal(1), T.literal(2), T.literal(3)));
    const expr = getTestExpr("x === 1");
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueEquals(trueEnv.lookup("x"), T.literal(1))).toBe(true);
    const falseType = falseEnv.lookup("x");
    expect(typeValueToString(falseType)).toBe("2 | 3");
  });

  it("narrows x !== 1 (inverted)", () => {
    const env = createEnvironment();
    env.bind("x", T.union(T.literal(1), T.literal(2)));
    const expr = getTestExpr("x !== 1");
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueEquals(trueEnv.lookup("x"), T.literal(2))).toBe(true);
    expect(typeValueEquals(falseEnv.lookup("x"), T.literal(1))).toBe(true);
  });
});

describe("narrow: negation", () => {
  it("narrows !(typeof x === 'number')", () => {
    const env = createEnvironment();
    env.bind("x", T.union(T.number, T.string));
    const expr = getTestExpr('!(typeof x === "number")');
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueEquals(trueEnv.lookup("x"), T.string)).toBe(true);
    expect(typeValueEquals(falseEnv.lookup("x"), T.number)).toBe(true);
  });
});
