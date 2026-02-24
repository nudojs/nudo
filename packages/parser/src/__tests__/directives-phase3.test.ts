import { describe, it, expect } from "vitest";
import { T } from "@nudo/core";
import { extractDirectives } from "../directives.ts";
import { parse } from "../parse.ts";

function getDirectives(source: string) {
  const ast = parse(source);
  return extractDirectives(ast);
}

describe("@nudo:pure directive", () => {
  it("parses @nudo:pure", () => {
    const fns = getDirectives(`
      /**
       * @nudo:pure
       * @nudo:case "test" (1, 2)
       */
      function add(a, b) { return a + b; }
    `);
    expect(fns.length).toBe(1);
    const directives = fns[0].directives;
    expect(directives.some((d) => d.kind === "pure")).toBe(true);
    expect(directives.some((d) => d.kind === "case")).toBe(true);
  });
});

describe("@nudo:skip directive", () => {
  it("parses @nudo:skip without return type", () => {
    const fns = getDirectives(`
      /**
       * @nudo:skip
       */
      function external() {}
    `);
    expect(fns.length).toBe(1);
    const skip = fns[0].directives.find((d) => d.kind === "skip");
    expect(skip).toBeDefined();
    if (skip && skip.kind === "skip") {
      expect(skip.returns).toBeUndefined();
    }
  });

  it("parses @nudo:skip with return type", () => {
    const fns = getDirectives(`
      /**
       * @nudo:skip T.number
       */
      function external() {}
    `);
    expect(fns.length).toBe(1);
    const skip = fns[0].directives.find((d) => d.kind === "skip");
    expect(skip).toBeDefined();
    if (skip && skip.kind === "skip") {
      expect(skip.returns).toEqual(T.number);
    }
  });
});

describe("@nudo:sample directive", () => {
  it("parses @nudo:sample with count", () => {
    const fns = getDirectives(`
      /**
       * @nudo:sample 5
       * @nudo:case "test" (T.number)
       */
      function loop(n) { return n; }
    `);
    expect(fns.length).toBe(1);
    const sample = fns[0].directives.find((d) => d.kind === "sample");
    expect(sample).toBeDefined();
    if (sample && sample.kind === "sample") {
      expect(sample.count).toBe(5);
    }
  });
});

describe("@nudo:returns directive", () => {
  it("parses @nudo:returns with type", () => {
    const fns = getDirectives(`
      /**
       * @nudo:returns (T.number)
       * @nudo:case "test" (1, 2)
       */
      function add(a, b) { return a + b; }
    `);
    expect(fns.length).toBe(1);
    const returns = fns[0].directives.find((d) => d.kind === "returns");
    expect(returns).toBeDefined();
    if (returns && returns.kind === "returns") {
      expect(returns.expected).toEqual(T.number);
    }
  });
});
