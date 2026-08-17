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

  it("Set.has() decides literally for recorded values", () => {
    const results = runTest(`
// @nudo:case "has-literal" ()
function fn() {
  const s = new Set(['a', 'b']);
  return [s.has('a'), s.has('z')];
}
`);
    expect(results[0].result).toBe("[true, false]");
  });

  it("Set.has() decides prototype singletons by identity", () => {
    const results = runTest(`
// @nudo:case "has-proto" ()
function fn() {
  const protoHack = new Set([Map.prototype, Set.prototype]);
  return protoHack.has(Object.prototype);
}
`);
    expect(results[0].result).toBe("false");
  });

  it("for-of on a Set instance iterates its recorded values", () => {
    const results = runTest(`
// @nudo:case "forof-values" ()
function fn() {
  const s = new Set([1, 2]);
  const out = [];
  for (const v of s) {
    out.push(v);
  }
  return out;
}
`);
    expect(results[0].result).toBe("[1, 2]");
  });

  it("Set.prototype.values.call(s) iterates like s.values()", () => {
    const results = runTest(`
// @nudo:case "proto-values-call" ()
function fn() {
  const s = new Set([1, 2]);
  const out = [];
  for (const v of Set.prototype.values.call(s)) {
    out.push(v);
  }
  return out;
}
`);
    expect(results[0].result).toBe("[1, 2]");
  });

  it("Set.delete() decides literally against recorded values and size stays number", () => {
    const results = runTest(`
// @nudo:case "delete-literal" ()
function fn() {
  const s = new Set([1, 2, 3]);
  const hit = s.delete(2);
  return [hit, s.size];
}
`);
    expect(results[0].result).toBe("[true, number]");
  });
});
