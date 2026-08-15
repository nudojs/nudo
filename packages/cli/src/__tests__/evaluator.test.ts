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
});
