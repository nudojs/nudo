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
    // Apply mocks first
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

describe("Mock Arrow Functions", () => {
  it("supports arrow function mock with direct call", () => {
    const results = inferWithMocks(`
// @nudo:mock fn = (x) => x > 3
// @nudo:case "num" (5)
function test(x) {
  return fn(x);
}
`);
    // fn(5) should return true since 5 > 3
    expect(results[0].result).toBe("true");
  });

  it("supports arrow function mock for filter", () => {
    const results = inferWithMocks(`
// @nudo:mock fn = (x) => x > 3
// @nudo:case "nums" ([1, 2, 3, 4, 5])
function filter(arr) {
  const result = [];
  for (const item of arr) {
    if (fn(item)) result.push(item);
  }
  return result;
}
`);
    // Should filter to [4, 5]
    expect(results[0].result).toBe("[4, 5]");
  });

  it("supports arrow function mock with multiple params", () => {
    const results = inferWithMocks(`
// @nudo:mock fn = (a, b) => a + b
// @nudo:case "nums" ([1, 2, 3])
function sum(arr) {
  return arr.reduce(fn, 0);
}
`);
    // reduce with (a, b) => a + b and [1, 2, 3] should give 6
    expect(results[0].result).toBe("6");
  });

  it("supports arrow function mock with string operations", () => {
    const results = inferWithMocks(`
// @nudo:mock fn = (x) => x.toUpperCase()
// @nudo:case "str" ("hello")
function transform(x) {
  return fn(x);
}
`);
    // fn("hello") should return "HELLO"
    expect(results[0].result).toBe('"HELLO"');
  });
});
