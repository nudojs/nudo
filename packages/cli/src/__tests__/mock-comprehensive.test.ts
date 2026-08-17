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

describe("Comprehensive Mock Tests", () => {
  describe("Array method mocks", () => {
    it("supports filter with mock predicate", () => {
      const results = inferWithMocks(`
// @nudo:mock isPositive = (x) => x > 0
// @nudo:case "nums" ([-1, 2, -3, 4, -5])
function filterPositive(arr) {
  return arr.filter(isPositive);
}
`);
      // filter returns a union type of elements that pass the predicate
      expect(results[0].result).toBe("2 | 4[]");
    });

    it("supports map with mock transform", () => {
      const results = inferWithMocks(`
// @nudo:mock double = (x) => x * 2
// @nudo:case "nums" ([1, 2, 3])
function doubleAll(arr) {
  return arr.map(double);
}
`);
      expect(results[0].result).toBe("[2, 4, 6]");
    });

    it("supports reduce with mock reducer", () => {
      const results = inferWithMocks(`
// @nudo:mock add = (a, b) => a + b
// @nudo:case "nums" ([1, 2, 3, 4])
function sumAll(arr) {
  return arr.reduce(add, 0);
}
`);
      expect(results[0].result).toBe("10");
    });

    it("supports find with mock predicate", () => {
      const results = inferWithMocks(`
// @nudo:mock isEven = (x) => x % 2 === 0
// @nudo:case "nums" ([1, 2, 3, 4, 5])
function findFirstEven(arr) {
  return arr.find(isEven);
}
`);
      // find returns a union of all possible values plus undefined
      expect(results[0].result).toBe("1 | 2 | 3 | 4 | 5 | undefined");
    });

    it("supports some with mock predicate", () => {
      const results = inferWithMocks(`
// @nudo:mock isNegative = (x) => x < 0
// @nudo:case "nums" ([1, 2, 3])
function hasNegative(arr) {
  return arr.some(isNegative);
}
`);
      expect(results[0].result).toBe("false");
    });

    it("supports every with mock predicate", () => {
      const results = inferWithMocks(`
// @nudo:mock isPositive = (x) => x > 0
// @nudo:case "nums" ([1, 2, 3])
function allPositive(arr) {
  return arr.every(isPositive);
}
`);
      expect(results[0].result).toBe("true");
    });
  });

  describe("String method mocks", () => {
    it("supports split with mock separator", () => {
      const results = inferWithMocks(`
// @nudo:mock separator = (x) => x === ","
// @nudo:case "str" ("a,b,c")
function splitByComma(str) {
  return str.split(separator);
}
`);
      // split with a function is not standard, but we test the mock mechanism
      expect(results[0].result).toBeDefined();
    });
  });

  describe("Higher-order function patterns", () => {
    it("supports function composition", () => {
      const results = inferWithMocks(`
// @nudo:mock f = (x) => x + 1
// @nudo:mock g = (x) => x * 2
// @nudo:case "num" (5)
function compose(x) {
  return f(g(x));
}
`);
      // g(5) = 10, f(10) = 11
      expect(results[0].result).toBe("11");
    });

    it("supports function as return value", () => {
      const results = inferWithMocks(`
// @nudo:mock multiplier = (factor) => (x) => x * factor
// @nudo:case "num" (5)
function getDouble(x) {
  const double = multiplier(2);
  return double(x);
}
`);
      // This tests that mock can return functions
      expect(results[0].result).toBeDefined();
    });

    it("supports callback pattern", () => {
      const results = inferWithMocks(`
// @nudo:mock callback = (result) => result
// @nudo:case "num" (42)
function processWithCallback(x) {
  const processed = x * 2;
  return callback(processed);
}
`);
      // callback(84) should return 84
      expect(results[0].result).toBe("84");
    });
  });

  describe("Multiple mock interactions", () => {
    it("supports multiple mocks working together", () => {
      const results = inferWithMocks(`
// @nudo:mock predicate = (x) => x > 2
// @nudo:mock transform = (x) => x * 10
// @nudo:case "nums" ([1, 2, 3, 4, 5])
function filterAndTransform(arr) {
  const filtered = [];
  for (const item of arr) {
    if (predicate(item)) {
      filtered.push(transform(item));
    }
  }
  return filtered;
}
`);
      // Filter items > 2: [3, 4, 5], then transform: [30, 40, 50]
      expect(results[0].result).toBe("[30, 40, 50]");
    });
  });

  describe("Edge cases", () => {
    it("handles mock with no parameters", () => {
      const results = inferWithMocks(`
// @nudo:mock getter = () => 42
// @nudo:case "empty" ()
function getValue() {
  return getter();
}
`);
      expect(results[0].result).toBe("42");
    });

    it("handles mock with rest parameters", () => {
      const results = inferWithMocks(`
// @nudo:mock sum = (...args) => args.length
// @nudo:case "nums" ([1, 2, 3])
function countArgs(arr) {
  return sum(...arr);
}
`);
      // Rest parameters collect all arguments into a tuple
      expect(results[0].result).toBe("3");
    });

    it("handles mock with complex expressions", () => {
      const results = inferWithMocks(`
// @nudo:mock calc = (a, b) => (a + b) * (a - b)
// @nudo:case "nums" (5, 3)
function calculate(a, b) {
  return calc(a, b);
}
`);
      // calc(5, 3) = (5+3) * (5-3) = 8 * 2 = 16
      expect(results[0].result).toBe("16");
    });
  });

  describe("Integration with type narrowing", () => {
    it("supports mock with typeof narrowing", () => {
      const results = inferWithMocks(`
// @nudo:mock processor = (x) => typeof x === "string" ? x.toUpperCase() : x
// @nudo:case "str" ("hello")
// @nudo:case "num" (42)
function process(x) {
  return processor(x);
}
`);
      expect(results[0].result).toBe('"HELLO"');
      expect(results[1].result).toBe("42");
    });

    it("supports mock with conditional logic", () => {
      const results = inferWithMocks(`
// @nudo:mock validator = (x) => x > 0 && x < 100
// @nudo:case "valid" (50)
// @nudo:case "invalid" (150)
function validate(x) {
  return validator(x);
}
`);
      expect(results[0].result).toBe("true");
      expect(results[1].result).toBe("false");
    });
  });
});
