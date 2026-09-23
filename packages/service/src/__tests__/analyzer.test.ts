import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { litValue, formatShape, numLit, strLit, boolLit, str, abs as makeAbs, type Abs } from "@nudojs/core";
import { analyzeFile, collectCallRecords, buildModuleGraph, type ModuleGraphCache, computeDirtySet, topoSortDirty } from "../analyzer.ts";
import { getTypeAtPosition, getCompletionsAtPosition } from "../lsp-surface.ts";
import { generateDts } from "../dts-generator.ts";
import { resetAllAnalysisCaches } from "../index.ts";
import type { CallRecord } from "../evaluator/call-record.ts";

const neverAbs = (): Abs => makeAbs({ k: "never" }, undefined, undefined, "exact");
const nullLit = (): Abs => makeAbs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
const undefLit = (): Abs => makeAbs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact");
function litAbs(v: string | number | boolean | null | undefined): Abs {
  if (typeof v === "number") return numLit(v);
  if (typeof v === "string") return strLit(v);
  if (typeof v === "boolean") return boolLit(v);
  if (v === null) return nullLit();
  return undefLit();
}
const objAbs = (props: Record<string, Abs>): Abs => {
  const slots: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(props)) slots[k] = { value: v };
  return makeAbs({ k: "obj", slots }, undefined, undefined, "exact");
};

/** 测试夹具：Abs CallRecord */
function absRec(p: {
  fnName: string;
  argAbs: Abs[];
  resultAbs: Abs;
  throwsAbs: Abs;
  callLoc?: { line: number; column: number };
  targetModule?: string;
  targetExport?: string;
  targetAliases?: string[];
}): CallRecord {
  return {
    fnName: p.fnName,
    argAbs: p.argAbs,
    resultAbs: p.resultAbs,
    throwsAbs: p.throwsAbs,
    ...(p.callLoc ? { callLoc: p.callLoc } : {}),
    ...(p.targetModule ? { targetModule: p.targetModule } : {}),
    ...(p.targetExport ? { targetExport: p.targetExport } : {}),
    ...(p.targetAliases ? { targetAliases: p.targetAliases } : {}),
  };
}

