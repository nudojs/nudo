import { describe, it, expect } from "vitest";
import { T } from "@justscript/core";
import { extractDirectives } from "../directives.ts";
import { parse } from "../parse.ts";

function getDirectives(source: string) {
  const ast = parse(source);
  return extractDirectives(ast);
}

describe("@just:pure directive", () => {
  it("parses @just:pure", () => {
    const fns = getDirectives(`
      /**
       * @just:pure
       * @just:case "test" (1, 2)
       */
      function add(a, b) { return a + b; }
    `);
    expect(fns.length).toBe(1);
    const directives = fns[0].directives;
    expect(directives.some((d) => d.kind === "pure")).toBe(true);
    expect(directives.some((d) => d.kind === "case")).toBe(true);
  });
});

describe("@just:skip directive", () => {
  it("parses @just:skip without return type", () => {
    const fns = getDirectives(`
      /**
       * @just:skip
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

  it("parses @just:skip with return type", () => {
    const fns = getDirectives(`
      /**
       * @just:skip T.number
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

describe("@just:sample directive", () => {
  it("parses @just:sample with count", () => {
    const fns = getDirectives(`
      /**
       * @just:sample 5
       * @just:case "test" (T.number)
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

describe("@just:returns directive", () => {
  it("parses @just:returns with type", () => {
    const fns = getDirectives(`
      /**
       * @just:returns (T.number)
       * @just:case "test" (1, 2)
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
