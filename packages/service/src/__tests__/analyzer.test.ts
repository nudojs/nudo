import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { join } from "node:path";
import { writeFileSync, readFileSync, chmodSync, utimesSync } from "node:fs";
import { litValue, formatShape, str, abs as makeAbs, type Abs } from "@nudojs/core";
import { analyzeFile, collectCallRecords, buildModuleGraph, type ModuleGraphCache, computeDirtySet, topoSortDirty } from "../analyzer.ts";
import { resetAllAnalysisCaches } from "../index.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";
import { absRec, neverAbs, litAbs } from "../emit/__tests__/fixtures.ts";

const objAbs = (props: Record<string, Abs>): Abs => {
  const slots: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(props)) slots[k] = { value: v };
  return makeAbs({ k: "obj", slots }, undefined, undefined, "exact");
};

// 用例级缓存隔离：analyzeFile 背后的会话级缓存（analysisFileCache / evalRunCache /
// fnAnalysisCache / absModuleCache / core 的 checkSource·generalize·nudo-exec
// memo / AST LRU）全部清空，杜绝跨用例陈旧命中。
// buildModuleGraph 的 mtime 边缓存测试用的是各自传入的局部 cache，不受影响。
beforeEach(() => {
  resetAllAnalysisCaches();
});

const FIXTURE_PATH = resolve(import.meta.dirname, "fixtures", "sample.js");

const SAMPLE_SOURCE = `
/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (number(), number())
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
 * @nudo:case "test" (number())
 */
function identity(x) {
  return x;
}
`;

