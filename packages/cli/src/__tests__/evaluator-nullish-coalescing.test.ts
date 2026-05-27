import { describe, it, expect } from "vitest";
import { T, typeValueToString, createEnvironment } from "@nudojs/core";
import type { TypeValue } from "@nudojs/core";
import { evaluateProgram, evaluateFunction } from "../evaluator.ts";
import { parse } from "@nudojs/parser";

function evalSource(source: string) {
  const ast = parse(source);
  const env = createEnvironment();
  evaluateProgram(ast, env);
  return env;
}

function evalFn(code: string, args: TypeValue[]): TypeValue {
  const ast = parse(code);
  const env = createEnvironment();
  evaluateProgram(ast, env);
  const fns = ast.type === "File" ? ast.program.body : [];
  const fnNode = fns.find(
    (n: any) => n.type === "FunctionDeclaration",
  );
  if (!fnNode) throw new Error("No function found");
  return evaluateFunction(fnNode, args, env);
}

describe("nullish coalescing narrowing", () => {
  it("narrows ?? to exclude null/undefined from left side", () => {
    const env = evalSource(`
      const x = "hello" ?? "default";
    `);
    expect(typeValueToString(env.lookup("x"))).toBe('"hello"');
  });

  it("returns right side when left is always null", () => {
    const env = evalSource(`
      const x = null;
      const result = x ?? 42;
    `);
    expect(typeValueToString(env.lookup("result"))).toBe("42");
  });

  it("returns left side when left is never null", () => {
    const env = evalSource(`
      const x = "hello";
      const result = x ?? "default";
    `);
    expect(typeValueToString(env.lookup("result"))).toBe('"hello"');
  });

  it("narrows union type by removing null from left side", () => {
    const result = evalFn(
      `function test(x) { return x ?? "default"; }`,
      [T.union(T.string, T.null)],
    );
    // null is excluded from string | null, leaving string.
    // "default" is a subtype of string, so result is string.
    expect(typeValueToString(result)).toBe("string");
  });

  it("narrows union type by removing undefined from left side", () => {
    const result = evalFn(
      `function test(x) { return x ?? "fallback"; }`,
      [T.union(T.string, T.undefined)],
    );
    // undefined is excluded from string | undefined, leaving string.
    expect(typeValueToString(result)).toBe("string");
  });

  it("narrows union type by removing null and undefined from left side", () => {
    const result = evalFn(
      `function test(x) { return x ?? "fallback"; }`,
      [T.union(T.string, T.null, T.undefined)],
    );
    // null and undefined are excluded, leaving string.
    expect(typeValueToString(result)).toBe("string");
  });

  it("returns right side when left is always null/undefined union", () => {
    const result = evalFn(
      `function test(x) { return x ?? 42; }`,
      [T.union(T.null, T.undefined)],
    );
    // All left members are null/undefined, so use right side.
    expect(typeValueToString(result)).toBe("42");
  });
});
