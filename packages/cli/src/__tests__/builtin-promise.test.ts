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
      results.push({
        name: fn.name,
        caseName: dir.name,
        result: typeValueToString(result.value),
      });
    }
  }
  return results;
}

describe("Built-in Promise API", () => {
  it("Promise.resolve(v) should return Promise<T>", () => {
    const results = runTest(`
// @nudo:case "resolve" (42)
function fn(x) {
  return Promise.resolve(x);
}
`);
    expect(results[0].result).toBe("Promise<42>");
  });

  it("Promise.reject(v) should return Promise<never>", () => {
    const results = runTest(`
// @nudo:case "reject" ()
function fn() {
  return Promise.reject(new Error("fail"));
}
`);
    expect(results[0].result).toBe("Promise<never>");
  });

  it("Promise.all([...]) should return Promise<T[]>", () => {
    const results = runTest(`
// @nudo:case "all" ()
function fn() {
  return Promise.all([Promise.resolve(1), Promise.resolve(2)]);
}
`);
    expect(results[0].result).toContain("Promise");
    expect(results[0].result).toContain("[]");
  });

  it("Promise.race([...]) should return Promise<T>", () => {
    const results = runTest(`
// @nudo:case "race" ()
function fn() {
  return Promise.race([Promise.resolve("a"), Promise.resolve("b")]);
}
`);
    expect(results[0].result).toContain("Promise");
  });

  it(".then() should return Promise<T>", () => {
    const results = runTest(`
// @nudo:case "then" ()
function fn() {
  return Promise.resolve(42).then(x => x);
}
`);
    expect(results[0].result).toContain("Promise");
  });
});
