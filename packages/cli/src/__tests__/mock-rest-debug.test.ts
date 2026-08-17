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

describe("Rest Parameter Debug", () => {
  it("rest param: collect args into tuple", () => {
    const results = inferWithMocks(`
// @nudo:mock sum = (...args) => args.length
// @nudo:case "three" (1, 2, 3)
function countArgs() {
  return sum(1, 2, 3);
}
`);
    console.log("Rest param result:", results[0].result);
    expect(results[0].result).toBe("3");
  });

  it("rest param: spread array", () => {
    const results = inferWithMocks(`
// @nudo:mock sum = (...args) => args.length
// @nudo:case "arr" ([1, 2, 3])
function countFromArr(arr) {
  return sum(...arr);
}
`);
    console.log("Spread array result:", results[0].result);
    expect(results[0].result).toBe("3");
  });

  it("rest param: access elements", () => {
    const results = inferWithMocks(`
// @nudo:mock getFirst = (...args) => args[0]
// @nudo:case "nums" (10, 20, 30)
function first() {
  return getFirst(10, 20, 30);
}
`);
    console.log("First element result:", results[0].result);
    expect(results[0].result).toBe("10");
  });

  it("rest param: sum values", () => {
    const results = inferWithMocks(`
// @nudo:mock add = (...args) => args[0] + args[1] + args[2]
// @nudo:case "nums" (1, 2, 3)
function addThree() {
  return add(1, 2, 3);
}
`);
    console.log("Sum result:", results[0].result);
    expect(results[0].result).toBe("6");
  });

  it("named + rest params", () => {
    const results = inferWithMocks(`
// @nudo:mock log = (first, ...rest) => rest.length
// @nudo:case "args" ("a", "b", "c", "d")
function logCount() {
  return log("a", "b", "c", "d");
}
`);
    console.log("Named + rest result:", results[0].result);
    expect(results[0].result).toBe("3");
  });

  it("rest param with reduce", () => {
    const results = inferWithMocks(`
// @nudo:mock sum = (...args) => args.reduce((a, b) => a + b, 0)
// @nudo:case "nums" (1, 2, 3)
function total() {
  return sum(1, 2, 3);
}
`);
    console.log("Reduce result:", results[0].result);
    expect(results[0].result).toBe("6");
  });
});