describe("analyzeFile", () => {
  it("directive cases / combined / loc / bindings / throws", () => {
    const result = analyzeFile("/test/sample.js", SAMPLE_SOURCE);
    expect(result.functions).toHaveLength(2);
    const addFn = result.functions[0]!;
    expect(addFn.name).toBe("add");
    expect(addFn.cases).toHaveLength(2);
    expect(addFn.cases[0]!.name).toBe("concrete");
    expect(formatShape(addFn.cases[0]!.abs)).toBe("3");
    expect(addFn.cases[1]!.name).toBe("symbolic");
    expect(formatShape(addFn.cases[1]!.abs)).toBe("number");
    expect(formatShape(addFn.combinedAbs!)).toBe("number");
    expect(addFn.loc.start.line).toBeGreaterThan(0);
    expect(addFn.loc.end.line).toBeGreaterThan(addFn.loc.start.line);
    expect(addFn.cases[0]!.source).toBe("directive");
    expect(addFn.skipped).toBeUndefined();

    const throwsResult = analyzeFile("/test/throws.js", THROWS_SOURCE);
    expect(throwsResult.functions).toHaveLength(1);
    const safe = throwsResult.functions[0]!;
    expect(safe.cases).toHaveLength(3);
    expect(safe.cases[1]!.throwsAbs.shape.k).not.toBe("never");

    const objResult = analyzeFile("/test/obj.js", OBJ_SOURCE);
    expect(objResult.bindings.has("obj")).toBe(true);
    expect(objResult.bindings.get("obj")!.abs.shape.k).toBe("obj");
  });

  it("callsite synthesis / cap / few-call / entry-only", () => {
    const synth = analyzeFile("/test/callsite.js", `
function uncalled(x) { return x * 2; }
/** @nudo:case "t" (5) */
function caller(y) { return uncalled(y); }
`);
    const uncalled = synth.functions.find((f) => f.name === "uncalled")!;
    expect(uncalled.cases).toHaveLength(1);
    expect(uncalled.cases[0]!.source).toBe("callsite");
    expect(uncalled.cases[0]!.name).toMatch(/^call@L\d+$/);
    expect(formatShape(uncalled.cases[0]!.abs)).toBe("10");
    expect(formatShape(uncalled.combinedAbs!)).toBe("10");
    expect(uncalled.entryOnly).toBeFalsy();

    const calls = Array.from({ length: 20 }, (_, i) => `sq(${i + 1});`).join("\n");
    const many = analyzeFile("/test/many-calls.js", `function sq(x) { return x * x; }\n${calls}`);
    const sq = many.functions.find((f) => f.name === "sq")!;
    expect(sq.cases).toHaveLength(4);
    for (const c of sq.cases.slice(0, 3)) {
      expect(c.name).toMatch(/^call@L\d+$/);
      expect(c.source).toBe("callsite");
      expect(c.aggregatedFrom).toBeUndefined();
    }
    expect(formatShape(sq.cases[0]!.argAbs[0]!)).toBe("1");
    const symbolic = sq.cases[3]!;
    expect(symbolic.name).toBe("call@symbolic");
    expect(symbolic.aggregatedFrom).toBe(17);
    expect(formatShape(symbolic.argAbs[0]!)).toBe("number");
    expect(formatShape(symbolic.abs)).toBe("number");
    expect(formatShape(sq.combinedAbs!)).toBe("number");

    const few = analyzeFile("/test/two-calls.js", `function twice(x) { return x * 2; }\ntwice(3);\ntwice(21);\n`);
    const twice = few.functions.find((f) => f.name === "twice")!;
    expect(twice.cases).toHaveLength(2);
    expect(twice.cases.every((c) => /^call@L\d+$/.test(c.name))).toBe(true);
    expect(twice.cases.some((c) => c.name === "call@symbolic")).toBe(false);
    expect(formatShape(twice.cases[0]!.abs)).toBe("6");
    expect(formatShape(twice.cases[1]!.abs)).toBe("42");
    expect(formatShape(twice.combinedAbs!)).toBe("6 | 42");

    const lonely = analyzeFile("/test/lonely.js", "function lonely(x) { return x * 2; }").functions.find((f) => f.name === "lonely")!;
    expect(lonely.entryOnly).toBe(true);
    expect(lonely.cases).toHaveLength(1);
    expect(formatShape(lonely.combinedAbs!)).toBe("number");
  });

  it("method diagnostics / any entry / provenance", () => {
    const bad = analyzeFile("/test/badnum.js", `\nfunction badNum(n) {\n  return n.toUpperCase();\n}\n\nconst boom = badNum(42);\n`);
    const diag = bad.diagnostics.find((d) => d.code === "nudo:no-method")!;
    expect(diag).toBeDefined();
    expect(diag.severity).toBe("error");
    expect(diag.message).toContain("toUpperCase");
    expect(diag.message).toContain("number");
    expect(diag.range.start.line).toBeGreaterThan(0);
    expect(diag.origin).toBeDefined();
    expect(diag.origin!.line).toBe(6);
    expect(diag.origin!.column).toBeGreaterThanOrEqual(0);
    expect(diag.origin!.column).toBeLessThan(30);

    const good = analyzeFile("/test/goodstr.js", `function bad(x) { return x.toUpperCase(); }\nconst ok = bad("hello");\n`);
    expect(good.diagnostics.filter((d) => d.code === "nudo:no-method" || d.code === "nudo:unknown-recv")).toHaveLength(0);

    const anyEntry = analyzeFile("/test/lonely-unknown.js", "function lonely(u) { return u.toUpperCase(); }");
    expect(anyEntry.diagnostics.filter((d) => d.code === "nudo:unknown-recv")).toHaveLength(0);
    const entry = anyEntry.functions.find((f) => f.name === "lonely")!.cases.find((c) => c.name.startsWith("entry@"))!;
    expect(formatShape(entry.argAbs[0]!)).toBe("any");
    expect(formatShape(entry.throwsAbs)).toContain("TypeError");
  });

  it("externalFunctions cross-file aggregation / empty without imports", () => {
    withTmpProject("nudo-ext-", (dir) => {
      const aSrc = `import { triple } from "./b.js";\nfunction caller(n) { return triple(n); }\nconst r = caller(4);\n`;
      const aPath = resolve(dir, "a.js");
      writeFileSync(aPath, aSrc);
      writeFileSync(resolve(dir, "b.js"), "export function triple(x) { return x * 3; }\n");
      const result = analyzeFile(aPath, aSrc);
      expect(result.externalFunctions).toHaveLength(1);
      const triple = result.externalFunctions![0]!;
      expect(triple.name).toBe("triple");
      expect(triple.fromModule).toContain("b.js");
      expect(triple.cases).toHaveLength(1);
      expect(triple.cases[0]!.source).toBe("callsite");
      expect(triple.cases[0]!.argAbs.map((a) => formatShape(a))).toEqual(["4"]);
      expect(formatShape(triple.cases[0]!.abs)).toBe("12");
      expect(formatShape(triple.combinedAbs!)).toBe("12");
      expect(result.functions.map((f) => f.name)).toEqual(["caller"]);
    });
    expect((analyzeFile("/test/no-import.js", "function id(x) { return x; }\nconst y = id(1);\n").externalFunctions ?? [])).toHaveLength(0);
  });

  it("CJS export forms", () => {
    const chained = analyzeFile("/test/cjs-clone.js", `const internals = {};\nmodule.exports = internals.clone = function (obj, options = {}) { return obj; };\n`);
    const clone = chained.functions.find((f) => f.name === "clone")!;
    expect(clone.paramNames).toEqual(["obj", "options"]);
    expect(clone.noDeclaration).toBe(true);
    expect(clone.entryOnly).toBe(true);
    expect(clone.cases).toHaveLength(1);
    expect(clone.cases[0]!.argAbs.map((a) => formatShape(a))).toEqual(["any", "any"]);
    expect(clone.cases[0]!.name).toMatch(/^entry@L\d+$/);
    expect(formatShape(clone.cases[0]!.abs)).toBe("unknown");

    const named = analyzeFile("/test/cjs-default.js", `module.exports = function (solo) { return solo; };\nmodule.exports.pick = function (which) { return which; };\n`);
    expect(named.functions.map((f) => f.name)).toEqual(expect.arrayContaining(["default", "pick"]));

    const slot = analyzeFile("/test/cjs-named-fn.js", `exports.applyToDefaults = function _apply(src, opts) { return src; };\n`);
    const applyFn = slot.functions.find((f) => f.name === "applyToDefaults")!;
    expect(applyFn).toBeDefined();
    expect(slot.functions.some((f) => f.name === "_apply")).toBe(false);
    expect(applyFn.noDeclaration).toBe(true);
    expect(applyFn.cases[0]!.abs.shape.k).toBe("any");

    const assigned = analyzeFile("/test/cjs-exports.js", `exports.applyToDefaults = function (a, b) { return a; };\n`);
    const assignedFn = assigned.functions.find((f) => f.name === "applyToDefaults")!;
    expect(assignedFn.paramNames).toEqual(["a", "b"]);
    expect(assignedFn.entryOnly).toBe(true);
    expect(assignedFn.noDeclaration).toBe(true);
    expect(assignedFn.cases[0]!.abs.shape.k).toBe("any");
  });

  it("const arrow / mixed forms / injected usage records", () => {
    const arrow = analyzeFile("/test/const-arrow.js", "const f = (x) => x * 2;\nf(3);\n");
    const f = arrow.functions.find((fn) => fn.name === "f")!;
    expect(f.noDeclaration).toBe(true);
    expect(f.entryOnly).toBeFalsy();
    expect(f.cases).toHaveLength(1);
    expect(f.cases[0]!.source).toBe("callsite");
    expect(f.cases[0]!.argAbs.map((a) => formatShape(a))).toEqual(["3"]);
    expect(formatShape(f.cases[0]!.abs)).toBe("6");

    const mixed = analyzeFile("/test/mixed-forms.js", `function lonely(x) { return x * 2; }\nexports.helper = function (y) { return y; };\n`);
    const lonely = mixed.functions.find((fn) => fn.name === "lonely")!;
    expect(lonely.noDeclaration).toBeUndefined();
    expect(lonely.entryOnly).toBe(true);
    expect(formatShape(lonely.combinedAbs!)).toBe("number");
    expect(mixed.functions.find((fn) => fn.name === "helper")!.noDeclaration).toBe(true);

    const source = `function formatName(first, last) { return first + " " + last; }\nfunction shout(msg) { return msg.toUpperCase(); }\nmodule.exports = { formatName, shout };\n`;
    const external = [absRec({ fnName: "formatName", argAbs: [litAbs("Ada"), litAbs("Lovelace")], resultAbs: litAbs("Ada Lovelace"), throwsAbs: neverAbs(), targetModule: "/test/lib/util.js", targetExport: "formatName" })];
    const injected = analyzeFile("/test/lib/util.js", source, undefined, external);
    const formatName = injected.functions.find((fn) => fn.name === "formatName")!;
    expect(formatName.entryOnly).toBeFalsy();
    expect(formatName.cases[0]!.argAbs.map((a) => formatShape(a))).toEqual(['"Ada"', '"Lovelace"']);
    expect(formatShape(formatName.cases[0]!.abs)).toBe('"Ada Lovelace"');
    expect(injected.functions.find((fn) => fn.name === "shout")!.entryOnly).toBe(true);
  });

  it("call records / module-path matching / multi-export / never handling", () => {
    withTmpProject("nudo-cs-", (dir) => {
      const libPath = join(dir, "util.js");
      writeFileSync(libPath, "export function double(n) { return n * 2; }\n");
      const testPath = join(dir, "test.js");
      writeFileSync(testPath, 'import { double } from "./util.js";\nconst r = double(21);\n');
      const records = collectCallRecords(testPath, readFileSync(testPath, "utf-8"));
      const double = records.find((r) => r.targetExport === "double")!;
      expect(double.argAbs.map((a) => { const lr = litValue(a); return lr.ok ? String(lr.value) : undefined; })).toEqual(["21"]);
      const rlr = litValue(double.resultAbs);
      expect(rlr.ok && String(rlr.value)).toBe("42");
      const result = analyzeFile(libPath, readFileSync(libPath, "utf-8"), undefined, records);
      const fn = result.functions.find((f) => f.name === "double")!;
      expect(fn.entryOnly).toBeFalsy();
      expect(formatShape(fn.combinedAbs!)).toBe("42");
    });

    const anonSource = `function helper(n) { return n - 1; }\nmodule.exports = function (a, b) { return a + b; };\n`;
    const anonExternal = [absRec({ fnName: "renamed", argAbs: [litAbs(1), litAbs(2)], resultAbs: litAbs(3), throwsAbs: neverAbs(), callLoc: { line: 3, column: 0 }, targetModule: "/test/anon-export.js", targetExport: "renamed", targetAliases: ["shorthand"] })];
    const anon = analyzeFile("/test/anon-export.js", anonSource, undefined, anonExternal);
    const main = anon.functions.find((f) => f.name === "default")!;
    expect(main.entryOnly).toBeFalsy();
    expect(main.cases[0]!.source).toBe("callsite");
    expect(main.cases[0]!.argAbs.map((a) => formatShape(a))).toEqual(["1", "2"]);
    expect(formatShape(main.cases[0]!.abs)).toBe("3");
    expect(anon.functions.find((f) => f.name === "helper")!.entryOnly).toBe(true);

    const multi = analyzeFile("/test/multi-export.js", `function alpha(x) { return x; }\nfunction beta(x) { return x; }\nmodule.exports = { alpha, beta };\n`, undefined, [absRec({ fnName: "gamma", argAbs: [litAbs(1)], resultAbs: litAbs(1), throwsAbs: neverAbs(), callLoc: { line: 4, column: 0 }, targetModule: "/test/multi-export.js", targetExport: "gamma" })]);
    for (const name of ["alpha", "beta"]) {
      const fn = multi.functions.find((f) => f.name === name)!;
      expect(fn.entryOnly).toBe(true);
      expect(fn.cases[0]!.source).toBeUndefined();
    }

    const skipped = analyzeFile("/test/higher-order.js", "function parseChunked(emitter) { return emitter; }\n", undefined, [absRec({ fnName: "parseChunked", argAbs: [objAbs({})], resultAbs: neverAbs(), throwsAbs: neverAbs(), callLoc: { line: 5, column: 0 }, targetModule: "/test/higher-order.js", targetExport: "parseChunked" })]);
    const skippedFn = skipped.functions.find((f) => f.name === "parseChunked")!;
    expect(skippedFn.entryOnly).toBe(true);
    expect(skippedFn.cases[0]!.name).toMatch(/^entry@L\d+$/);

    const throwing = analyzeFile("/test/throwing.js", "function fail(msg) { throw new Error(msg); }\n", undefined, [absRec({ fnName: "fail", argAbs: [litAbs("boom")], resultAbs: neverAbs(), throwsAbs: str(), callLoc: { line: 7, column: 0 }, targetModule: "/test/throwing.js", targetExport: "fail" })]);
    const throwingFn = throwing.functions.find((f) => f.name === "fail")!;
    expect(throwingFn.entryOnly).toBeFalsy();
    expect(throwingFn.cases[0]!.argAbs.map((a) => formatShape(a))).toEqual(['"boom"']);
    expect(throwingFn.cases[0]!.abs.shape.k).toBe("never");
    expect(formatShape(throwingFn.cases[0]!.throwsAbs)).toBe("string");
  });
});

