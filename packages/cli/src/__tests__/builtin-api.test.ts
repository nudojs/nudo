import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective, parseTypeValueExpr } from "@nudojs/parser";
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
      results.push({
        name: fn.name,
        caseName: dir.name,
        result: typeValueToString(result.value),
      });
    }
  }
  return results;
}

describe("Built-in API Tests", () => {
  it("Date.now() should return number", () => {
    const results = runTest(`
// @nudo:case "now" ()
function getTimestamp() {
  return Date.now();
}
`);
    console.log("Date.now() result:", results[0].result);
    expect(results[0].result).toBe("number");
  });

  it("Math.floor() should return number", () => {
    const results = runTest(`
// @nudo:case "floor" (3.7)
function floorIt(x) {
  return Math.floor(x);
}
`);
    console.log("Math.floor() result:", results[0].result);
    expect(results[0].result).toBe("number");
  });

  it("Math.random() should return number", () => {
    const results = runTest(`
// @nudo:case "random" ()
function getRandom() {
  return Math.random();
}
`);
    console.log("Math.random() result:", results[0].result);
    expect(results[0].result).toBe("number");
  });

  it("JSON.stringify() should return string", () => {
    const results = runTest(`
// @nudo:case "stringify" ({a: 1})
function toJson(obj) {
  return JSON.stringify(obj);
}
`);
    console.log("JSON.stringify() result:", results[0].result);
    expect(results[0].result).toBe("string");
  });

  it("Object.keys() should return string[]", () => {
    const results = runTest(`
// @nudo:case "keys" ({a: 1, b: 2})
function getKeys(obj) {
  return Object.keys(obj);
}
`);
    console.log("Object.keys() result:", results[0].result);
    // Object.keys returns actual keys from the object
    expect(results[0].result).toBe('["a", "b"]');
  });
});
