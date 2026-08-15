import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { T, typeValueToString } from "@nudojs/core";
import { analyzeFile, getTypeAtPosition, getCompletionsAtPosition } from "../analyzer.ts";

const FIXTURE_PATH = resolve(import.meta.dirname, "fixtures", "sample.js");

const SAMPLE_SOURCE = `
/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function add(a, b) {
  return a + b;
}

/**
 * @nudo:case "test" ({ name: "Alice", age: 30 })
 */
function greet({ name, age }) {
  return name;
}
`;

const THROWS_SOURCE = `
/**
 * @nudo:case "valid" (10)
 * @nudo:case "negative" (-1)
 */
function safeSqrt(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return x;
}
`;

const OBJ_SOURCE = `
const obj = { x: 1, y: "hello", z: true };

/**
 * @nudo:case "test" (T.number)
 */
function identity(x) {
  return x;
}
`;

describe("analyzeFile", () => {
  it("analyzes functions with @nudo:case directives", () => {
    const result = analyzeFile("/test/sample.js", SAMPLE_SOURCE);
    expect(result.functions).toHaveLength(2);

    const addFn = result.functions[0];
    expect(addFn.name).toBe("add");
    expect(addFn.cases).toHaveLength(2);
    expect(addFn.cases[0].name).toBe("concrete");
    expect(typeValueToString(addFn.cases[0].result)).toBe("3");
    expect(addFn.cases[1].name).toBe("symbolic");
    expect(typeValueToString(addFn.cases[1].result)).toBe("number");
  });

  it("provides combined type for multiple cases", () => {
    const result = analyzeFile("/test/sample.js", SAMPLE_SOURCE);
    const addFn = result.functions[0];
    expect(addFn.combined).toBeDefined();
    expect(typeValueToString(addFn.combined!)).toBe("3 | number");
  });

  it("reports throws as diagnostics", () => {
    const result = analyzeFile("/test/throws.js", THROWS_SOURCE);
    expect(result.functions).toHaveLength(1);
    const fn = result.functions[0];
    expect(fn.cases).toHaveLength(2);

    const negativeCaseThrows = fn.cases[1].throws;
    expect(negativeCaseThrows.kind).not.toBe("never");
  });

  it("returns source locations for functions", () => {
    const result = analyzeFile("/test/sample.js", SAMPLE_SOURCE);
    const addFn = result.functions[0];
    expect(addFn.loc.start.line).toBeGreaterThan(0);
    expect(addFn.loc.end.line).toBeGreaterThan(addFn.loc.start.line);
  });

  it("collects top-level bindings", () => {
    const result = analyzeFile("/test/obj.js", OBJ_SOURCE);
    expect(result.bindings.has("obj")).toBe(true);
    const objBinding = result.bindings.get("obj")!;
    expect(objBinding.type.kind).toBe("object");
  });

  it("synthesizes cases from call sites for directive-less functions", () => {
    const source = `
function uncalled(x) {
  return x * 2;
}

/**
 * @nudo:case "t" (5)
 */
function caller(y) {
  return uncalled(y);
}
`;
    const result = analyzeFile("/test/callsite.js", source);
    const uncalled = result.functions.find((f) => f.name === "uncalled");
    expect(uncalled).toBeDefined();
    expect(uncalled!.cases).toHaveLength(1);
    expect(uncalled!.cases[0].source).toBe("callsite");
    expect(uncalled!.cases[0].name).toMatch(/^call@L\d+$/);
    expect(typeValueToString(uncalled!.cases[0].result)).toBe("10");
    expect(typeValueToString(uncalled!.combined!)).toBe("10");
    expect(uncalled!.entryOnly).toBeFalsy();
  });

  it("caps precise call-site cases and folds the rest into a symbolic case", () => {
    const calls = Array.from({ length: 20 }, (_, i) => `sq(${i + 1});`).join("\n");
    const source = `
function sq(x) {
  return x * x;
}
${calls}
`;
    const result = analyzeFile("/test/many-calls.js", source);
    const sq = result.functions.find((f) => f.name === "sq");
    expect(sq).toBeDefined();
    expect(sq!.cases).toHaveLength(4);
    const precise = sq!.cases.slice(0, 3);
    for (const c of precise) {
      expect(c.name).toMatch(/^call@L\d+$/);
      expect(c.source).toBe("callsite");
      expect(c.aggregatedFrom).toBeUndefined();
    }
    expect(typeValueToString(precise[0].args[0])).toBe("1");
    const symbolic = sq!.cases[3];
    expect(symbolic.name).toBe("call@symbolic");
    expect(symbolic.source).toBe("callsite");
    expect(symbolic.aggregatedFrom).toBe(17);
    expect(symbolic.args).toHaveLength(1);
    expect(symbolic.args[0]).toEqual(T.number);
    expect(typeValueToString(symbolic.result)).toBe("number");
    expect(sq!.combined).toEqual(T.number);
    expect(sq!.entryOnly).toBeFalsy();
  });

  it("keeps per-call-site cases unchanged for few call sites", () => {
    const source = `
function twice(x) {
  return x * 2;
}
twice(3);
twice(21);
`;
    const result = analyzeFile("/test/two-calls.js", source);
    const twice = result.functions.find((f) => f.name === "twice")!;
    expect(twice.cases).toHaveLength(2);
    expect(twice.cases.every((c) => /^call@L\d+$/.test(c.name))).toBe(true);
    expect(twice.cases.some((c) => c.name === "call@symbolic")).toBe(false);
    expect(twice.cases.some((c) => c.aggregatedFrom !== undefined)).toBe(false);
    expect(typeValueToString(twice.cases[0].result)).toBe("6");
    expect(typeValueToString(twice.cases[1].result)).toBe("42");
    expect(typeValueToString(twice.combined!)).toBe("6 | 42");
  });

  it("infers entry-only functions in directive-free files", () => {
    const source = `
function lonely(x) {
  return x * 2;
}
`;
    const result = analyzeFile("/test/lonely.js", source);
    const lonely = result.functions.find((f) => f.name === "lonely");
    expect(lonely).toBeDefined();
    expect(lonely!.entryOnly).toBe(true);
    expect(lonely!.cases).toHaveLength(1);
    expect(typeValueToString(lonely!.combined!)).toBe("number");
  });

  it("keeps directive case output unchanged for functions with @nudo:case", () => {
    const result = analyzeFile("/test/sample.js", SAMPLE_SOURCE);
    const addFn = result.functions.find((f) => f.name === "add");
    expect(addFn!.cases).toHaveLength(2);
    expect(addFn!.cases[0].name).toBe("concrete");
    expect(addFn!.cases[0].source).toBeUndefined();
    expect(addFn!.entryOnly).toBeUndefined();
    expect(typeValueToString(addFn!.cases[0].result)).toBe("3");
    expect(typeValueToString(addFn!.combined!)).toBe("3 | number");
    expect(addFn!.skipped).toBeUndefined();
  });

  it("reports error diagnostic for method missing on concrete receiver", () => {
    const source = `
function badNum(n) {
  return n.toUpperCase();
}

const boom = badNum(42);
`;
    const result = analyzeFile("/test/badnum.js", source);
    const diag = result.diagnostics.find((d) => d.code === "nudo:no-method");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("error");
    expect(diag!.message).toContain("toUpperCase");
    expect(diag!.message).toContain("number");
    expect(diag!.range.start.line).toBeGreaterThan(0);
  });

  it("does not report method diagnostics for valid calls on string receivers", () => {
    const source = `
function bad(x) {
  return x.toUpperCase();
}

const ok = bad("hello");
`;
    const result = analyzeFile("/test/goodstr.js", source);
    const methodDiags = result.diagnostics.filter((d) => d.code === "nudo:no-method" || d.code === "nudo:unknown-recv");
    expect(methodDiags).toHaveLength(0);
  });

  it("downgrades unknown-receiver method failures to warnings", () => {
    const source = `
function lonely(u) {
  return u.toUpperCase();
}
`;
    const result = analyzeFile("/test/lonely-unknown.js", source);
    const diag = result.diagnostics.find((d) => d.code === "nudo:unknown-recv");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("warning");
    expect(diag!.message).toContain("toUpperCase");
    expect(result.diagnostics.some((d) => d.code === "nudo:no-method" && d.message.includes("toUpperCase"))).toBe(false);
  });
});

