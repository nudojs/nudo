import { describe, it, expect } from "vitest";
import { T, typeValueToString, createEnvironment } from "@nudojs/core";
import { evaluateProgram } from "../evaluator.ts";
import { parse } from "@nudojs/parser";

function evalSource(source: string) {
  const ast = parse(source);
  const env = createEnvironment();
  evaluateProgram(ast, env);
  return env;
}

describe("optional chaining", () => {
  it("evaluates obj?.foo when obj is object", () => {
    const env = evalSource(`
      const obj = { foo: "hello" };
      const result = obj?.foo;
    `);
    expect(typeValueToString(env.lookup("result"))).toBe('"hello"');
  });

  it("evaluates arr?.[0] for optional computed access", () => {
    const env = evalSource(`
      const arr = [1, 2, 3];
      const result = arr?.[0];
    `);
    expect(typeValueToString(env.lookup("result"))).toBe("1");
  });

  it("evaluates fn?.() for optional call", () => {
    const env = evalSource(`
      const fn = () => 42;
      const result = fn?.();
    `);
    expect(typeValueToString(env.lookup("result"))).toBe("42");
  });
});
