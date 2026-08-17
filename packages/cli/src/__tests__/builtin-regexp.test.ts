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

describe("Built-in RegExp API", () => {
  it("RegExp literal should create a RegExp instance", () => {
    const results = runTest(`
// @nudo:case "regexp-literal" ()
function fn() {
  const re = /abc/gi;
  return re;
}
`);
    expect(results[0].result).toContain("RegExp");
  });

  it("new RegExp() should create a RegExp instance", () => {
    const results = runTest(`
// @nudo:case "new-regexp" ()
function fn() {
  const re = new RegExp("abc");
  return re;
}
`);
    expect(results[0].result).toContain("RegExp");
  });

  it("RegExp.test() should return boolean", () => {
    const results = runTest(`
// @nudo:case "test" ()
function fn() {
  const re = /abc/;
  return re.test("abcdef");
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("RegExp.source should return string", () => {
    const results = runTest(`
// @nudo:case "source" ()
function fn() {
  const re = /abc/gi;
  return re.source;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("RegExp.flags should return string", () => {
    const results = runTest(`
// @nudo:case "flags" ()
function fn() {
  const re = /abc/gi;
  return re.flags;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("RegExp.global should return boolean", () => {
    const results = runTest(`
// @nudo:case "global" ()
function fn() {
  const re = /abc/g;
  return re.global;
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("RegExp.ignoreCase should return boolean", () => {
    const results = runTest(`
// @nudo:case "ignoreCase" ()
function fn() {
  const re = /abc/i;
  return re.ignoreCase;
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("RegExp.multiline should return boolean", () => {
    const results = runTest(`
// @nudo:case "multiline" ()
function fn() {
  const re = /abc/m;
  return re.multiline;
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("RegExp.exec() should return union of null and object", () => {
    const results = runTest(`
// @nudo:case "exec" ()
function fn() {
  const re = /abc/;
  return re.exec("abcdef");
}
`);
    expect(results[0].result).toContain("null");
    expect(results[0].result).toContain("{}");
  });

  it("RegExp.toString() should return string", () => {
    const results = runTest(`
// @nudo:case "toString" ()
function fn() {
  const re = /abc/gi;
  return re.toString();
}
`);
    expect(results[0].result).toBe("string");
  });
});