describe("buildModuleGraph / computeDirtySet / topoSortDirty", () => {
  it("imports/dependents 边、链式脏传播、环、裸包跳过、re-export/require 边、字符串注释不算边", () => {
    withTmpProject("nudo-graph-", (dir) => {
      const a = writeTmpFile(dir, "a.js", 'import { b } from "./b.js";\nexport const a = b;\n');
      const b = writeTmpFile(dir, "b.js", "export const b = 1;\n");
      const { imports, dependents } = buildModuleGraph([a, b]);
      expect(imports.get(a)).toContain(b);
      expect(dependents.get(b)).toContain(a);
      expect(new Set(computeDirtySet(dependents, b))).toEqual(new Set([b, a]));
      expect(computeDirtySet(dependents, a)).toEqual([a]);
      expect(topoSortDirty(imports, computeDirtySet(dependents, b)).indexOf(b)).toBeLessThan(topoSortDirty(imports, computeDirtySet(dependents, b)).indexOf(a));
    });
    withTmpProject("nudo-graph-", (dir) => {
      const a = writeTmpFile(dir, "a.js", 'import { b } from "./b.js";\n');
      const b = writeTmpFile(dir, "b.js", 'import { c } from "./c.js";\n');
      const c = writeTmpFile(dir, "c.js", "export const c = 1;\n");
      const { dependents } = buildModuleGraph([a, b, c]);
      expect(new Set(computeDirtySet(dependents, c))).toEqual(new Set([c, b, a]));
    });
    withTmpProject("nudo-graph-", (dir) => {
      const a = writeTmpFile(dir, "a.js", 'import { b } from "./b.js";\nexport const a = 1;\n');
      const b = writeTmpFile(dir, "b.js", 'import { a } from "./a.js";\nexport const b = 2;\n');
      const { imports, dependents } = buildModuleGraph([a, b]);
      const dirty = computeDirtySet(dependents, a);
      expect(new Set(dirty)).toEqual(new Set([a, b]));
      expect(new Set(topoSortDirty(imports, dirty))).toEqual(new Set([a, b]));
    });
    withTmpProject("nudo-graph-", (dir) => {
      const a = writeTmpFile(dir, "a.js", 'import _ from "lodash";\nimport { b } from "./b.js";\n');
      const b = writeTmpFile(dir, "b.js", "export const b = 1;\n");
      const { imports, dependents } = buildModuleGraph([a, b]);
      expect(imports.get(a)).toEqual(new Set([b]));
      const ordered = topoSortDirty(imports, computeDirtySet(dependents, b));
      expect(ordered.indexOf(b)).toBeLessThan(ordered.indexOf(a));
    });
    withTmpProject("nudo-graph-reexport-", (dir) => {
      const star = writeTmpFile(dir, "star.js", 'export * from "./base.js";\n');
      const named = writeTmpFile(dir, "named.js", 'export { k } from "./base.js";\n');
      const base = writeTmpFile(dir, "base.js", "export const k = 1;\n");
      const { imports, dependents } = buildModuleGraph([star, named, base]);
      expect(dependents.get(base)).toEqual(new Set([star, named]));
      expect(imports.get(star)).toEqual(new Set([base]));
      expect(imports.get(named)).toEqual(new Set([base]));
      expect(new Set(computeDirtySet(dependents, base))).toEqual(new Set([base, star, named]));
    });
    withTmpProject("nudo-graph-require-", (dir) => {
      const barrel = writeTmpFile(dir, "barrel.js", 'const m = require("./base.js");\nmodule.exports = m;\n');
      const viaResolve = writeTmpFile(dir, "via-resolve.js", 'const p = require.resolve("./base.js");\n');
      const base = writeTmpFile(dir, "base.js", "exports.k = 1;\n");
      const { dependents } = buildModuleGraph([barrel, viaResolve, base]);
      expect(dependents.get(base)).toEqual(new Set([barrel, viaResolve]));
      expect(new Set(computeDirtySet(dependents, base))).toEqual(new Set([base, barrel, viaResolve]));
    });
    withTmpProject("nudo-graph-str-", (dir) => {
      const a = writeTmpFile(dir, "a.js", '// require("./base.js");\nconst s = "require(\'./base.js\')";\nexport const a = s;\n');
      const base = writeTmpFile(dir, "base.js", "export const k = 1;\n");
      const { dependents } = buildModuleGraph([a, base]);
      expect(dependents.get(base) ?? new Set()).toEqual(new Set());
    });
  });
});

