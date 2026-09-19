import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, parseCaseArgExpr } from "../directives.ts";
import { num, str } from "@nudojs/core";

describe("parseCaseArgExpr: structural builders", () => {
  it("parses array(number())", () => {
    const result = parseCaseArgExpr("array(number())");
    expect(result.shape.k).toBe("arr");
    if (result.shape.k === "arr") {
      expect(result.shape.element.shape).toEqual(num().shape);
    }
  });

  it("parses tuple literal [number(), string()]", () => {
    const result = parseCaseArgExpr("[number(), string()]");
    expect(result.shape.k).toBe("tuple");
    if (result.shape.k === "tuple") {
      expect(result.shape.elements).toHaveLength(2);
      expect(result.shape.elements[0]!.shape).toEqual(num().shape);
      expect(result.shape.elements[1]!.shape).toEqual(str().shape);
    }
  });

  it("parses shape({ x: number(), y: string() })", () => {
    const result = parseCaseArgExpr("shape({ x: number(), y: string() })");
    expect(result.shape.k).toBe("obj");
    if (result.shape.k === "obj") {
      expect(result.shape.slots.x?.value.shape).toEqual(num().shape);
      expect(result.shape.slots.y?.value.shape).toEqual(str().shape);
    }
  });

  it("parses object literal { x: number(), y: string() }", () => {
    const result = parseCaseArgExpr("{ x: number(), y: string() }");
    expect(result.shape.k).toBe("obj");
    if (result.shape.k === "obj") {
      expect(result.shape.slots.x?.value.shape).toEqual(num().shape);
      expect(result.shape.slots.y?.value.shape).toEqual(str().shape);
    }
  });

  it("parses nested shape with array", () => {
    const result = parseCaseArgExpr("shape({ items: array(number()) })");
    expect(result.shape.k).toBe("obj");
    if (result.shape.k === "obj") {
      expect(result.shape.slots.items?.value.shape.k).toBe("arr");
    }
  });

  it("parses empty object literal {}", () => {
    const result = parseCaseArgExpr("{}");
    expect(result.shape.k).toBe("obj");
    if (result.shape.k === "obj") {
      expect(Object.keys(result.shape.slots)).toHaveLength(0);
    }
  });

  it("parses empty tuple literal []", () => {
    const result = parseCaseArgExpr("[]");
    expect(result.shape.k).toBe("tuple");
    if (result.shape.k === "tuple") {
      expect(result.shape.elements).toHaveLength(0);
    }
  });

  it("parses nested concrete literals inside builders", () => {
    expect(parseCaseArgExpr("union(number(), null)").shape.k).toBe("sum");
    expect(parseCaseArgExpr("array(null)").shape.k).toBe("arr");
    expect(parseCaseArgExpr("shape({ port: number() })").shape.k).toBe("obj");
  });
});

describe("extractDirectives: @nudo:mock", () => {
  it("extracts inline mock directive", () => {
    const source = `
/**
 * @nudo:mock fetch = any()
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
      expect(mocks[0].expression).toBe("any()");
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
 * @nudo:mock helper = number()
 * @nudo:case "test" (number())
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
