import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, parseTypeValueExpr } from "../directives.ts";
import { num, str } from "@nudojs/core";

describe("parseTypeValueExpr: Phase 2 enhancements", () => {
  it("parses T.array(T.number)", () => {
    const result = parseTypeValueExpr("T.array(T.number)");
    expect(result.shape.k).toBe("arr");
    if (result.shape.k === "arr") {
      expect(result.shape.element.shape).toEqual(num().shape);
    }
  });

  it("parses T.tuple([T.number, T.string])", () => {
    const result = parseTypeValueExpr("T.tuple([T.number, T.string])");
    expect(result.shape.k).toBe("tuple");
    if (result.shape.k === "tuple") {
      expect(result.shape.elements).toHaveLength(2);
      expect(result.shape.elements[0]!.shape).toEqual(num().shape);
      expect(result.shape.elements[1]!.shape).toEqual(str().shape);
    }
  });

  it("parses T.object({ x: T.number, y: T.string })", () => {
    const result = parseTypeValueExpr("T.object({ x: T.number, y: T.string })");
    expect(result.shape.k).toBe("obj");
    if (result.shape.k === "obj") {
      expect(result.shape.slots.x?.value.shape).toEqual(num().shape);
      expect(result.shape.slots.y?.value.shape).toEqual(str().shape);
    }
  });

  it("parses nested T.object with T.array", () => {
    const result = parseTypeValueExpr("T.object({ items: T.array(T.number) })");
    expect(result.shape.k).toBe("obj");
    if (result.shape.k === "obj") {
      expect(result.shape.slots.items?.value.shape.k).toBe("arr");
    }
  });

  it("parses T.object({})", () => {
    const result = parseTypeValueExpr("T.object({})");
    expect(result.shape.k).toBe("obj");
    if (result.shape.k === "obj") {
      expect(Object.keys(result.shape.slots)).toHaveLength(0);
    }
  });

  it("parses T.tuple([])", () => {
    const result = parseTypeValueExpr("T.tuple([])");
    expect(result.shape.k).toBe("tuple");
    if (result.shape.k === "tuple") {
      expect(result.shape.elements).toHaveLength(0);
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