// 来源：LSP 隔离控制工程化——buildModuleGraph mtime 边缓存
describe("buildModuleGraph mtime 边缓存", () => {
  const normalize = (g: { imports: Map<string, Set<string>>; dependents: Map<string, Set<string>> }) =>
    JSON.stringify({ imports: [...g.imports].map(([k, v]) => [k, [...v].sort()]), dependents: [...g.dependents].map(([k, v]) => [k, [...v].sort()]) });
  it("命中/失效/mtime 变化/不可读仍命中", () => {
    withTmpProject("nudo-graph-cache-", (dir) => {
      const a = writeTmpFile(dir, "a.js", 'import { b } from "./b.js";\n');
      const b = writeTmpFile(dir, "b.js", 'import { c } from "./c.js";\n');
      const c = writeTmpFile(dir, "c.js", "export const c = 1;\n");
      const plain = buildModuleGraph([a, b, c]);
      const cache: ModuleGraphCache = new Map();
      const once = buildModuleGraph([a, b, c], cache);
      const twice = buildModuleGraph([a, b, c], cache);
      expect(normalize(once)).toBe(normalize(plain));
      expect(normalize(twice)).toBe(normalize(plain));
      expect(cache.size).toBe(3);
    });
    withTmpProject("nudo-graph-cache-", (dir) => {
      const a = writeTmpFile(dir, "a.js", 'import { b } from "./b.js";\n');
      const b = writeTmpFile(dir, "b.js", "export const b = 1;\n");
      const d = writeTmpFile(dir, "d.js", "export const d = 1;\n");
      const cache: ModuleGraphCache = new Map();
      expect(buildModuleGraph([a, b, d], cache).imports.get(a)).toEqual(new Set([b]));
      writeFileSync(a, 'import { b } from "./b.js";\nimport { d } from "./d.js";\n');
      const after = buildModuleGraph([a, b, d], cache);
      expect(after.imports.get(a)).toEqual(new Set([b, d]));
      expect(new Set(cache.get(a)!.edges)).toEqual(new Set([b, d]));
    });
    withTmpProject("nudo-graph-cache-", (dir) => {
      const a = writeTmpFile(dir, "a.js", 'import { v } from "./b.js";\n');
      const b = writeTmpFile(dir, "b.js", "export const v = 1;\n");
      const c = writeTmpFile(dir, "c.js", "export const v = 2;\n");
      const cache: ModuleGraphCache = new Map();
      expect(buildModuleGraph([a, b, c], cache).imports.get(a)).toEqual(new Set([b]));
      writeFileSync(a, 'import { v } from "./c.js";\n');
      const forced = new Date(cache.get(a)!.mtimeMs + 10_000);
      utimesSync(a, forced, forced);
      expect(buildModuleGraph([a, b, c], cache).imports.get(a)).toEqual(new Set([c]));
    });
    withTmpProject("nudo-graph-cache-", (dir) => {
      const a = writeTmpFile(dir, "a.js", 'import { b } from "./b.js";\n');
      const b = writeTmpFile(dir, "b.js", "export const b = 1;\n");
      const cache: ModuleGraphCache = new Map();
      buildModuleGraph([a, b], cache);
      chmodSync(a, 0o000);
      try {
        const hit = buildModuleGraph([a, b], cache);
        expect(hit.imports.get(a)).toEqual(new Set([b]));
        expect(hit.dependents.get(b)).toEqual(new Set([a]));
        expect(buildModuleGraph([a, b]).imports.get(a)).toEqual(new Set());
      } finally { chmodSync(a, 0o644); }
    });
  });
});
