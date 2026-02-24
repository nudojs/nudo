import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, parseTypeValueExpr } from "../directives.ts";
import { T, typeValueEquals, typeValueToString } from "@nudo/core";

describe("parseTypeValueExpr: Phase 2 enhancements", () => {
  it("parses T.array(T.number)", () => {
    const result = parseTypeValueExpr("T.array(T.number)");
    expect(result.kind).toBe("array");
    if (result.kind === "array") {
      expect(typeValueEquals(result.element, T.number)).toBe(true);
    }
  });

  it("parses T.tuple([T.number, T.string])", () => {
    const result = parseTypeValueExpr("T.tuple([T.number, T.string])");
    expect(result.kind).toBe("tuple");
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(2);
      expect(typeValueEquals(result.elements[0], T.number)).toBe(true);
      expect(typeValueEquals(result.elements[1], T.string)).toBe(true);
    }
  });

  it("parses T.object({ x: T.number, y: T.string })", () => {
    const result = parseTypeValueExpr("T.object({ x: T.number, y: T.string })");
    expect(result.kind).toBe("object");
    if (result.kind === "object") {
      expect(typeValueEquals(result.properties.x, T.number)).toBe(true);
      expect(typeValueEquals(result.properties.y, T.string)).toBe(true);
    }
  });

  it("parses nested T.object with T.array", () => {
    const result = parseTypeValueExpr("T.object({ items: T.array(T.number) })");
    expect(result.kind).toBe("object");
    if (result.kind === "object") {
      expect(result.properties.items.kind).toBe("array");
    }
  });

  it("parses T.object({})", () => {
    const result = parseTypeValueExpr("T.object({})");
    expect(result.kind).toBe("object");
    if (result.kind === "object") {
      expect(Object.keys(result.properties)).toHaveLength(0);
    }
  });

  it("parses T.tuple([])", () => {
    const result = parseTypeValueExpr("T.tuple([])");
    expect(result.kind).toBe("tuple");
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(0);
    }
  });
});

describe("extractDirectives: @nudo:mock", () => {
  it("extracts inline mock directive", () => {
    const source = `
/**
 * @nudo:mock fetch = T.unknown
 * @nudo:case "test" (1)
 */
function foo(x) { return x; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    expect(results).toHaveLength(1);
    const mocks = results[0].directives.filter((d) => d.kind === "mock");
    expect(mocks).toHaveLength(1);
    expect(mocks[0].kind).toBe("mock");
    if (mocks[0].kind === "mock") {
      expect(mocks[0].name).toBe("fetch");
      expect(mocks[0].expression).toBe("T.unknown");
    }
  });

  it("extracts mock from file directive", () => {
    const source = `
/**
 * @nudo:mock utils from "./utils.mock.js"
 * @nudo:case "test" (1)
 */
function foo(x) { return x; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    const mocks = results[0].directives.filter((d) => d.kind === "mock");
    expect(mocks).toHaveLength(1);
    if (mocks[0].kind === "mock") {
      expect(mocks[0].name).toBe("utils");
      expect(mocks[0].fromPath).toBe("./utils.mock.js");
    }
  });

  it("extracts both mock and case directives", () => {
    const source = `
/**
 * @nudo:mock helper = T.number
 * @nudo:case "test" (T.number)
 */
function foo(x) { return x; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    const mocks = results[0].directives.filter((d) => d.kind === "mock");
    const cases = results[0].directives.filter((d) => d.kind === "case");
    expect(mocks).toHaveLength(1);
    expect(cases).toHaveLength(1);
  });
});
