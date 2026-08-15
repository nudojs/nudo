import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runTest(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];

  for (const fn of directives) {
    const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
    for (const dir of caseDirectives) {
      const result = evaluateFunctionFull(fn.node, dir.args, env);
      results.push({ name: fn.name, caseName: dir.name, result: typeValueToString(result.value) });
    }
  }
  return results;
}

describe("Built-in Map API", () => {
  it("new Map() should create a Map instance", () => {
    const results = runTest(`
// @nudo:case "new-map" ()
function fn() {
  const m = new Map();
  return m;
}
`);
    expect(results[0].result).toContain("Map");
  });

  it("Map.get() should return V | undefined (unknown when V is unknown)", () => {
    const results = runTest(`
// @nudo:case "get" ()
function fn() {
  const m = new Map();
  return m.get("key");
}
`);
    // When V is unknown, unknown | undefined simplifies to unknown
    expect(results[0].result).toBe("unknown");
  });

  it("Map.has() should return boolean", () => {
    const results = runTest(`
// @nudo:case "has" ()
function fn() {
  const m = new Map();
  return m.has("key");
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("Map.size should return number", () => {
    const results = runTest(`
// @nudo:case "size" ()
function fn() {
  const m = new Map();
  return m.size;
}
`);
    expect(results[0].result).toBe("number");
  });

  it("arrow function case argument works as Array.map callback", () => {
    const results = runTest(`
// @nudo:case "double" ([1, 2, 3], (a) => a * 2)
function doubleAll(items, cb) {
  return items.map(cb);
}
`);
    expect(results[0].result).toBe("[2, 4, 6]");
  });
});
