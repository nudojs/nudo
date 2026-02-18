import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, parseTypeValueExpr } from "../directives.ts";
import { T, typeValueEquals } from "@justscript/core";

describe("parseTypeValueExpr", () => {
  it("parses T.number", () => {
    expect(typeValueEquals(parseTypeValueExpr("T.number"), T.number)).toBe(true);
  });

  it("parses T.string", () => {
    expect(typeValueEquals(parseTypeValueExpr("T.string"), T.string)).toBe(true);
  });

  it("parses T.boolean", () => {
    expect(typeValueEquals(parseTypeValueExpr("T.boolean"), T.boolean)).toBe(true);
  });

  it("parses numeric literals", () => {
    expect(typeValueEquals(parseTypeValueExpr("42"), T.literal(42))).toBe(true);
    expect(typeValueEquals(parseTypeValueExpr("-3"), T.literal(-3))).toBe(true);
    expect(typeValueEquals(parseTypeValueExpr("1.5"), T.literal(1.5))).toBe(true);
  });

  it("parses string literals", () => {
    expect(typeValueEquals(parseTypeValueExpr('"hello"'), T.literal("hello"))).toBe(true);
    expect(typeValueEquals(parseTypeValueExpr("'world'"), T.literal("world"))).toBe(true);
  });

  it("parses boolean literals", () => {
    expect(typeValueEquals(parseTypeValueExpr("true"), T.literal(true))).toBe(true);
    expect(typeValueEquals(parseTypeValueExpr("false"), T.literal(false))).toBe(true);
  });

  it("parses null and undefined", () => {
    expect(typeValueEquals(parseTypeValueExpr("null"), T.literal(null))).toBe(true);
    expect(typeValueEquals(parseTypeValueExpr("undefined"), T.literal(undefined))).toBe(true);
  });

  it("parses T.literal(...)", () => {
    expect(typeValueEquals(parseTypeValueExpr("T.literal(42)"), T.literal(42))).toBe(true);
    expect(typeValueEquals(parseTypeValueExpr('T.literal("hi")'), T.literal("hi"))).toBe(true);
  });

  it("parses T.union(...)", () => {
    const result = parseTypeValueExpr("T.union(T.number, T.string)");
    const expected = T.union(T.number, T.string);
    expect(typeValueEquals(result, expected)).toBe(true);
  });
});

describe("extractDirectives", () => {
  it("extracts @just:case directives from function", () => {
    const source = `
/**
 * @just:case "concrete" (1, 2)
 * @just:case "symbolic" (T.number, T.number)
 */
function calc(a, b) {
  return a + b;
}
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("calc");
    expect(results[0].directives).toHaveLength(2);

    const d0 = results[0].directives[0];
    expect(d0.kind).toBe("case");
    expect(d0.name).toBe("concrete");
    expect(d0.args).toHaveLength(2);
    expect(typeValueEquals(d0.args[0], T.literal(1))).toBe(true);
    expect(typeValueEquals(d0.args[1], T.literal(2))).toBe(true);

    const d1 = results[0].directives[1];
    expect(d1.name).toBe("symbolic");
    expect(typeValueEquals(d1.args[0], T.number)).toBe(true);
    expect(typeValueEquals(d1.args[1], T.number)).toBe(true);
  });

  it("extracts from multiple functions", () => {
    const source = `
/**
 * @just:case "test" (1)
 */
function foo(x) { return x; }

/**
 * @just:case "test2" ("hello")
 */
function bar(s) { return s; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("foo");
    expect(results[1].name).toBe("bar");
  });

  it("ignores functions without directives", () => {
    const source = `
function noDirective(x) { return x; }

/**
 * @just:case "test" (T.number)
 */
function withDirective(x) { return x + 1; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("withDirective");
  });

  it("handles string arguments in case", () => {
    const source = `
/**
 * @just:case "string test" ("hello", "world")
 */
function greet(a, b) { return a + b; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    expect(results[0].directives[0].args).toHaveLength(2);
    expect(typeValueEquals(results[0].directives[0].args[0], T.literal("hello"))).toBe(true);
    expect(typeValueEquals(results[0].directives[0].args[1], T.literal("world"))).toBe(true);
  });
});
