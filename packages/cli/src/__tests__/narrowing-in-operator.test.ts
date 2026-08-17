import { describe, it, expect } from "vitest";
import { T, typeValueToString, createEnvironment } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { narrow } from "../narrowing.ts";
import { evaluateProgram } from "../evaluator.ts";
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

  it("evaluates Symbol.iterator in iterable receiver to true", () => {
    const env = createEnvironment();
    evaluateProgram(parse("const r = (Symbol.iterator in [1, 2]);").program, env);
    expect(typeValueToString(env.lookup("r"))).toBe("true");
  });

  it("evaluates Symbol.iterator in plain object to false", () => {
    const env = createEnvironment();
    evaluateProgram(parse("const o = { a: 1 }; const r = (Symbol.iterator in o);").program, env);
    expect(typeValueToString(env.lookup("r"))).toBe("false");
  });

  it("distributes Symbol.iterator in over unions", () => {
    const env = createEnvironment();
    evaluateProgram(
      parse("const flag = JSON.parse('x'); const x = flag ? [1] : 5; const r = (Symbol.iterator in x);").program,
      env,
    );
    expect(typeValueToString(env.lookup("x"))).toBe("[1] | 5");
    expect(typeValueToString(env.lookup("r"))).toBe("true | false");
  });
});
