import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, parseTypeValueExpr } from "../directives.ts";
import { T, typeValueEquals } from "@nudojs/core";

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

  it("parses arrow function literal with parenthesized params", () => {
    const result = parseTypeValueExpr("(x) => x * 2");
    expect(result.kind).toBe("function");
    if (result.kind === "function") {
      expect(result.params).toEqual(["x"]);
      expect(result.body.type).toBe("BinaryExpression");
      expect(result.closure).toBeDefined();
      expect((result as any)._paramPatterns).toBeDefined();
    }
  });

  it("parses arrow function literal without parens", () => {
    const result = parseTypeValueExpr("x => x + 1");
    expect(result.kind).toBe("function");
    if (result.kind === "function") {
      expect(result.params).toEqual(["x"]);
    }
  });

  it("parses arrow function literal with multiple params", () => {
    const result = parseTypeValueExpr("(a, b) => a + b");
    expect(result.kind).toBe("function");
    if (result.kind === "function") {
      expect(result.params).toEqual(["a", "b"]);
    }
  });

  it("parses function expression literal", () => {
    const result = parseTypeValueExpr("function(x) { return x * 2; }");
    expect(result.kind).toBe("function");
    if (result.kind === "function") {
      expect(result.params).toEqual(["x"]);
      expect(result.body.type).toBe("BlockStatement");
    }
  });

  it("does not treat strings containing => as functions", () => {
    const result = parseTypeValueExpr('"a => b"');
    expect(result.kind).toBe("literal");
  });
});

describe("extractDirectives", () => {
  it("extracts @nudo:case directives from function", () => {
    const source = `
/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (T.number, T.number)
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
 * @nudo:case "test" (1)
 */
function foo(x) { return x; }

/**
 * @nudo:case "test2" ("hello")
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
 * @nudo:case "test" (T.number)
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
 * @nudo:case "string test" ("hello", "world")
 */
function greet(a, b) { return a + b; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    expect(results[0].directives[0].args).toHaveLength(2);
    expect(typeValueEquals(results[0].directives[0].args[0], T.literal("hello"))).toBe(true);
    expect(typeValueEquals(results[0].directives[0].args[1], T.literal("world"))).toBe(true);
  });

  it("extracts arrow function literal as case argument", () => {
    const source = `
/**
 * @nudo:case "x" ([1, 2, 3], (a) => a * 2)
 */
function apply(items, cb) { return items; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    const d = results[0].directives[0];
    expect(d.kind).toBe("case");
    expect(d.args[0].kind).toBe("tuple");
    expect(d.args[1].kind).toBe("function");
    if (d.args[1].kind === "function") {
      expect(d.args[1].params).toEqual(["a"]);
      expect(d.args[1].body.type).toBe("BinaryExpression");
    }
  });

  it("extracts arrow function inside nested object literal in case", () => {
    const source = `
/**
 * @nudo:case "s" ({ fn: (a) => a })
 */
function use(opts) { return opts; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    const d = results[0].directives[0];
    expect(d.kind).toBe("case");
    expect(d.args[0].kind).toBe("object");
    if (d.args[0].kind === "object") {
      const fn = d.args[0].properties.fn;
      expect(fn.kind).toBe("function");
      if (fn.kind === "function") {
        expect(fn.params).toEqual(["a"]);
      }
    }
  });
});
