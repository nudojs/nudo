import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { T, typeValueEquals, typeValueToString, createEnvironment } from "@nudojs/core";
import { parse, extractDirectives } from "@nudojs/parser";
import { evaluateFunction, evaluateProgram, evaluateFunctionFull, setUnknownCollector, setProvenanceTracking, setCallCollector, setModuleResolver, setCurrentFileDir, type UnknownRecord, type CallRecord } from "../evaluator.ts";

function inferFromSource(source: string) {
  const ast = parse(source);
  const functions = extractDirectives(ast);
  const env = createEnvironment();
  return functions.map((fn) => ({
    name: fn.name,
    cases: fn.directives.map((d) => ({
      caseName: d.name,
      result: evaluateFunction(fn.node, d.args, env),
    })),
  }));
}

describe("End-to-end: calc example from design doc", () => {
  const source = `
/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function calc(a, b) {
  if (a > b) return a - b;
  return a + b;
}
`;

  it("infers concrete case: calc(1, 2) => 3", () => {
    const results = inferFromSource(source);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("calc");
    const concreteCase = results[0].cases[0];
    expect(concreteCase.caseName).toBe("concrete");
    expect(typeValueEquals(concreteCase.result, T.literal(3))).toBe(true);
  });

  it("infers symbolic case: calc(number, number) => number", () => {
    const results = inferFromSource(source);
    const symbolicCase = results[0].cases[1];
    expect(symbolicCase.caseName).toBe("symbolic");
    expect(typeValueEquals(symbolicCase.result, T.number)).toBe(true);
  });
});

describe("End-to-end: subtract example", () => {
  const source = `
/**
 * @nudo:case "positive numbers" (5, 3)
 * @nudo:case "negative result" (1, 10)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function subtract(a, b) {
  return a - b;
}
`;

  it("infers subtract(5, 3) => 2", () => {
    const results = inferFromSource(source);
    const c = results[0].cases[0];
    expect(typeValueEquals(c.result, T.literal(2))).toBe(true);
  });

  it("infers subtract(1, 10) => -9", () => {
    const results = inferFromSource(source);
    const c = results[0].cases[1];
    expect(typeValueEquals(c.result, T.literal(-9))).toBe(true);
  });

  it("infers subtract(number, number) => number", () => {
    const results = inferFromSource(source);
    const c = results[0].cases[2];
    expect(typeValueEquals(c.result, T.number)).toBe(true);
  });
});

describe("End-to-end: typeof narrowing", () => {
  const source = `
/**
 * @nudo:case "with number" (42)
 * @nudo:case "with string" ("hello")
 * @nudo:case "symbolic" (T.union(T.number, T.string))
 */
function describe(x) {
  if (typeof x === "number") return x + 1;
  return x;
}
`;

  it("infers describe(42) => 43", () => {
    const results = inferFromSource(source);
    const c = results[0].cases[0];
    expect(typeValueEquals(c.result, T.literal(43))).toBe(true);
  });

  it("infers describe('hello') => 'hello'", () => {
    const results = inferFromSource(source);
    const c = results[0].cases[1];
    expect(typeValueEquals(c.result, T.literal("hello"))).toBe(true);
  });

  it("infers describe(number | string) => number | string", () => {
    const results = inferFromSource(source);
    const c = results[0].cases[2];
    expect(typeValueToString(c.result)).toBe("number | string");
  });
});

describe("End-to-end: strict equality narrowing", () => {
  const source = `
/**
 * @nudo:case "null case" (null)
 * @nudo:case "number case" (5)
 * @nudo:case "symbolic" (T.union(T.null, T.number))
 */
function safe(x) {
  if (x === null) return 0;
  return x;
}
`;

  it("infers safe(null) => 0", () => {
    const results = inferFromSource(source);
    const c = results[0].cases[0];
    expect(typeValueEquals(c.result, T.literal(0))).toBe(true);
  });

  it("infers safe(5) => 5", () => {
    const results = inferFromSource(source);
    const c = results[0].cases[1];
    expect(typeValueEquals(c.result, T.literal(5))).toBe(true);
  });

  it("infers safe(null | number) => 0 | number", () => {
    const results = inferFromSource(source);
    const c = results[0].cases[2];
    const str = typeValueToString(c.result);
    expect(str === "0 | number" || str === "number | 0").toBe(true);
  });
});