// 用例级缓存隔离：analyzeFile 背后的会话级缓存（analysisFileCache / bRunCache /
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
  it("analyzes functions with @nudo:case directives", () => {
    const result = analyzeFile("/test/sample.js", SAMPLE_SOURCE);
    expect(result.functions).toHaveLength(2);

    const addFn = result.functions[0];
    expect(addFn.name).toBe("add");
    expect(addFn.cases).toHaveLength(2);
    expect(addFn.cases[0].name).toBe("concrete");
    expect(formatShape(addFn.cases[0].abs)).toBe("3");
    expect(addFn.cases[1].name).toBe("symbolic");
    expect(formatShape(addFn.cases[1].abs)).toBe("number");
  });

  it("provides combined type for multiple cases", () => {
    const result = analyzeFile("/test/sample.js", SAMPLE_SOURCE);
    const addFn = result.functions[0];
    expect(addFn.combinedAbs).toBeDefined();
    // 行为已修复：吸收律生效，字面量 3 被共存的 number 吸收（原期望 "3 | number"）
    expect(formatShape(addFn.combinedAbs!)).toBe("number");
  });

  it("reports throws as diagnostics", () => {
    const result = analyzeFile("/test/throws.js", THROWS_SOURCE);
    expect(result.functions).toHaveLength(1);
    const fn = result.functions[0];
    expect(fn.cases).toHaveLength(2);

    const negativeCaseThrows = fn.cases[1].throwsAbs;
    expect(negativeCaseThrows.shape.k).not.toBe("never");
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
    expect(objBinding.abs.shape.k).toBe("obj");
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
    expect(formatShape(uncalled!.cases[0].abs)).toBe("10");
    expect(formatShape(uncalled!.combinedAbs!)).toBe("10");
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
    expect(formatShape(precise[0].argAbs[0])).toBe("1");
    const symbolic = sq!.cases[3];
    expect(symbolic.name).toBe("call@symbolic");
    expect(symbolic.source).toBe("callsite");
    expect(symbolic.aggregatedFrom).toBe(17);
    expect(symbolic.argAbs).toHaveLength(1);
    expect(formatShape(symbolic.argAbs[0]!)).toBe("number");
    expect(formatShape(symbolic.abs)).toBe("number");
    expect(formatShape(sq!.combinedAbs!)).toBe("number");
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
    expect(formatShape(twice.cases[0].abs)).toBe("6");
    expect(formatShape(twice.cases[1].abs)).toBe("42");
    expect(formatShape(twice.combinedAbs!)).toBe("6 | 42");
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
    expect(formatShape(lonely!.combinedAbs!)).toBe("number");
  });

  it("keeps directive case output unchanged for functions with @nudo:case", () => {
    const result = analyzeFile("/test/sample.js", SAMPLE_SOURCE);
    const addFn = result.functions.find((f) => f.name === "add");
    expect(addFn!.cases).toHaveLength(2);
    expect(addFn!.cases[0].name).toBe("concrete");
    expect(addFn!.cases[0].source).toBe("directive");
    expect(addFn!.entryOnly).toBeUndefined();
    expect(formatShape(addFn!.cases[0].abs)).toBe("3");
    // 行为已修复：吸收律生效，combined 的字面量 3 被共存的 number 吸收（原期望 "3 | number"）
    expect(formatShape(addFn!.combinedAbs!)).toBe("number");
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

  it("entry unconstrained param is any; method on any is throws, not unknown-recv", () => {
    const source = `
function lonely(u) {
  return u.toUpperCase();
}
`;
    const result = analyzeFile("/test/lonely-unknown.js", source);
    // design-cli-semantics §2–3: 无约束入口参数 = any；成员访问进 throws 域
    const unknownRecv = result.diagnostics.filter((d) => d.code === "nudo:unknown-recv");
    expect(unknownRecv).toHaveLength(0);
    const fn = result.functions.find((f) => f.name === "lonely");
    expect(fn).toBeDefined();
    const entry = fn!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
    expect(formatShape(entry!.argAbs[0]!)).toBe("any");
    expect(formatShape(entry!.throwsAbs)).toContain("TypeError");
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

  it("entry any member access records may-throw without unknown-recv", () => {
    const source = `
function lonely(u) {
  return u.toUpperCase();
}
`;
    const result = analyzeFile("/test/lonely-origin.js", source);
    // 无约束参数 = any → throws 域，不是 unknown-recv 引擎债
    expect(result.diagnostics.filter((d) => d.code === "nudo:unknown-recv")).toHaveLength(0);
    const entry = result.functions.find((f) => f.name === "lonely")?.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
    expect(formatShape(entry!.throwsAbs)).toContain("TypeError");
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
      expect(triple.cases[0].argAbs.map(formatShape)).toEqual(["4"]);
      expect(formatShape(triple.cases[0].abs)).toBe("12");
      expect(triple.combinedAbs).toBeDefined();
      expect(formatShape(triple.combinedAbs!)).toBe("12");
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

  it("collects chained CJS exports as named functions with entry any params", () => {
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
    // design-cli-semantics §2: 入口无约束参数 = any（不是 unknown）
    expect(clone!.cases[0].argAbs).toHaveLength(2);
    expect(formatShape(clone!.cases[0].argAbs[0]!)).toBe("any");
    expect(formatShape(clone!.cases[0].argAbs[1]!)).toBe("any");
    expect(clone!.cases[0].name).toMatch(/^entry@L\d+$/);
    // CJS 赋值导出：具名求值可能拿不到绑定 → 结果 unknown 是「推导失败」，与 any 区分
    expect(formatShape(clone!.cases[0].abs)).toBe("unknown");
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
    // 入口无约束参数展示 any，不是 unknown（design-cli-semantics §2）；
    // CJS exports 赋值源经 B 的 exports 命名空间建模（run.ts CJS 面）
    expect(fn!.cases[0].abs.shape.k).toBe("any");
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
    // 入口无约束参数展示 any，不是 unknown（design-cli-semantics §2）
    expect(fn!.cases[0].abs.shape.k).toBe("any");
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
    expect(f!.cases[0].argAbs.map(formatShape)).toEqual(["3"]);
    expect(formatShape(f!.cases[0].abs)).toBe("6");
    expect(formatShape(f!.combinedAbs!)).toBe("6");
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
    expect(formatShape(lonely.combinedAbs!)).toBe("number");
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

  it("synthesizes cases from externally injected usage-site call records", () => {
    const source = `
function formatName(first, last) {
  return first + " " + last;
}
function shout(msg) {
  return msg.toUpperCase();
}
module.exports = { formatName, shout };
`;
    // 模拟 CLI --from 从使用现场（测试/上层应用）收集的记录：
    // targetExport 命中导出名 formatName，fnName 形态也会被匹配
    const external = [
      absRec({
        fnName: "formatName",
        argAbs: [litAbs("Ada"), litAbs("Lovelace")],
        resultAbs: litAbs("Ada Lovelace"),
        throwsAbs: neverAbs(),
        targetModule: "/test/lib/util.js",
        targetExport: "formatName",
      }),
    ];
    const result = analyzeFile("/test/lib/util.js", source, undefined, external);
    const formatName = result.functions.find((f) => f.name === "formatName")!;
    expect(formatName).toBeDefined();
    expect(formatName.entryOnly).toBeFalsy();
    expect(formatName.cases).toHaveLength(1);
    expect(formatName.cases[0].source).toBe("callsite");
    expect(formatName.cases[0].argAbs.map(formatShape)).toEqual(['"Ada"', '"Lovelace"']);
    expect(formatShape(formatName.cases[0].abs)).toBe('"Ada Lovelace"');

    // 未被使用现场调用的 shout 保持 entry-only
    const shout = result.functions.find((f) => f.name === "shout")!;
    expect(shout.entryOnly).toBe(true);
  });

  it("collectCallRecords harvests real call shapes from usage-site files", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cs-"));
    try {
      const libPath = join(dir, "util.js");
      writeFileSync(libPath, "export function double(n) { return n * 2; }\n");
      const testPath = join(dir, "test.js");
      writeFileSync(testPath, 'import { double } from "./util.js";\nconst r = double(21);\n');
      const records = collectCallRecords(testPath, readFileSync(testPath, "utf-8"));
      const double = records.find((r) => r.targetExport === "double");
      expect(double).toBeDefined();
      expect(double!.argAbs.map((a) => String(litValue(a)))).toEqual(["21"]);
      expect(String(litValue(double!.resultAbs))).toBe("42");

      // 注入后 double 从 entry-only 升级为真实调用形态
      const result = analyzeFile(libPath, readFileSync(libPath, "utf-8"), undefined, records);
      const fn = result.functions.find((f) => f.name === "double")!;
      expect(fn.entryOnly).toBeFalsy();
      expect(formatShape(fn.combinedAbs!)).toBe("42");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("matches injected records to anonymous module.exports single-export files via the module path", () => {
    const source = `
function helper(n) {
  return n - 1;
}
module.exports = function (a, b) {
  return a + b;
};
`;
    // 使用方经转发 shim 以别的名字调用：fnName/targetExport/targetAliases
    // 都对不上本地 candidate 名 "default"，仅模块路命中
    const external = [
      absRec({
        fnName: "renamed",
        argAbs: [litAbs(1), litAbs(2)],
        resultAbs: litAbs(3),
        throwsAbs: neverAbs(),
        callLoc: { line: 3, column: 0 },
        targetModule: "/test/anon-export.js",
        targetExport: "renamed",
        targetAliases: ["shorthand"],
      }),
    ];
    const result = analyzeFile("/test/anon-export.js", source, undefined, external);
    const main = result.functions.find((f) => f.name === "default")!;
    expect(main).toBeDefined();
    expect(main.entryOnly).toBeFalsy();
    expect(main.cases).toHaveLength(1);
    expect(main.cases[0].source).toBe("callsite");
    expect(main.cases[0].argAbs.map(formatShape)).toEqual(["1", "2"]);
    expect(formatShape(main.cases[0].abs)).toBe("3");

    // 同文件其他函数不经模块路误染：名字对不上 → 保持 entry-only
    const helper = result.functions.find((f) => f.name === "helper")!;
    expect(helper).toBeDefined();
    expect(helper.entryOnly).toBe(true);
  });

  it("does not attribute module-targeted records to functions in multi-export files", () => {
    const source = `
function alpha(x) { return x; }
function beta(x) { return x; }
module.exports = { alpha, beta };
`;
    const external = [
      absRec({
        fnName: "gamma",
        argAbs: [litAbs(1)],
        resultAbs: litAbs(1),
        throwsAbs: neverAbs(),
        callLoc: { line: 4, column: 0 },
        targetModule: "/test/multi-export.js",
        targetExport: "gamma",
      }),
    ];
    const result = analyzeFile("/test/multi-export.js", source, undefined, external);
    for (const name of ["alpha", "beta"]) {
      const fn = result.functions.find((f) => f.name === name)!;
      expect(fn).toBeDefined();
      expect(fn.entryOnly).toBe(true);
      expect(fn.cases[0].source).toBeUndefined();
    }
  });

  it("skips resultType=never records without throws and falls back to entry-only synthesis", () => {
    const source = `
function parseChunked(emitter) {
  return emitter;
}
`;
    // 高阶 async（new Promise(async …)）求值中断的信号泄漏：resultType=never
    // 且 throws=never，无任何信息 → 跳过
    const external = [
      absRec({
        fnName: "parseChunked",
        argAbs: [objAbs({})],
        resultAbs: neverAbs(),
        throwsAbs: neverAbs(),
        callLoc: { line: 5, column: 0 },
        targetModule: "/test/higher-order.js",
        targetExport: "parseChunked",
      }),
    ];
    const result = analyzeFile("/test/higher-order.js", source, undefined, external);
    const fn = result.functions.find((f) => f.name === "parseChunked")!;
    expect(fn).toBeDefined();
    expect(fn.entryOnly).toBe(true);
    expect(fn.cases).toHaveLength(1);
    expect(fn.cases[0].source).toBeUndefined();
    expect(fn.cases[0].name).toMatch(/^entry@L\d+$/);
  });

  it("keeps throwing-call records whose resultType is never but throws carries the thrown type", () => {
    const source = `
function fail(msg) {
  throw new Error(msg);
}
`;
    // resultType=never 但 throws≠never：真实的抛出调用，argTypes/throws 均有信息
    const external = [
      absRec({
        fnName: "fail",
        argAbs: [litAbs("boom")],
        resultAbs: neverAbs(),
        throwsAbs: str(),
        callLoc: { line: 7, column: 0 },
        targetModule: "/test/throwing.js",
        targetExport: "fail",
      }),
    ];
    const result = analyzeFile("/test/throwing.js", source, undefined, external);
    const fn = result.functions.find((f) => f.name === "fail")!;
    expect(fn).toBeDefined();
    expect(fn.entryOnly).toBeFalsy();
    expect(fn.cases).toHaveLength(1);
    expect(fn.cases[0].source).toBe("callsite");
    expect(fn.cases[0].argAbs.map(formatShape)).toEqual(['"boom"']);
    expect(fn.cases[0].abs.shape.k).toBe("never");
    expect(formatShape(fn.cases[0].throwsAbs)).toBe("string");
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

  // 来源：IDE 深度批次——union 接收者的 dot 补全不再返回空
  // Abs：同 key 集对象 join 会字段合并；异 key 集保持 sum（与 TypeValue union 同形）
  it("completes only members common to every union member, with per-member type detail", () => {
    const source = [
      `const a = { x: 1, y: 9 };`,
      `const b = { x: 2 };`,
      `const u = Math.random() > 0.5 ? a : b;`,
      `u.x;`,
    ].join("\n");
    const completions = getCompletionsAtPosition("/test/union.js", source, 4, 2);
    const names = completions.map((c) => c.label);
    expect(names).toContain("x");
    // y 只存在于 a：非公共成员不得出现在补全里
    expect(names).not.toContain("y");
    // detail 是各成员上该成员类型的并集渲染
    const x = completions.find((c) => c.label === "x");
    expect(x?.kind).toBe("property");
    expect(x?.detail).toBe("1 | 2");
  });

  it("returns empty completions for a union with no common members", () => {
    const source = [
      `const c1 = { p: 1 };`,
      `const c2 = { q: 2 };`,
      `const u = Math.random() > 0.5 ? c1 : c2;`,
      `u.a;`,
    ].join("\n");
    const completions = getCompletionsAtPosition("/test/union-empty.js", source, 4, 2);
    expect(completions).toEqual([]);
  });

  // 来源：IDE 深度批次——内置方法 detail 不再硬编码，取 evaluator 真实 fnSig
  it("derives array method detail from the evaluator instead of hardcoding", () => {
    const source = `const arr = [1, 2, 3];\narr.map;\n`;
    const completions = getCompletionsAtPosition("/test/arr-sig.js", source, 2, 4);
    // Array.prototype.map 的近似签名：(_arg0: unknown) => unknown[]
    expect(completions.find((c) => c.label === "map")?.detail).toBe("(_arg0: unknown) => unknown[]");
    expect(completions.find((c) => c.label === "join")?.detail).toBe("(_arg0: string) => string");
    // 字面量 [1,2,3] 求值为 tuple：length 是精确字面量
    expect(completions.find((c) => c.label === "length")?.detail).toBe("3");
    // 抽象 array（filter 结果）的 length 回到 number
    const widened = getCompletionsAtPosition(
      "/test/arr-wide.js",
      `const arr = [1, "a"].filter(() => Math.random() > 0.5);\narr.m;\n`,
      2,
      4,
    );
    expect(widened.find((c) => c.label === "length")?.detail).toBe("number");
  });

  it("derives tuple length and string/promise method detail from the evaluator", () => {
    const tuple = getCompletionsAtPosition("/test/tuple.js", `const pair = [1, "a"];\npair.x;\n`, 2, 5);
    expect(tuple.find((c) => c.label === "length")?.detail).toBe("2");

    // [1,2].join("-") 推断出 primitive string（字面量接收者不走 string 分支）
    const str = getCompletionsAtPosition("/test/str.js", `const s = [1, 2].join("-");\ns.to;\n`, 2, 2);
    expect(str.find((c) => c.label === "toUpperCase")?.detail).toBe("() => string");
    expect(str.find((c) => c.label === "slice")?.detail).toBe("(_arg0: number, _arg1: number) => string");

    const promise = getCompletionsAtPosition("/test/promise.js", `const p = Promise.resolve(1);\np.then;\n`, 2, 2);
    expect(promise.find((c) => c.label === "then")?.detail).toBe("(_arg0: unknown) => promise<unknown>");
    // 派生自求值器原型近似表：含建模过的 Object.prototype 继承方法 toString
    expect(promise.map((c) => c.label).sort()).toEqual(["catch", "finally", "then", "toString"]);
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

// 来源：LSP 隔离控制工程化——buildModuleGraph mtime 边缓存
describe("buildModuleGraph mtime 边缓存", () => {
  const tmpWrite = (dir: string, name: string, content: string) => {
    const path = resolve(dir, name);
    writeFileSync(path, content);
    return path;
  };

  it("同输入带/不带 cache 结果一致（含二次全命中）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-graph-cache-"));
    try {
      const a = tmpWrite(dir, "a.js", `import { b } from "./b.js";\n`);
      const b = tmpWrite(dir, "b.js", `import { c } from "./c.js";\n`);
      const c = tmpWrite(dir, "c.js", `export const c = 1;\n`);
      const plain = buildModuleGraph([a, b, c]);
      const cache: ModuleGraphCache = new Map();
      const once = buildModuleGraph([a, b, c], cache);
      const twice = buildModuleGraph([a, b, c], cache); // 第二次全命中
      const normalize = (g: { imports: Map<string, Set<string>>; dependents: Map<string, Set<string>> }) =>
        JSON.stringify({
          imports: [...g.imports].map(([k, v]) => [k, [...v].sort()]),
          dependents: [...g.dependents].map(([k, v]) => [k, [...v].sort()]),
        });
      expect(normalize(once)).toBe(normalize(plain));
      expect(normalize(twice)).toBe(normalize(plain));
      expect(cache.size).toBe(3); // 三个文件均回填缓存
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("内容变化（size 改变）后失效重读并回填", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-graph-cache-"));
    try {
      const a = tmpWrite(dir, "a.js", `import { b } from "./b.js";\n`);
      const b = tmpWrite(dir, "b.js", `export const b = 1;\n`);
      const d = tmpWrite(dir, "d.js", `export const d = 1;\n`);
      const cache: ModuleGraphCache = new Map();
      const before = buildModuleGraph([a, b, d], cache);
      expect(before.imports.get(a)).toEqual(new Set([b]));
      // 改为同时导入 b、d：size 变化必然导致缓存失效
      writeFileSync(a, `import { b } from "./b.js";\nimport { d } from "./d.js";\n`);
      const after = buildModuleGraph([a, b, d], cache);
      expect(after.imports.get(a)).toEqual(new Set([b, d]));
      expect(new Set(cache.get(a)!.edges)).toEqual(new Set([b, d]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("仅 mtime 变化（size 不变）后失效重读", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-graph-cache-"));
    try {
      const a = tmpWrite(dir, "a.js", `import { v } from "./b.js";\n`);
      const b = tmpWrite(dir, "b.js", `export const v = 1;\n`);
      const c = tmpWrite(dir, "c.js", `export const v = 2;\n`);
      const cache: ModuleGraphCache = new Map();
      expect(buildModuleGraph([a, b, c], cache).imports.get(a)).toEqual(new Set([b]));
      // 同尺寸内容换成导入 c，再用 utimesSync 显式把 mtime 拉开 10s（size 维度保持一致）
      writeFileSync(a, `import { v } from "./c.js";\n`);
      const forced = new Date(cache.get(a)!.mtimeMs + 10_000);
      utimesSync(a, forced, forced);
      const after = buildModuleGraph([a, b, c], cache);
      expect(after.imports.get(a)).toEqual(new Set([c]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("命中时不读盘：文件不可读仍能从 cache 得出正确边", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-graph-cache-"));
    try {
      const a = tmpWrite(dir, "a.js", `import { b } from "./b.js";\n`);
      const b = tmpWrite(dir, "b.js", `export const b = 1;\n`);
      const cache: ModuleGraphCache = new Map();
      buildModuleGraph([a, b], cache);
      chmodSync(a, 0o000); // chmod 不改 mtime → 必命中；statSync 仍可用，readFileSync 将 EACCES
      try {
        const hit = buildModuleGraph([a, b], cache);
        expect(hit.imports.get(a)).toEqual(new Set([b]));
        expect(hit.dependents.get(b)).toEqual(new Set([a]));
        // 对照：不带 cache 必须读盘，EACCES 下抽不出任何边——证明上面的边确实来自缓存
        const miss = buildModuleGraph([a, b]);
        expect(miss.imports.get(a)).toEqual(new Set());
      } finally {
        chmodSync(a, 0o644);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
