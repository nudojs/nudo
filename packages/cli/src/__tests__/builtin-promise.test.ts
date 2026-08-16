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

  it("Promise.all([...]) should return Promise<[T1, T2]> (tuple)", () => {
    const results = runTest(`
// @nudo:case "all" ()
function fn() {
  return Promise.all([Promise.resolve(1), Promise.resolve(2)]);
}
`);
    expect(results[0].result).toBe("Promise<[1, 2]>");
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

  it("new Promise with resolve inside setTimeout callback should resolve via static site scan", () => {
    const results = runTest(`
// @nudo:case "ctor-async-site" ()
function fn() {
  return new Promise((resolve) => {
    setTimeout(() => resolve('x'), 1);
  });
}
`);
    expect(results[0].result).toBe('Promise<"x">');
  });

  it("new Promise with direct synchronous resolve should return Promise<42>", () => {
    const results = runTest(`
// @nudo:case "ctor-sync" ()
function fn() {
  return new Promise((resolve) => resolve(42));
}
`);
    expect(results[0].result).toBe("Promise<42>");
  });

  it("new Promise with never-resolving executor should return Promise<never>", () => {
    const results = runTest(`
// @nudo:case "ctor-never" ()
function fn() {
  return new Promise(() => {});
}
`);
    expect(results[0].result).toBe("Promise<never>");
  });

  it("new Promise with non-function executor should return Promise<unknown>", () => {
    const results = runTest(`
// @nudo:case "ctor-nonfn" ()
function fn(x) {
  return new Promise(x);
}
`);
    expect(results[0].result).toBe("Promise<unknown>");
  });

  it("new Promise should evaluate resolve argument in the executor closure scope", () => {
    const results = runTest(`
// @nudo:case "ctor-outer-value" (7)
function fn(returnValue) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(returnValue), 1);
  });
}
`);
    expect(results[0].result).toBe("Promise<7>");
  });

  it(".then(cb) end-to-end should propagate the callback's return type", () => {
    const results = runTest(`
// @nudo:case "then-chain" (7)
function fn(v) {
  return Promise.resolve(v).then(x => [x, x]);
}
`);
    expect(results[0].result).toBe("Promise<[7, 7]>");
  });

  it("new Promise result should chain through .then", () => {
    const results = runTest(`
// @nudo:case "ctor-then" ()
function fn() {
  return new Promise((resolve) => resolve('done')).then(x => x);
}
`);
    expect(results[0].result).toBe('Promise<"done">');
  });
});