describe("getTypeAtPosition", () => {
  it("returns type for identifier at position", () => {
    const source = `const x = 42;\nconst y = x;\n`;
    const tv = getTypeAtPosition("/test/pos.js", source, 1, 6);
    expect(tv).not.toBeNull();
  });

  it("returns null for empty position", () => {
    const source = `\n\n\n`;
    const tv = getTypeAtPosition("/test/empty.js", source, 2, 0);
    expect(tv).toBeNull();
  });
});

describe("getCompletionsAtPosition", () => {
  it("returns variable completions without dot trigger", () => {
    const source = `const x = 42;\nfunction add(a, b) { return a + b; }\n`;
    const completions = getCompletionsAtPosition("/test/comp.js", source, 2, 0);
    expect(completions.length).toBeGreaterThan(0);
    const names = completions.map((c) => c.label);
    expect(names).toContain("x");
    expect(names).toContain("add");
  });

  it("returns property completions for object after dot", () => {
    const source = `const obj = { x: 1, y: "hello" };\nobj.x;\n`;
    const completions = getCompletionsAtPosition("/test/dot.js", source, 2, 4);
    expect(completions.length).toBeGreaterThan(0);
    const names = completions.map((c) => c.label);
    expect(names).toContain("x");
    expect(names).toContain("y");
  });

  it("returns array method completions after dot", () => {
    const source = `const arr = [1, 2, 3];\narr.map;\n`;
    const completions = getCompletionsAtPosition("/test/arr.js", source, 2, 4);
    const names = completions.map((c) => c.label);
    expect(names).toContain("map");
    expect(names).toContain("filter");
    expect(names).toContain("reduce");
    expect(names).toContain("length");
  });
});
