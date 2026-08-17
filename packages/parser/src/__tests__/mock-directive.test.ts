import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type MockDirective } from "../index.ts";

describe("Mock Directive", () => {
  describe("Arrow function support", () => {
    it("parses arrow function with single param", () => {
      const code = `
// @nudo:mock fn = (x) => x > 3
function filter(arr, fn) {
  return arr.filter(fn);
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      expect(directives.length).toBe(1);

      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives.length).toBe(1);
      expect(mockDirectives[0].name).toBe("fn");
      expect(mockDirectives[0].arrowFn).toBeDefined();
      expect(mockDirectives[0].arrowFn!.params).toEqual(["x"]);
    });

    it("parses arrow function with multiple params", () => {
      const code = `
// @nudo:mock comparator = (a, b) => a - b
function sort(arr, comparator) {
  return arr.sort(comparator);
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].arrowFn).toBeDefined();
      expect(mockDirectives[0].arrowFn!.params).toEqual(["a", "b"]);
    });

    it("parses arrow function with block body", () => {
      const code = `
// @nudo:mock fn = (x) => { return x * 2; }
function double(arr, fn) {
  return arr.map(fn);
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].arrowFn).toBeDefined();
      expect(mockDirectives[0].arrowFn!.params).toEqual(["x"]);
    });
  });

  describe("Regular expression support", () => {
    it("parses type expression", () => {
      const code = `
// @nudo:mock data = T.string
function foo(data) {
  return data;
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].name).toBe("data");
      expect(mockDirectives[0].expression).toBe("T.string");
      expect(mockDirectives[0].arrowFn).toBeUndefined();
    });

    it("parses from path", () => {
      const code = `
// @nudo:mock data from "./mock-data.ts"
function foo(data) {
  return data;
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].name).toBe("data");
      expect(mockDirectives[0].fromPath).toBe("./mock-data.ts");
    });
  });

  describe("Multiple mocks", () => {
    it("parses multiple mock directives", () => {
      const code = `
// @nudo:mock fn = (x) => x > 3
// @nudo:mock data = [1, 2, 3, 4, 5]
function filterAndProcess(data, fn) {
  return data.filter(fn);
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives.length).toBe(2);
      expect(mockDirectives[0].name).toBe("fn");
      expect(mockDirectives[0].arrowFn).toBeDefined();
      expect(mockDirectives[1].name).toBe("data");
      expect(mockDirectives[1].expression).toBe("[1, 2, 3, 4, 5]");
    });
  });
});
