import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { T, typeValueToString } from "@justscript/core";
import { analyzeFile, getTypeAtPosition, getCompletionsAtPosition } from "../analyzer.ts";

const FIXTURE_PATH = resolve(import.meta.dirname, "fixtures", "sample.just.js");

const SAMPLE_SOURCE = `
/**
 * @just:case "concrete" (1, 2)
 * @just:case "symbolic" (T.number, T.number)
 */
function add(a, b) {
  return a + b;
}

/**
 * @just:case "test" ({ name: "Alice", age: 30 })
 */
function greet({ name, age }) {
  return name;
}
`;

const THROWS_SOURCE = `
/**
 * @just:case "valid" (10)
 * @just:case "negative" (-1)
 */
function safeSqrt(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return x;
}
`;

const OBJ_SOURCE = `
const obj = { x: 1, y: "hello", z: true };

/**
 * @just:case "test" (T.number)
 */
function identity(x) {
  return x;
}
`;

describe("analyzeFile", () => {
  it("analyzes functions with @just:case directives", () => {
    const result = analyzeFile("/test/sample.just.js", SAMPLE_SOURCE);
    expect(result.functions).toHaveLength(2);

    const addFn = result.functions[0];
    expect(addFn.name).toBe("add");
    expect(addFn.cases).toHaveLength(2);
    expect(addFn.cases[0].name).toBe("concrete");
    expect(typeValueToString(addFn.cases[0].result)).toBe("3");
    expect(addFn.cases[1].name).toBe("symbolic");
    expect(typeValueToString(addFn.cases[1].result)).toBe("number");
  });

  it("provides combined type for multiple cases", () => {
    const result = analyzeFile("/test/sample.just.js", SAMPLE_SOURCE);
    const addFn = result.functions[0];
    expect(addFn.combined).toBeDefined();
    expect(typeValueToString(addFn.combined!)).toBe("3 | number");
  });

  it("reports throws as diagnostics", () => {
    const result = analyzeFile("/test/throws.just.js", THROWS_SOURCE);
    expect(result.functions).toHaveLength(1);
    const fn = result.functions[0];
    expect(fn.cases).toHaveLength(2);

    const negativeCaseThrows = fn.cases[1].throws;
    expect(negativeCaseThrows.kind).not.toBe("never");
  });

  it("returns source locations for functions", () => {
    const result = analyzeFile("/test/sample.just.js", SAMPLE_SOURCE);
    const addFn = result.functions[0];
    expect(addFn.loc.start.line).toBeGreaterThan(0);
    expect(addFn.loc.end.line).toBeGreaterThan(addFn.loc.start.line);
  });

  it("collects top-level bindings", () => {
    const result = analyzeFile("/test/obj.just.js", OBJ_SOURCE);
    expect(result.bindings.has("obj")).toBe(true);
    const objBinding = result.bindings.get("obj")!;
    expect(objBinding.type.kind).toBe("object");
  });
});

describe("getTypeAtPosition", () => {
  it("returns type for identifier at position", () => {
    const source = `const x = 42;\nconst y = x;\n`;
    const tv = getTypeAtPosition("/test/pos.just.js", source, 1, 6);
    expect(tv).not.toBeNull();
  });

  it("returns null for empty position", () => {
    const source = `\n\n\n`;
    const tv = getTypeAtPosition("/test/empty.just.js", source, 2, 0);
    expect(tv).toBeNull();
  });
});

describe("getCompletionsAtPosition", () => {
  it("returns variable completions without dot trigger", () => {
    const source = `const x = 42;\nfunction add(a, b) { return a + b; }\n`;
    const completions = getCompletionsAtPosition("/test/comp.just.js", source, 2, 0);
    expect(completions.length).toBeGreaterThan(0);
    const names = completions.map((c) => c.label);
    expect(names).toContain("x");
    expect(names).toContain("add");
  });

  it("returns property completions for object after dot", () => {
    const source = `const obj = { x: 1, y: "hello" };\nobj.x;\n`;
    const completions = getCompletionsAtPosition("/test/dot.just.js", source, 2, 4);
    expect(completions.length).toBeGreaterThan(0);
    const names = completions.map((c) => c.label);
    expect(names).toContain("x");
    expect(names).toContain("y");
  });

  it("returns array method completions after dot", () => {
    const source = `const arr = [1, 2, 3];\narr.map;\n`;
    const completions = getCompletionsAtPosition("/test/arr.just.js", source, 2, 4);
    const names = completions.map((c) => c.label);
    expect(names).toContain("map");
    expect(names).toContain("filter");
    expect(names).toContain("reduce");
    expect(names).toContain("length");
  });
});
