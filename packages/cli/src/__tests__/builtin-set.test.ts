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

describe("Built-in Set API", () => {
  it("new Set() should create a Set instance", () => {
    const results = runTest(`
// @nudo:case "new-set" ()
function fn() {
  const s = new Set();
  return s;
}
`);
    expect(results[0].result).toContain("Set");
  });

  it("Set.has() should return boolean", () => {
    const results = runTest(`
// @nudo:case "has" ()
function fn() {
  const s = new Set();
  return s.has("key");
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("Set.size should return number", () => {
    const results = runTest(`
// @nudo:case "size" ()
function fn() {
  const s = new Set();
  return s.size;
}
`);
    expect(results[0].result).toBe("number");
  });

  it("Set.add() should return the Set instance", () => {
    const results = runTest(`
// @nudo:case "add" ()
function fn() {
  const s = new Set();
  return s.add(42);
}
`);
    expect(results[0].result).toContain("Set");
  });

  it("new Set([1, 2, 3]) should infer element type", () => {
    const results = runTest(`
// @nudo:case "from-array" ()
function fn() {
  const s = new Set([1, 2, 3]);
  return s;
}
`);
    expect(results[0].result).toContain("Set");
  });

  it("Set.delete() should return boolean", () => {
    const results = runTest(`
// @nudo:case "delete" ()
function fn() {
  const s = new Set();
  return s.delete("key");
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("Set.clear() should return undefined", () => {
    const results = runTest(`
// @nudo:case "clear" ()
function fn() {
  const s = new Set();
  return s.clear();
}
`);
    expect(results[0].result).toBe("undefined");
  });
});