describe("Evaluator: basic expressions", () => {
  it("evaluates arithmetic", () => {
    const ast = parse("1 + 2 * 3");
    const env = createEnvironment();
    const result = evaluateProgram(ast, env);
    expect(typeValueEquals(result, T.literal(7))).toBe(true);
  });

  it("evaluates variable declaration and usage", () => {
    const ast = parse("const x = 10; x + 5;");
    const env = createEnvironment();
    const result = evaluateProgram(ast, env);
    expect(typeValueEquals(result, T.literal(15))).toBe(true);
  });

  it("evaluates ternary expression", () => {
    const ast = parse("true ? 1 : 2");
    const env = createEnvironment();
    const result = evaluateProgram(ast, env);
    expect(typeValueEquals(result, T.literal(1))).toBe(true);
  });

  it("evaluates object literal", () => {
    const ast = parse('const obj = { x: 1, y: "hi" }; obj.x;');
    const env = createEnvironment();
    const result = evaluateProgram(ast, env);
    expect(typeValueEquals(result, T.literal(1))).toBe(true);
  });

  it("evaluates array literal", () => {
    const ast = parse("const arr = [1, 2, 3]; arr.length;");
    const env = createEnvironment();
    const result = evaluateProgram(ast, env);
    expect(typeValueEquals(result, T.literal(3))).toBe(true);
  });

  it("evaluates function call", () => {
    const ast = parse(`
      function add(a, b) { return a + b; }
      add(3, 4);
    `);
    const env = createEnvironment();
    const result = evaluateProgram(ast, env);
    expect(typeValueEquals(result, T.literal(7))).toBe(true);
  });

  it("evaluates arrow function", () => {
    const ast = parse(`
      const double = (x) => x + x;
      double(5);
    `);
    const env = createEnvironment();
    const result = evaluateProgram(ast, env);
    expect(typeValueEquals(result, T.literal(10))).toBe(true);
  });

  it("evaluates logical operators", () => {
    const ast = parse("true && 42");
    const env = createEnvironment();
    const result = evaluateProgram(ast, env);
    expect(typeValueEquals(result, T.literal(42))).toBe(true);

    const ast2 = parse("false || 99");
    const result2 = evaluateProgram(ast2, createEnvironment());
    expect(typeValueEquals(result2, T.literal(99))).toBe(true);
  });

  it("evaluates nullish coalescing", () => {
    const ast = parse("null ?? 42");
    const env = createEnvironment();
    const result = evaluateProgram(ast, env);
    expect(typeValueEquals(result, T.literal(42))).toBe(true);

    const ast2 = parse("1 ?? 42");
    const result2 = evaluateProgram(ast2, createEnvironment());
    expect(typeValueEquals(result2, T.literal(1))).toBe(true);
  });

  it("evaluates unary operators", () => {
    const ast = parse("typeof 42");
    const env = createEnvironment();
    const result = evaluateProgram(ast, env);
    expect(typeValueEquals(result, T.literal("number"))).toBe(true);

    const ast2 = parse("!true");
    const result2 = evaluateProgram(ast2, createEnvironment());
    expect(typeValueEquals(result2, T.literal(false))).toBe(true);

    const ast3 = parse("-5");
    const result3 = evaluateProgram(ast3, createEnvironment());
    expect(typeValueEquals(result3, T.literal(-5))).toBe(true);
  });

  it("evaluates template literal", () => {
    const ast = parse("`hello`");
    const env = createEnvironment();
    const result = evaluateProgram(ast, env);
    expect(typeValueEquals(result, T.literal("hello"))).toBe(true);
  });

  it("collects method dispatch failure on number receiver via setUnknownCollector", () => {
    const ast = parse("function f(n) { return n.toUpperCase(); }");
    const fnNode = (ast.program.body as any[]).find((s) => s.type === "FunctionDeclaration");
    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    try {
      const result = evaluateFunctionFull(fnNode, [T.number], createEnvironment());
      // Evaluation behavior unchanged: still degrades to unknown
      expect(result.value.kind).toBe("unknown");
      const methodRecords = records.filter((r) => r.kind === "method");
      expect(methodRecords.length).toBeGreaterThanOrEqual(1);
      const rec = methodRecords.find((r) => r.name === "toUpperCase");
      expect(rec).toBeDefined();
      expect(rec!.receiverType?.kind).toBe("primitive");
      expect((rec!.receiverType as any).type).toBe("number");
      expect(rec!.reason).toBe("no method 'toUpperCase' on primitive");
      expect(rec!.loc).toBeDefined();
      expect(typeof rec!.loc!.line).toBe("number");
      expect(typeof rec!.loc!.column).toBe("number");
    } finally {
      setUnknownCollector(null);
    }
  });

  it("collects method dispatch failure even when receiver is unknown", () => {
    const ast = parse("function f(n) { return n.toUpperCase(); }");
    const fnNode = (ast.program.body as any[]).find((s) => s.type === "FunctionDeclaration");
    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    try {
      const result = evaluateFunctionFull(fnNode, [T.unknown], createEnvironment());
      expect(result.value.kind).toBe("unknown");
      const rec = records.find((r) => r.kind === "method" && r.name === "toUpperCase");
      expect(rec).toBeDefined();
      expect(rec!.receiverType?.kind).toBe("unknown");
    } finally {
      setUnknownCollector(null);
    }
  });

  it("does not record method failures for valid string methods", () => {
    const ast = parse('function g(s) { return s.toUpperCase(); }');
    const fnNode = (ast.program.body as any[]).find((s) => s.type === "FunctionDeclaration");
    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    try {
      const result = evaluateFunctionFull(fnNode, [T.string], createEnvironment());
      expect(typeValueEquals(result.value, T.string)).toBe(true);
      expect(records.filter((r) => r.name === "toUpperCase")).toHaveLength(0);
    } finally {
      setUnknownCollector(null);
    }
  });

  it("collects unknown global identifiers as kind 'global'", () => {
    const ast = parse("function h() { return Foo(); }");
    const fnNode = (ast.program.body as any[]).find((s) => s.type === "FunctionDeclaration");
    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    try {
      evaluateFunctionFull(fnNode, [], createEnvironment());
      const rec = records.find((r) => r.kind === "global" && r.name === "Foo");
      expect(rec).toBeDefined();
      expect(rec!.reason).toBe("unknown global identifier 'Foo'");
    } finally {
      setUnknownCollector(null);
    }
  });

  it("behaves identically without a collector installed (regression)", () => {
    const ast = parse("function f(n) { return n.toUpperCase(); }");
    const fnNode = (ast.program.body as any[]).find((s) => s.type === "FunctionDeclaration");
    setUnknownCollector(null);
    const result = evaluateFunctionFull(fnNode, [T.number], createEnvironment());
    expect(result.value.kind).toBe("unknown");
  });

  it("attaches origin pointing at the call-site argument when provenance tracking is enabled", () => {
    // 42 is on line 5, column 20 (0-based) of this source.
    const source = `
function badNum(n) {
  return n.toUpperCase();
}
const boom = badNum(42);
`;
    const ast = parse(source);
    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    setProvenanceTracking(true);
    try {
      evaluateProgram(ast, createEnvironment());
      const rec = records.find((r) => r.kind === "method" && r.name === "toUpperCase");
      expect(rec).toBeDefined();
      expect(rec!.receiverType?.kind).toBe("literal");
      expect((rec!.receiverType as any).value).toBe(42);
      expect(rec!.origin).toEqual({ line: 5, column: 20 });
    } finally {
      setProvenanceTracking(false);
      setUnknownCollector(null);
    }
  });

  it("emits no origin when provenance tracking is disabled (default)", () => {
    const source = `
function badNum(n) {
  return n.toUpperCase();
}
const boom = badNum(42);
`;
    const ast = parse(source);
    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    setProvenanceTracking(false);
    try {
      evaluateProgram(ast, createEnvironment());
      const rec = records.find((r) => r.kind === "method" && r.name === "toUpperCase");
      expect(rec).toBeDefined();
      expect(rec!.origin).toBeUndefined();
    } finally {
      setUnknownCollector(null);
    }
  });

  it("tags call records of imported functions with targetModule/targetExport", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-export-tag-"));
    try {
      const bPath = join(dir, "b.js");
      const aPath = join(dir, "a.js");
      writeFileSync(bPath, "export function triple(x) { return x * 3; }\n");
      writeFileSync(
        aPath,
        'import { triple } from "./b.js";\nfunction localQuad(y) { return y * 4; }\nconst r1 = triple(4);\nconst r2 = localQuad(2);\n',
      );

      setModuleResolver((source) => {
        if (source === "./b.js") {
          return { ast: parse(readFileSync(bPath, "utf8")), filePath: bPath };
        }
        return null;
      });
      setCurrentFileDir(dir);

      const records: CallRecord[] = [];
      setCallCollector((r) => records.push(r));
      try {
        evaluateProgram(parse(readFileSync(aPath, "utf8")), createEnvironment());
      } finally {
        setCallCollector(null);
        setModuleResolver(null);
        setCurrentFileDir("");
      }

      const imported = records.find((r) => r.fnName === "triple");
      expect(imported).toBeDefined();
      expect(imported!.targetModule).toBe(bPath);
      expect(imported!.targetModule).toContain("b.js");
      expect(imported!.targetExport).toBe("triple");
      expect(typeValueEquals(imported!.resultType, T.literal(12))).toBe(true);

      const local = records.find((r) => r.fnName === "localQuad");
      expect(local).toBeDefined();
      expect(local!.targetModule).toBeUndefined();
      expect(local!.targetExport).toBeUndefined();
      expect(typeValueEquals(local!.resultType, T.literal(8))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("types X.prototype on built-in classes as instances without error-level unknowns", () => {
    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    const env = createEnvironment();
    try {
      const ast = parse(`
        const d = Date.prototype;
        const a = Array.prototype;
        const e = Error.prototype;
        const m = Map.prototype;
        const o = Object.prototype;
      `);
      evaluateProgram(ast, env);
    } finally {
      setUnknownCollector(null);
    }

    const cases: Array<[string, string]> = [
      ["d", "Date"],
      ["a", "Array"],
      ["e", "Error"],
      ["m", "Map"],
      ["o", "Object"],
    ];
    for (const [binding, className] of cases) {
      const tv = env.lookup(binding);
      expect(tv.kind).toBe("instance");
      if (tv.kind === "instance") {
        expect(tv.className).toBe(className);
      }
    }
    // Error-level diagnostics come from property/method unknowns with a
    // concrete receiver — there must be none for `.prototype` access.
    expect(records.filter((r) => r.kind === "property" || r.kind === "method")).toEqual([]);
  });

  it("evaluates unrecognized built-in identifiers to unknown (not undefined)", () => {
    const ast = parse(`const u = WeakRef;\n`);
    const env = createEnvironment();
    evaluateProgram(ast, env);
    expect(env.lookup("u").kind).toBe("unknown");
  });

  it("types Object.prototype.toString.call(x) as string and never leaks native JS members", () => {
    const ast = parse(`
      const brand = Object.prototype.toString.call(5);
      const direct = Object.prototype.toString;
      const plain = ({}).toString();
      const mapStr = new Map().toString;
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);
    expect(typeValueToString(env.lookup("brand"))).toBe("string");
    expect(env.lookup("direct").kind).toBe("function");
    expect(typeValueToString(env.lookup("plain"))).toBe("string");
    expect(env.lookup("mapStr").kind).toBe("function");
    // The bug this locks down: property records are plain objects, so bracket
    // access used to return the real native JS toString (a non-TypeValue).
    for (const name of ["brand", "direct", "plain", "mapStr"]) {
      const tv = env.lookup(name) as unknown as { kind?: string };
      expect(typeof tv.kind).toBe("string");
    }
  });

  it("tags call records of require()d CJS functions with targetModule/targetExport", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cjs-tag-"));
    try {
      const bPath = join(dir, "b.js");
      const cPath = join(dir, "c.js");
      const aPath = join(dir, "a.js");
      writeFileSync(bPath, 'function triple(x) { return x * 3; }\nmodule.exports = { triple };\n');
      writeFileSync(cPath, 'module.exports = function (x) { return x; };\n');
      writeFileSync(
        aPath,
        'const b = require("./b");\nconst triple = b.triple;\nconst r1 = triple(4);\nconst id = require("./c");\nconst r2 = id(9);\n',
      );

      setModuleResolver((source) => {
        if (source === "./b") {
          return { ast: parse(readFileSync(bPath, "utf8")), filePath: bPath };
        }
        if (source === "./c") {
          return { ast: parse(readFileSync(cPath, "utf8")), filePath: cPath };
        }
        return null;
      });
      setCurrentFileDir(dir);

      const records: CallRecord[] = [];
      setCallCollector((r) => records.push(r));
      try {
        evaluateProgram(parse(readFileSync(aPath, "utf8")), createEnvironment());
      } finally {
        setCallCollector(null);
        setModuleResolver(null);
        setCurrentFileDir("");
      }

      const named = records.find((r) => r.fnName === "triple");
      expect(named).toBeDefined();
      expect(named!.targetModule).toBe(bPath);
      expect(named!.targetExport).toBe("triple");
      expect(typeValueEquals(named!.resultType, T.literal(12))).toBe(true);

      const main = records.find((r) => r.fnName === "id");
      expect(main).toBeDefined();
      expect(main!.targetModule).toBe(cPath);
      expect(main!.targetExport).toBe("default");
      expect(typeValueEquals(main!.resultType, T.literal(9))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps definition-site attribution through re-export chains and accumulates export aliases", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-reexport-tag-"));
    try {
      const defPath = join(dir, "parse-chunked.js");
      const indexPath = join(dir, "index.js");
      const libPath = join(dir, "lib.js");
      const testPath = join(dir, "test.js");
      writeFileSync(defPath, "module.exports = function (x) { return x + 1; };\n");
      // barrel：属性名转发（jsonext index.js 形态）
      writeFileSync(indexPath, "module.exports = { parseChunked: require('./parse-chunked.js') };\n");
      // CJS 转发 shim（test/helpers/lib.js 形态）
      writeFileSync(libPath, "module.exports = require('./index.js');\n");
      writeFileSync(testPath, "const { parseChunked } = require('./lib.js');\nconst r = parseChunked(4);\n");

      const bySpec = new Map<string, string>([
        ["./lib.js", libPath],
        ["./index.js", indexPath],
        ["./parse-chunked.js", defPath],
      ]);
      setModuleResolver((source) => {
        const p = bySpec.get(source);
        return p ? { ast: parse(readFileSync(p, "utf8")), filePath: p } : null;
      });
      setCurrentFileDir(dir);

      const records: CallRecord[] = [];
      setCallCollector((r) => records.push(r));
      try {
        evaluateProgram(parse(readFileSync(testPath, "utf8")), createEnvironment());
      } finally {
        setCallCollector(null);
        setModuleResolver(null);
        setCurrentFileDir("");
      }

      const rec = records.find((r) => r.fnName === "parseChunked");
      expect(rec).toBeDefined();
      // 归属仍是定义文件，而非中转的 index.js / lib.js
      expect(rec!.targetModule).toBe(defPath);
      expect(rec!.targetModule).not.toBe(indexPath);
      expect(rec!.targetModule).not.toBe(libPath);
      expect(rec!.targetExport).toBe("default");
      // 中转出现的导出名进入 aliases（去重后）
      expect(rec!.targetAliases).toContain("parseChunked");
      expect(typeValueEquals(rec!.resultType, T.literal(5))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("evaluates imported calls identically with no call collector installed (regression)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-export-tag-"));
    try {
      const bPath = join(dir, "b.js");
      const aPath = join(dir, "a.js");
      writeFileSync(bPath, "export function triple(x) { return x * 3; }\n");
      writeFileSync(aPath, 'import { triple } from "./b.js";\nconst r1 = triple(4);\n');

      setModuleResolver((source) => {
        if (source === "./b.js") {
          return { ast: parse(readFileSync(bPath, "utf8")), filePath: bPath };
        }
        return null;
      });
      setCurrentFileDir(dir);

      try {
        const env = createEnvironment();
        evaluateProgram(parse(readFileSync(aPath, "utf8")), env);
        expect(typeValueEquals(env.lookup("r1"), T.literal(12))).toBe(true);
      } finally {
        setModuleResolver(null);
        setCurrentFileDir("");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("terminates self-recursive functions via the call-depth budget instead of overflowing the stack", () => {
    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    const env = createEnvironment();
    try {
      // Isomorphic to hoek's clone(): under abstract args `seen.has(obj)`
      // cannot concretely short-circuit, so the recursion must be cut off by
      // MAX_CALL_DEPTH and soundly degrade to unknown.
      evaluateProgram(parse(`
        function clone(obj, seen = new Map()) {
          if (obj === null) return obj;
          if (seen.has(obj)) return obj;
          return clone(obj, seen);
        }
        const c = clone({ a: 1 });
      `), env);
    } finally {
      setUnknownCollector(null);
    }

    const c = env.lookup("c");
    const members = c.kind === "union" ? c.members : [c];
    expect(members.some((m) => m.kind === "unknown")).toBe(true);
    expect(records.some((r) => r.kind === "global" && r.name === "recursion:clone")).toBe(true);
  });

  it("supports Function.prototype.call/apply/bind on function values", () => {
    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    const env = createEnvironment();
    try {
      evaluateProgram(parse(`
        function fn(x) { return x * 2; }
        const a = fn.call(null, 5);
        const b = fn.apply(null, [6]);
        const g = fn.bind(null, 7);
      `), env);
    } finally {
      setUnknownCollector(null);
    }

    expect(typeValueEquals(env.lookup("a"), T.literal(10))).toBe(true);
    expect(typeValueEquals(env.lookup("b"), T.literal(12))).toBe(true);
    // bind approximates to the original function value
    expect(env.lookup("g").kind).toBe("function");
    expect(records.filter((r) => r.kind === "method" || r.kind === "property")).toEqual([]);
  });

  it("types Object.prototype.toString.call(obj) as string without error-level unknowns", () => {
    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    const env = createEnvironment();
    try {
      evaluateProgram(parse(`
        const s = Object.prototype.toString.call({ a: 1 });
        const u = Object.prototype.toString.call(5);
      `), env);
    } finally {
      setUnknownCollector(null);
    }

    expect(typeValueEquals(env.lookup("s"), T.string)).toBe(true);
    expect(typeValueEquals(env.lookup("u"), T.string)).toBe(true);
    expect(records.filter((r) => r.kind === "method" || r.kind === "property")).toEqual([]);
  });

  it("analyzes deep non-recursive call chains within the depth budget", () => {
    // 50 alternating a->b->a calls plus the leaf: depth 51 <= MAX_CALL_DEPTH,
    // so nothing is truncated and the concrete result survives exactly.
    const pairs = 25;
    let source = "function leaf(x) { return x * 2; }\n";
    for (let i = 0; i < pairs; i++) {
      source += `function a${i}(x) { return b${i}(x); }\n`;
      source += `function b${i}(x) { return ${i < pairs - 1 ? `a${i + 1}` : "leaf"}(x); }\n`;
    }
    source += "const deep = a0(5);\n";

    const env = createEnvironment();
    evaluateProgram(parse(source), env);
    expect(typeValueEquals(env.lookup("deep"), T.literal(10))).toBe(true);
  });

  it("binds the receiver of obj.f() as the callee's this", () => {
    const env = createEnvironment();
    evaluateProgram(parse(`
      const o = { n: 1 };
      o.f = function () { return this.n; };
      const r1 = o.f();
      const o2 = { n: 2, f() { return this.n; } };
      const r2 = o2.f();
    `), env);
    expect(typeValueEquals(env.lookup("r1"), T.literal(1))).toBe(true);
    expect(typeValueEquals(env.lookup("r2"), T.literal(2))).toBe(true);
  });

  it("passes the thisArg of f.call(obj, ...) into the callee", () => {
    const env = createEnvironment();
    evaluateProgram(parse(`
      function g() { return this.n; }
      const r = g.call({ n: 5 });
    `), env);
    expect(typeValueEquals(env.lookup("r"), T.literal(5))).toBe(true);
  });

  it("degrades unbound this to unknown (not undefined) in receiver-less calls", () => {
    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    const env = createEnvironment();
    try {
      // this-style function called without a receiver (as in a
      // callsite-synthesized entry case): `this.x` must degrade to
      // unknown-receiver records (warnings), never "on type 'undefined'".
      evaluateProgram(parse(`
        function push() {
          this.push(this._stack.value);
          return 1;
        }
        const r = push();
      `), env);
    } finally {
      setUnknownCollector(null);
    }
    expect(typeValueEquals(env.lookup("r"), T.literal(1))).toBe(true);
    const receiverKinds = records
      .filter((r) => r.kind === "method" || r.kind === "property")
      .map((r) => r.receiverType?.kind);
    expect(receiverKinds.length).toBeGreaterThan(0);
    expect(receiverKinds.every((k) => k === "unknown")).toBe(true);
  });

  it("keeps constructor this bindings intact for new expressions", () => {
    const env = createEnvironment();
    evaluateProgram(parse(`
      class A { constructor() { this.x = 42; } }
      const a = new A();
      const r = a.x;
    `), env);
    expect(typeValueEquals(env.lookup("r"), T.literal(42))).toBe(true);
  });
});
