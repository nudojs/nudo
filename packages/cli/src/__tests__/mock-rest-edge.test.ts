import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective, parseTypeValueExpr } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function inferWithMocks(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];

  for (const fn of directives) {
    for (const d of fn.directives) {
      if (d.kind === "mock") {
        if (d.arrowFn) {
          const fnType = T.fn(d.arrowFn.params, d.arrowFn.body, env);
          (fnType as any)._paramPatterns = d.arrowFn.paramPatterns;
          env.bind(d.name, fnType);
        } else if (d.expression) {
          env.bind(d.name, parseTypeValueExpr(d.expression));
        }
      }
    }

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

describe("Rest Parameter Edge Cases", () => {
  it("rest param: no args passed", () => {
    const results = inferWithMocks(`
// @nudo:mock count = (...args) => args.length
// @nudo:case "empty" ()
function noArgs() {
  return count();
}
`);
    console.log("No args result:", results[0].result);
    expect(results[0].result).toBe("0");
  });

  it("rest param: single arg", () => {
    const results = inferWithMocks(`
// @nudo:mock first = (...args) => args[0]
// @nudo:case "one" (42)
function oneArg() {
  return first(42);
}
`);
    console.log("Single arg result:", results[0].result);
    expect(results[0].result).toBe("42");
  });

  it("rest param: spread with mock inside higher-order fn", () => {
    const results = inferWithMocks(`
// @nudo:mock fn = (x) => x * 2
// @nudo:case "nums" ([1, 2, 3])
function applyAll(arr) {
  return arr.map(fn);
}
`);
    console.log("Map result:", results[0].result);
    expect(results[0].result).toBe("[2, 4, 6]");
  });

  it("rest param: destructure from tuple", () => {
    const results = inferWithMocks(`
// @nudo:mock swap = ([a, b]) => [b, a]
// @nudo:case "pair" ([1, 2])
function swapPair(pair) {
  return swap(pair);
}
`);
    console.log("Destructure result:", results[0].result);
    expect(results[0].result).toBe("[2, 1]");
  });

  it("rest param: nested arrow functions", () => {
    const results = inferWithMocks(`
// @nudo:mock curry = (a) => (b) => a + b
// @nudo:case "num" (5)
function curried(x) {
  const add5 = curry(x);
  return add5(10);
}
`);
    console.log("Curry result:", results[0].result);
    expect(results[0].result).toBe("15");
  });

  it("rest param: mock returning object", () => {
    const results = inferWithMocks(`
// @nudo:mock make = (x) => ({ value: x, doubled: x * 2 })
// @nudo:case "num" (5)
function makeObj(x) {
  return make(x);
}
`);
    console.log("Object result:", results[0].result);
    expect(results[0].result).toBe('{ value: 5, doubled: 10 }');
  });

  it("rest param: conditional return (abstract interpretation)", () => {
    const results = inferWithMocks(`
// @nudo:mock safe = (x) => x > 0 ? x : 0
// @nudo:case "pos" (5)
// @nudo:case "neg" (-3)
function safeValue(x) {
  return safe(x);
}
`);
    console.log("Conditional results:", results.map(r => r.result));
    // Abstract interpretation: x > 0 narrows x to number (>= 1)
    expect(results[0].result).toBe("number (>= 1)");
    expect(results[1].result).toBe("0");
  });

  it("rest param: multiple rest params in chain", () => {
    const results = inferWithMocks(`
// @nudo:mock collect = (...args) => args
// @nudo:mock process = (arr) => arr.length
// @nudo:case "nums" (1, 2, 3, 4)
function chain() {
  const collected = collect(1, 2, 3, 4);
  return process(collected);
}
`);
    console.log("Chain result:", results[0].result);
    expect(results[0].result).toBe("4");
  });

  it("destructure: object pattern", () => {
    const results = inferWithMocks(`
// @nudo:mock getFullName = ({first, last}) => first + " " + last
// @nudo:case "name" ({first: "John", last: "Doe"})
function fullName(obj) {
  return getFullName(obj);
}
`);
    console.log("Object destructure result:", results[0].result);
    expect(results[0].result).toBe('"John Doe"');
  });

  it("destructure: nested array", () => {
    const results = inferWithMocks(`
// @nudo:mock sum = ([a, b]) => a + b
// @nudo:case "pair" ([3, 7])
function sumPair(pair) {
  return sum(pair);
}
`);
    console.log("Nested array result:", results[0].result);
    expect(results[0].result).toBe("10");
  });

  it("destructure: mixed params", () => {
    const results = inferWithMocks(`
// @nudo:mock process = (x, [a, b]) => x + a + b
// @nudo:case "mixed" (1, [2, 3])
function processMixed(x, pair) {
  return process(x, pair);
}
`);
    console.log("Mixed params result:", results[0].result);
    expect(results[0].result).toBe("6");
  });
});
