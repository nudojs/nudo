import { describe, it, expect } from "vitest";
import { T, typeValueEquals, createEnvironment } from "@nudojs/core";
import { evaluateProgram } from "../evaluator.ts";
import { parse } from "@nudojs/parser";
import type { TypeValue } from "@nudojs/core";

function evalExpr(code: string): TypeValue {
  const ast = parse(code);
  const env = createEnvironment();
  return evaluateProgram(ast, env);
}

function evalWith(code: string, bindings: Record<string, TypeValue>): TypeValue {
  const ast = parse(code);
  const env = createEnvironment();
  for (const [k, v] of Object.entries(bindings)) env.bind(k, v);
  return evaluateProgram(ast, env);
}

describe("String methods - literal receiver", () => {
  it("toUpperCase", () => {
    expect(typeValueEquals(evalExpr('"hello".toUpperCase()'), T.literal("HELLO"))).toBe(true);
  });

  it("toLowerCase", () => {
    expect(typeValueEquals(evalExpr('"HELLO".toLowerCase()'), T.literal("hello"))).toBe(true);
  });

  it("trim", () => {
    expect(typeValueEquals(evalExpr('"  hi  ".trim()'), T.literal("hi"))).toBe(true);
  });

  it("trimStart", () => {
    expect(typeValueEquals(evalExpr('"  hi".trimStart()'), T.literal("hi"))).toBe(true);
  });

  it("trimEnd", () => {
    expect(typeValueEquals(evalExpr('"hi  ".trimEnd()'), T.literal("hi"))).toBe(true);
  });

  it("charAt", () => {
    expect(typeValueEquals(evalExpr('"abc".charAt(1)'), T.literal("b"))).toBe(true);
  });

  it("charCodeAt", () => {
    expect(typeValueEquals(evalExpr('"A".charCodeAt(0)'), T.literal(65))).toBe(true);
  });

  it("at", () => {
    expect(typeValueEquals(evalExpr('"abc".at(-1)'), T.literal("c"))).toBe(true);
  });

  it("startsWith", () => {
    expect(typeValueEquals(evalExpr('"hello".startsWith("he")'), T.literal(true))).toBe(true);
    expect(typeValueEquals(evalExpr('"hello".startsWith("lo")'), T.literal(false))).toBe(true);
  });

  it("endsWith", () => {
    expect(typeValueEquals(evalExpr('"hello".endsWith("lo")'), T.literal(true))).toBe(true);
    expect(typeValueEquals(evalExpr('"hello".endsWith("he")'), T.literal(false))).toBe(true);
  });

  it("includes", () => {
    expect(typeValueEquals(evalExpr('"hello".includes("ell")'), T.literal(true))).toBe(true);
    expect(typeValueEquals(evalExpr('"hello".includes("xyz")'), T.literal(false))).toBe(true);
  });

  it("indexOf", () => {
    expect(typeValueEquals(evalExpr('"hello".indexOf("l")'), T.literal(2))).toBe(true);
    expect(typeValueEquals(evalExpr('"hello".indexOf("z")'), T.literal(-1))).toBe(true);
  });

  it("lastIndexOf", () => {
    expect(typeValueEquals(evalExpr('"hello".lastIndexOf("l")'), T.literal(3))).toBe(true);
  });

  it("slice", () => {
    expect(typeValueEquals(evalExpr('"hello".slice(1, 3)'), T.literal("el"))).toBe(true);
    expect(typeValueEquals(evalExpr('"hello".slice(2)'), T.literal("llo"))).toBe(true);
  });

  it("substring", () => {
    expect(typeValueEquals(evalExpr('"hello".substring(1, 4)'), T.literal("ell"))).toBe(true);
  });

  it("split", () => {
    const result = evalExpr('"a,b,c".split(",")');
    expect(result.kind).toBe("tuple");
    if (result.kind === "tuple") {
      expect(result.elements.length).toBe(3);
      expect(typeValueEquals(result.elements[0], T.literal("a"))).toBe(true);
      expect(typeValueEquals(result.elements[1], T.literal("b"))).toBe(true);
      expect(typeValueEquals(result.elements[2], T.literal("c"))).toBe(true);
    }
  });

  it("replace", () => {
    expect(typeValueEquals(evalExpr('"hello".replace("l", "r")'), T.literal("herlo"))).toBe(true);
  });

  it("replaceAll", () => {
    expect(typeValueEquals(evalExpr('"hello".replaceAll("l", "r")'), T.literal("herro"))).toBe(true);
  });

  it("repeat", () => {
    expect(typeValueEquals(evalExpr('"ab".repeat(3)'), T.literal("ababab"))).toBe(true);
  });

  it("padStart", () => {
    expect(typeValueEquals(evalExpr('"5".padStart(3, "0")'), T.literal("005"))).toBe(true);
  });

  it("padEnd", () => {
    expect(typeValueEquals(evalExpr('"5".padEnd(3, "0")'), T.literal("500"))).toBe(true);
  });
});

describe("String methods - abstract receiver", () => {
  it("toUpperCase returns string", () => {
    const result = evalWith("x.toUpperCase()", { x: T.string });
    expect(typeValueEquals(result, T.string)).toBe(true);
  });

  it("startsWith returns boolean", () => {
    const result = evalWith('x.startsWith("a")', { x: T.string });
    expect(typeValueEquals(result, T.boolean)).toBe(true);
  });

  it("indexOf returns number", () => {
    const result = evalWith('x.indexOf("a")', { x: T.string });
    expect(typeValueEquals(result, T.number)).toBe(true);
  });

  it("split returns string[]", () => {
    const result = evalWith('x.split(",")', { x: T.string });
    expect(result.kind).toBe("array");
    if (result.kind === "array") {
      expect(typeValueEquals(result.element, T.string)).toBe(true);
    }
  });

  it("charAt returns string", () => {
    const result = evalWith("x.charAt(0)", { x: T.string });
    expect(typeValueEquals(result, T.string)).toBe(true);
  });

  it("slice returns string", () => {
    const result = evalWith("x.slice(1)", { x: T.string });
    expect(typeValueEquals(result, T.string)).toBe(true);
  });
});
