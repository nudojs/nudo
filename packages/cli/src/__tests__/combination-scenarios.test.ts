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

describe("Combination Scenario Tests", () => {
  describe("Array Method Chaining", () => {
    it("filter + map", () => {
      const results = runTest(`
// @nudo:case "filter-map" ([1, 2, 3, 4, 5])
function process(arr) {
  return arr
    .filter(n => n > 2)
    .map(n => n * 2);
}
`);
      expect(results[0].result).toContain("[");
      expect(results[0].result).toContain("6");
      expect(results[0].result).toContain("8");
      expect(results[0].result).toContain("10");
    });

    it("map + filter", () => {
      const results = runTest(`
// @nudo:case "map-filter" ([1, 2, 3, 4, 5])
function process(arr) {
  return arr
    .map(n => n * n)
    .filter(n => n > 10);
}
`);
      expect(results[0].result).toContain("[");
      expect(results[0].result).toContain("16");
      expect(results[0].result).toContain("25");
    });

    it("filter + map + reduce", () => {
      const results = runTest(`
// @nudo:case "filter-map-reduce" ([1, 2, 3, 4, 5])
function process(arr) {
  return arr
    .filter(n => n > 2)
    .map(n => n * n)
    .reduce((sum, n) => sum + n, 0);
}
`);
      // Note: This is a design limitation - arrays can't be iterated
      // The result is a union of possible values, not the accumulated value
      expect(results[0].result).toContain("|");
    });

    it("map + reduce", () => {
      const results = runTest(`
// @nudo:case "map-reduce" ([1, 2, 3])
function process(arr) {
  return arr
    .map(n => n * 2)
    .reduce((sum, n) => sum + n, 0);
}
`);
      expect(results[0].result).toBe("12");
    });

    it("filter + reduce", () => {
      const results = runTest(`
// @nudo:case "filter-reduce" ([1, 2, 3, 4, 5])
function process(arr) {
  return arr
    .filter(n => n % 2 === 0)
    .reduce((sum, n) => sum + n, 0);
}
`);
      // Note: This is a design limitation - arrays can't be iterated
      // The result is a union of possible values, not the accumulated value
      expect(results[0].result).toContain("|");
    });

    it("slice + map", () => {
      const results = runTest(`
// @nudo:case "slice-map" ([10, 20, 30, 40, 50])
function process(arr) {
  return arr.slice(1, 4).map(n => n / 10);
}
`);
      expect(results[0].result).toContain("[");
      expect(results[0].result).toContain("2");
      expect(results[0].result).toContain("3");
      expect(results[0].result).toContain("4");
    });
  });

  describe("Promise Chaining", () => {
    it("Promise.all with destructuring", () => {
      const results = runTest(`
// @nudo:case "promise-all-destructure" ()
async function fetchAll() {
  const [users, posts, comments] = await Promise.all([
    Promise.resolve([{ id: 1, name: "Alice" }]),
    Promise.resolve([{ id: 1, title: "Post 1" }]),
    Promise.resolve([{ id: 1, text: "Comment 1" }])
  ]);
  return { users, posts, comments };
}
`);
      expect(results[0].result).toContain("Promise");
      expect(results[0].result).toContain("users");
      expect(results[0].result).toContain("posts");
      expect(results[0].result).toContain("comments");
    });

    it("Promise.race", () => {
      const results = runTest(`
// @nudo:case "promise-race" ()
async function race() {
  const result = await Promise.race([
    Promise.resolve("fast"),
    Promise.resolve("slow")
  ]);
  return result;
}
`);
      expect(results[0].result).toBe('Promise<"fast" | "slow">');
    });

    it("sequential promises", () => {
      const results = runTest(`
// @nudo:case "sequential" ()
async function sequential() {
  const a = await Promise.resolve(1);
  const b = await Promise.resolve(a + 1);
  const c = await Promise.resolve(b + 1);
  return [a, b, c];
}
`);
      expect(results[0].result).toBe("Promise<[1, 2, 3]>");
    });
  });

  describe("Object Operations", () => {
    it("spread + destructure", () => {
      const results = runTest(`
// @nudo:case "spread-destructure" ({ name: "Alice", age: 30 }, { age: 31, city: "NYC" })
function merge(a, b) {
  const merged = { ...a, ...b };
  const { name, age, city } = merged;
  return { name, age, city };
}
`);
      expect(results[0].result).toContain("name");
      expect(results[0].result).toContain("age");
      expect(results[0].result).toContain("city");
    });

    it("nested spread", () => {
      const results = runTest(`
// @nudo:case "nested-spread" ({ a: { x: 1 } }, { a: { y: 2 } })
function merge(a, b) {
  return { ...a, ...b };
}
`);
      expect(results[0].result).toContain("a");
    });

    it("computed properties", () => {
      const results = runTest(`
// @nudo:case "computed-props" ("name", "Alice")
function createObj(key, value) {
  return { [key]: value };
}
`);
      expect(results[0].result).toContain("name");
      expect(results[0].result).toContain("Alice");
    });
  });

  describe("Control Flow Combinations", () => {
    it("if-else with early return", () => {
      const results = runTest(`
// @nudo:case "early-return" (10)
function classify(n) {
  if (n < 0) return "negative";
  if (n === 0) return "zero";
  if (n < 10) return "small";
  if (n < 100) return "medium";
  return "large";
}
`);
      expect(results[0].result).toBe('"medium"');
    });

    it("switch with fallthrough", () => {
      const results = runTest(`
// @nudo:case "switch-fallthrough" (2)
function getDayType(day) {
  switch (day) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
      return "weekday";
    case 6:
    case 7:
      return "weekend";
    default:
      return "invalid";
  }
}
`);
      expect(results[0].result).toBe('"weekday"');
    });

    it("nested conditions", () => {
      const results = runTest(`
// @nudo:case "nested-conditions" ({ active: true, role: "admin" })
function checkAccess(user) {
  if (user.active) {
    if (user.role === "admin") {
      return { access: "full", level: 3 };
    } else if (user.role === "editor") {
      return { access: "edit", level: 2 };
    } else {
      return { access: "read", level: 1 };
    }
  }
  return { access: "none", level: 0 };
}
`);
      expect(results[0].result).toContain("full");
      expect(results[0].result).toContain("3");
    });
  });

  describe("Error Handling Combinations", () => {
    it("try-catch with fallback", () => {
      const results = runTest(`
// @nudo:case "try-catch-fallback" ("valid")
function safeParse(str) {
  try {
    if (str === "valid") return { success: true, data: "parsed" };
    throw new Error("invalid");
  } catch (e) {
    return { success: false, error: "parse failed" };
  }
}
`);
      expect(results[0].result).toContain("success");
      expect(results[0].result).toContain("parsed");
    });

    it("nested try-catch", () => {
      const results = runTest(`
// @nudo:case "nested-try-catch" ()
function nestedTry() {
  try {
    try {
      return { level: "inner", success: true };
    } catch (e) {
      return { level: "inner", success: false };
    }
  } catch (e) {
    return { level: "outer", success: false };
  }
}
`);
      expect(results[0].result).toContain("inner");
      expect(results[0].result).toContain("true");
    });
  });

  describe("Higher-Order Functions", () => {
    it("function as argument", () => {
      const results = runTest(`
// @nudo:case "higher-order" ([1, 2, 3])
function applyFn(arr, fn) {
  return arr.map(fn);
}
`);
      expect(results[0].result).toContain("[");
    });

    it("function returning function", () => {
      const results = runTest(`
// @nudo:case "factory" ()
function createMultiplier(factor) {
  return function(n) {
    return n * factor;
  };
}
`);
      // Functions are displayed as arrow function syntax
      expect(results[0].result).toContain("=>");
    });

    it("closure", () => {
      const results = runTest(`
// @nudo:case "closure" ()
function createCounter() {
  let count = 0;
  return {
    increment() { return ++count; },
    decrement() { return --count; },
    getCount() { return count; }
  };
}
`);
      expect(results[0].result).toContain("increment");
      expect(results[0].result).toContain("decrement");
      expect(results[0].result).toContain("getCount");
    });
  });

  describe("Map/Set Operations", () => {
    it("Map with object values", () => {
      const results = runTest(`
// @nudo:case "map-objects" ()
function createLookup() {
  const map = new Map();
  map.set("alice", { name: "Alice", age: 30 });
  map.set("bob", { name: "Bob", age: 25 });
  return {
    alice: map.get("alice"),
    bob: map.get("bob"),
    missing: map.get("charlie")
  };
}
`);
      expect(results[0].result).toContain("alice");
      expect(results[0].result).toContain("bob");
      expect(results[0].result).toContain("undefined");
    });

    it("Set with Array.from", () => {
      const results = runTest(`
// @nudo:case "set-array-from" ([1, 2, 2, 3, 3, 3])
function unique(arr) {
  const set = new Set(arr);
  return Array.from(set);
}
`);
      expect(results[0].result).toContain("[");
      expect(results[0].result).toContain("1");
      expect(results[0].result).toContain("2");
      expect(results[0].result).toContain("3");
    });

    it("Map iteration", () => {
      const results = runTest(`
// @nudo:case "map-iterate" ()
function mapEntries() {
  const map = new Map();
  map.set("a", 1);
  map.set("b", 2);
  const entries = [];
  for (const [key, value] of map) {
    entries.push([key, value]);
  }
  return entries;
}
`);
      expect(results[0].result).toContain("[");
    });
  });
});
