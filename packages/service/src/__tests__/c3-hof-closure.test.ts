import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { formatAbs, analyzeFn } from "@nudojs/core";

describe("C3.1 named HOF callbacks", () => {
  it("processItems with local named fns does not collapse to unknown", () => {
    const src = `
function double(x) { return x * 2; }
function isPositive(x) { return x > 0; }
function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}
processItems([1, 2, 3], double, isPositive);
`;
    const r = analyzeFile("/tmp/hof-named.js", src);
    const fn = r.functions.find((f) => f.name === "processItems");
    expect(fn).toBeDefined();
    const call = fn!.cases.find((c) => c.name.startsWith("call@"));
    expect(call).toBeDefined();
    expect(formatAbs(call!.abs)).not.toMatch(/^unknown/);
    expect(call!.argAbs[1]?.shape.k).not.toBe("unknown");
  });
});

describe("C3.2 closure object methods", () => {
  it("returned object has method slots", () => {
    const src = `
function createCounter() {
  let count = 0;
  return {
    increment() { count = count + 1; return count; },
    getCount() { return count; }
  };
}
createCounter();
`;
    const r = analyzeFile("/tmp/counter-c3.js", src);
    const fn = r.functions.find((f) => f.name === "createCounter");
    expect(fn).toBeDefined();
    const call = fn!.cases.find((c) => c.name.startsWith("call@"));
    const display = formatAbs(call!.abs);
    expect(display).toContain("increment");
    expect(display).toContain("getCount");
  });

  it("ast-eval ObjectMethod yields fn Abs", () => {
    const r = analyzeFn(
      `function f() { return { m() { return 1; } }; }`,
      "f",
      [],
    );
    expect(formatAbs(r)).toContain("m");
  });
});
