import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { T, typeValueToString } from "@nudojs/core";
import { analyzeFile, getTypeAtPosition, getCompletionsAtPosition, buildModuleGraph, computeDirtySet, topoSortDirty } from "../analyzer.ts";
import { generateDts } from "../dts-generator.ts";

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

  it("attaches callsite argument provenance to no-method diagnostics", () => {
    const source = `
function badNum(n) {
  return n.toUpperCase();
}

const boom = badNum(42);
`;
    const result = analyzeFile("/test/badnum.js", source);
    const diag = result.diagnostics.find((d) => d.code === "nudo:no-method");
    expect(diag).toBeDefined();
    expect(diag!.origin).toBeDefined();
    expect(diag!.origin!.line).toBe(6);
    expect(diag!.origin!.column).toBeGreaterThanOrEqual(0);
    expect(diag!.origin!.column).toBeLessThan(30);
  });

  it("omits provenance for unknown receivers without callsite origin", () => {
    const source = `
function lonely(u) {
  return u.toUpperCase();
}
`;
    const result = analyzeFile("/test/lonely-origin.js", source);
    const diag = result.diagnostics.find((d) => d.code === "nudo:unknown-recv");
    expect(diag).toBeDefined();
    expect(diag!.origin).toBeUndefined();
    expect(diag!.message).toBe("Cannot resolve 'toUpperCase' on unknown value");
  });

  it("aggregates cross-file call sites of imported functions into externalFunctions", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-ext-"));
    try {
      const aSrc = `import { triple } from "./b.js";\nfunction caller(n) { return triple(n); }\nconst r = caller(4);\n`;
      const aPath = resolve(dir, "a.js");
      writeFileSync(aPath, aSrc);
      writeFileSync(resolve(dir, "b.js"), `export function triple(x) { return x * 3; }\n`);

      const result = analyzeFile(aPath, aSrc);

      expect(result.externalFunctions).toBeDefined();
      expect(result.externalFunctions).toHaveLength(1);
      const triple = result.externalFunctions![0];
      expect(triple.name).toBe("triple");
      expect(triple.fromModule).toContain("b.js");
      expect(triple.cases).toHaveLength(1);
      expect(triple.cases[0].name).toMatch(/^call@L\d+$/);
      expect(triple.cases[0].source).toBe("callsite");
      expect(triple.cases[0].args.map(typeValueToString)).toEqual(["4"]);
      expect(typeValueToString(triple.cases[0].result)).toBe("12");
      expect(typeValueToString(triple.combined)).toBe("12");
      // imported function must not leak into this file's local functions
      expect(result.functions.map((f) => f.name)).toEqual(["caller"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves externalFunctions empty for files without imports", () => {
    const source = `function id(x) { return x; }\nconst y = id(1);\n`;
    const result = analyzeFile("/test/no-import.js", source);
    expect(result.externalFunctions ?? []).toHaveLength(0);
  });

  it("collects chained CJS exports as named functions with entry fallback", () => {
    const source = `
const internals = {};
module.exports = internals.clone = function (obj, options = {}) {
  return obj;
};
`;
    const result = analyzeFile("/test/cjs-clone.js", source);
    const clone = result.functions.find((f) => f.name === "clone");
    expect(clone).toBeDefined();
    expect(clone!.paramNames).toEqual(["obj", "options"]);
    expect(clone!.noDeclaration).toBe(true);
    expect(clone!.entryOnly).toBe(true);
    expect(clone!.cases).toHaveLength(1);
    // entry fallback: parameters enter as unknown, so returning obj propagates unknown
    expect(clone!.cases[0].args).toEqual([T.unknown, T.unknown]);
    expect(clone!.cases[0].name).toMatch(/^entry@L\d+$/);
    expect(clone!.cases[0].result.kind).toBe("unknown");
  });

  it("names chained exports after the first non-module.exports property", () => {
    const source = `
module.exports = function (solo) {
  return solo;
};
module.exports.pick = function (which) {
  return which;
};
`;
    const result = analyzeFile("/test/cjs-default.js", source);
    const names = result.functions.map((f) => f.name);
    expect(names).toContain("default");
    expect(names).toContain("pick");
  });

  it("prefers a named function expression id over the assigned property name", () => {
    const source = `
exports.applyToDefaults = function _apply(src, opts) {
  return src;
};
`;
    const result = analyzeFile("/test/cjs-named-fn.js", source);
    const fn = result.functions.find((f) => f.name === "_apply");
    expect(fn).toBeDefined();
    expect(fn!.noDeclaration).toBe(true);
    expect(fn!.cases[0].result.kind).toBe("unknown");
  });

  it("collects exports.X assignment functions", () => {
    const source = `
exports.applyToDefaults = function (a, b) {
  return a;
};
`;
    const result = analyzeFile("/test/cjs-exports.js", source);
    const fn = result.functions.find((f) => f.name === "applyToDefaults");
    expect(fn).toBeDefined();
    expect(fn!.paramNames).toEqual(["a", "b"]);
    expect(fn!.entryOnly).toBe(true);
    expect(fn!.noDeclaration).toBe(true);
    expect(fn!.cases).toHaveLength(1);
    expect(fn!.cases[0].result.kind).toBe("unknown");
  });

  it("synthesizes callsite cases for const-declared arrow functions", () => {
    const source = `
const f = (x) => x * 2;
f(3);
`;
    const result = analyzeFile("/test/const-arrow.js", source);
    const f = result.functions.find((fn) => fn.name === "f");
    expect(f).toBeDefined();
    expect(f!.noDeclaration).toBe(true);
    expect(f!.entryOnly).toBeFalsy();
    expect(f!.cases).toHaveLength(1);
    expect(f!.cases[0].source).toBe("callsite");
    expect(f!.cases[0].name).toMatch(/^call@L\d+$/);
    expect(f!.cases[0].args.map(typeValueToString)).toEqual(["3"]);
    expect(typeValueToString(f!.cases[0].result)).toBe("6");
    expect(typeValueToString(f!.combined!)).toBe("6");
  });

  it("keeps pure FunctionDeclaration collection unchanged alongside CJS forms", () => {
    const source = `
function lonely(x) {
  return x * 2;
}
exports.helper = function (y) {
  return y;
};
`;
    const result = analyzeFile("/test/mixed-forms.js", source);
    const lonely = result.functions.find((f) => f.name === "lonely")!;
    expect(lonely).toBeDefined();
    expect(lonely.noDeclaration).toBeUndefined();
    expect(lonely.entryOnly).toBe(true);
    expect(typeValueToString(lonely.combined!)).toBe("number");
    const helper = result.functions.find((f) => f.name === "helper")!;
    expect(helper).toBeDefined();
    expect(helper.noDeclaration).toBe(true);
  });

  it("skips CJS-bound functions in d.ts generation while keeping them in analysis", () => {
    const source = `
function declared(x) {
  return x * 2;
}
module.exports = internals.clone = function (obj) {
  return obj;
};
`;
    const result = analyzeFile("/test/dts-skip.js", source);
    const clone = result.functions.find((f) => f.name === "clone");
    expect(clone).toBeDefined();
    const dts = generateDts(result);
    expect(dts).toContain("export declare function declared");
    expect(dts).not.toContain("clone");
    expect(dts).not.toContain("module");
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

describe("buildModuleGraph / computeDirtySet / topoSortDirty", () => {
  const tmpWrite = (dir: string, name: string, content: string) => {
    const path = resolve(dir, name);
    writeFileSync(path, content);
    return path;
  };

  it("builds imports/dependents edges and propagates dirt to transitive dependents", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-graph-"));
    try {
      const a = tmpWrite(dir, "a.js", `import { b } from "./b.js";\nexport const a = b;\n`);
      const b = tmpWrite(dir, "b.js", `export const b = 1;\n`);
      const { imports, dependents } = buildModuleGraph([a, b]);
      expect(imports.get(a)).toContain(b);
      expect(dependents.get(b)).toContain(a);

      expect(new Set(computeDirtySet(dependents, b))).toEqual(new Set([b, a]));
      expect(computeDirtySet(dependents, a)).toEqual([a]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("propagates dirt along a three-file chain", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-graph-"));
    try {
      const a = tmpWrite(dir, "a.js", `import { b } from "./b.js";\n`);
      const b = tmpWrite(dir, "b.js", `import { c } from "./c.js";\n`);
      const c = tmpWrite(dir, "c.js", `export const c = 1;\n`);
      const { dependents } = buildModuleGraph([a, b, c]);
      expect(new Set(computeDirtySet(dependents, c))).toEqual(new Set([c, b, a]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles import cycles without infinite loop", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-graph-"));
    try {
      const a = tmpWrite(dir, "a.js", `import { b } from "./b.js";\nexport const a = 1;\n`);
      const b = tmpWrite(dir, "b.js", `import { a } from "./a.js";\nexport const b = 2;\n`);
      const { imports, dependents } = buildModuleGraph([a, b]);
      const dirty = computeDirtySet(dependents, a);
      expect(new Set(dirty)).toEqual(new Set([a, b]));

      const ordered = topoSortDirty(imports, dirty);
      expect(new Set(ordered)).toEqual(new Set([a, b]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips bare npm specifiers and orders dirty set dependencies-first", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-graph-"));
    try {
      const a = tmpWrite(dir, "a.js", `import _ from "lodash";\nimport { b } from "./b.js";\n`);
      const b = tmpWrite(dir, "b.js", `export const b = 1;\n`);
      const { imports, dependents } = buildModuleGraph([a, b]);
      expect(imports.get(a)).toEqual(new Set([b]));

      const dirty = computeDirtySet(dependents, b);
      const ordered = topoSortDirty(imports, dirty);
      expect(ordered.indexOf(b)).toBeLessThan(ordered.indexOf(a));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
