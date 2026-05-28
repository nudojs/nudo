import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
import { typeValueToString, createEnvironment } from "@nudojs/core";
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

describe("Syntax Sugar Tests", () => {
  describe("Compound Assignment Operators", () => {
    it("+=", () => {
      const results = runTest(`
// @nudo:case "add-assign" ([1, 2, 3, 4, 5])
function sum(arr) {
  let total = 0;
  for (const n of arr) {
    total += n;
  }
  return total;
}
`);
      expect(results[0].result).toBe("15");
    });

    it("-=", () => {
      const results = runTest(`
// @nudo:case "sub-assign" (100, [10, 20, 30])
function subtract(initial, values) {
  let result = initial;
  for (const v of values) {
    result -= v;
  }
  return result;
}
`);
      expect(results[0].result).toBe("40");
    });

    it("*=", () => {
      const results = runTest(`
// @nudo:case "mul-assign" ([2, 3, 4])
function product(arr) {
  let result = 1;
  for (const n of arr) {
    result *= n;
  }
  return result;
}
`);
      expect(results[0].result).toBe("24");
    });

    it("/=", () => {
      const results = runTest(`
// @nudo:case "div-assign" (1000, [2, 5])
function divide(initial, divisors) {
  let result = initial;
  for (const d of divisors) {
    result /= d;
  }
  return result;
}
`);
      expect(results[0].result).toBe("100");
    });

    it("%=", () => {
      const results = runTest(`
// @nudo:case "mod-assign" (17, [5, 3])
function modChain(initial, divisors) {
  let result = initial;
  for (const d of divisors) {
    result %= d;
  }
  return result;
}
`);
      expect(results[0].result).toBe("2");
    });

    it("string +=", () => {
      const results = runTest(`
// @nudo:case "concat-assign" (["Hello", " ", "World"])
function concat(parts) {
  let result = "";
  for (const part of parts) {
    result += part;
  }
  return result;
}
`);
      expect(results[0].result).toBe('"Hello World"');
    });
  });

  describe("Object Method Shorthand", () => {
    it("basic method shorthand", () => {
      const results = runTest(`
// @nudo:case "method" ()
function createObj() {
  return {
    greet(name) {
      return "Hello, " + name;
    }
  };
}
`);
      expect(results[0].result).toContain("greet");
    });

    it("multiple methods", () => {
      const results = runTest(`
// @nudo:case "methods" ()
function createCalculator() {
  return {
    add(a, b) { return a + b; },
    subtract(a, b) { return a - b; },
    multiply(a, b) { return a * b; }
  };
}
`);
      expect(results[0].result).toContain("add");
      expect(results[0].result).toContain("subtract");
      expect(results[0].result).toContain("multiply");
    });

    it("method with rest parameters", () => {
      const results = runTest(`
// @nudo:case "rest-params" ()
function createLogger() {
  return {
    log(...args) {
      return args;
    }
  };
}
`);
      expect(results[0].result).toContain("log");
    });

    it("mixed properties and methods", () => {
      const results = runTest(`
// @nudo:case "mixed" ()
function createService() {
  return {
    name: "MyService",
    version: 1,
    start() { return "started"; },
    stop() { return "stopped"; }
  };
}
`);
      expect(results[0].result).toContain("name");
      expect(results[0].result).toContain("version");
      expect(results[0].result).toContain("start");
      expect(results[0].result).toContain("stop");
    });
  });

  describe("Async/Await Combinations", () => {
    it("async function returning literal", () => {
      const results = runTest(`
// @nudo:case "async-literal" ()
async function getValue() {
  return 42;
}
`);
      expect(results[0].result).toBe("Promise<42>");
    });

    it("async function returning Promise", () => {
      const results = runTest(`
// @nudo:case "async-promise" ()
async function getValue() {
  return Promise.resolve(42);
}
`);
      expect(results[0].result).toBe("Promise<42>");
    });

    it("async function with await", () => {
      const results = runTest(`
// @nudo:case "async-await" ()
async function getValue() {
  const result = await Promise.resolve(42);
  return result;
}
`);
      expect(results[0].result).toBe("Promise<42>");
    });

    it("async function with try/catch", () => {
      const results = runTest(`
// @nudo:case "async-try-catch" ()
async function safeOperation() {
  try {
    const result = await Promise.resolve("success");
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: "failed" };
  }
}
`);
      expect(results[0].result).toContain("Promise");
      expect(results[0].result).toContain("success");
    });

    it("async function with multiple awaits", () => {
      const results = runTest(`
// @nudo:case "async-multi-await" ()
async function fetchAll() {
  const a = await Promise.resolve(1);
  const b = await Promise.resolve(2);
  return [a, b];
}
`);
      expect(results[0].result).toBe("Promise<[1, 2]>");
    });
  });

  describe("Destructuring Patterns", () => {
    it("object destructuring in parameters", () => {
      const results = runTest(`
// @nudo:case "destructure-obj" ({ name: "Alice", age: 30 })
function greet({ name, age }) {
  return name + " is " + age;
}
`);
      expect(results[0].result).toBe('"Alice is 30"');
    });

    it("array destructuring in parameters", () => {
      const results = runTest(`
// @nudo:case "destructure-arr" ([1, 2, 3])
function sum([a, b, c]) {
  return a + b + c;
}
`);
      expect(results[0].result).toBe("6");
    });

    it("nested destructuring", () => {
      const results = runTest(`
// @nudo:case "destructure-nested" ({ user: { name: "Alice", address: { city: "NYC" } } })
function getCity({ user: { address: { city } } }) {
  return city;
}
`);
      expect(results[0].result).toBe('"NYC"');
    });

    it("destructuring with defaults", () => {
      const results = runTest(`
// @nudo:case "destructure-default" ({ name: "Alice" })
function greet({ name, greeting = "Hello" }) {
  return greeting + ", " + name;
}
`);
      expect(results[0].result).toBe('"Hello, Alice"');
    });
  });

  describe("Template Literals", () => {
    it("basic template literal", () => {
      const results = runTest(`
// @nudo:case "template" ("World")
function greet(name) {
  return \`Hello, \${name}!\`;
}
`);
      expect(results[0].result).toBe('"Hello, World!"');
    });

    it("template literal with expressions", () => {
      const results = runTest(`
// @nudo:case "template-expr" (2, 3)
function calculate(a, b) {
  return \`\${a} + \${b} = \${a + b}\`;
}
`);
      expect(results[0].result).toBe('"2 + 3 = 5"');
    });
  });

  describe("Optional Chaining", () => {
    it("basic optional chaining", () => {
      const results = runTest(`
// @nudo:case "optional-chain" ({ user: { name: "Alice" } })
function getName(obj) {
  return obj?.user?.name;
}
`);
      expect(results[0].result).toBe('"Alice"');
    });

    it("optional chaining with undefined", () => {
      const results = runTest(`
// @nudo:case "optional-undefined" ({})
function getName(obj) {
  return obj?.user?.name;
}
`);
      expect(results[0].result).toBe("undefined");
    });
  });

  describe("Nullish Coalescing", () => {
    it("basic nullish coalescing", () => {
      const results = runTest(`
// @nudo:case "nullish" (null)
function getValue(x) {
  return x ?? "default";
}
`);
      expect(results[0].result).toBe('"default"');
    });

    it("nullish with defined value", () => {
      const results = runTest(`
// @nudo:case "nullish-defined" ("hello")
function getValue(x) {
  return x ?? "default";
}
`);
      expect(results[0].result).toBe('"hello"');
    });
  });
});
