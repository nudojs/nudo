// case-emitter.test.ts — packages/service/src/case-emitter.ts 的测试。
// 该模块为新建（调用点固化：序列化合成 case、剥离/插入 @nudo:case 指令、
// unified diff），此前无既有测试归属文件，故独立成文件。
import { describe, it, expect } from "vitest";
import {
  type Abs,
  abs as makeAbs,
  lit as termLit,
  num,
  str,
  bool,
  numLit,
  strLit,
  absFunction,
  joinAbs,
  litValue,
  formatShape,
} from "@nudojs/core";
import { parse, extractDirectives, parseTypeValueExpr, type CaseDirective } from "@nudojs/parser";
import {
  serializeCaseArg,
  buildCaseDirective,
  stripGeneratedCaseDirectives,
  insertGeneratedCaseDirectives,
  unifiedDiff,
} from "../case-emitter.ts";
import { analyzeFile, type AnalysisResult, type FunctionAnalysis } from "../analyzer.ts";

function absExact(shape: Abs["shape"]): Abs {
  return makeAbs(shape, undefined, undefined, "exact");
}

function absUnknown(): Abs {
  return makeAbs({ k: "unknown" }, undefined, undefined, "partial");
}

function absNullLit(): Abs {
  return makeAbs({ k: "unknown" }, termLit(null), undefined, "exact");
}

function absUndefLit(): Abs {
  return makeAbs({ k: "unknown" }, termLit(undefined), undefined, "exact");
}

function absLit(v: string | number | boolean | null | undefined): Abs {
  if (typeof v === "number") return numLit(v);
  if (typeof v === "string") return strLit(v);
  if (typeof v === "boolean") return makeAbs({ k: "prim", type: "boolean" }, termLit(v), undefined, "exact");
  if (v === null) return absNullLit();
  return absUndefLit();
}

function absUnion(members: Abs[]): Abs {
  if (members.length === 0) return absExact({ k: "never" });
  return members.reduce((acc, m) => joinAbs(acc, m));
}

function absArr(element: Abs): Abs {
  return absExact({ k: "arr", element });
}

function absTuple(elements: Abs[]): Abs {
  return absExact({ k: "tuple", elements });
}

function absPromise(inner: Abs): Abs {
  return absExact({ k: "eff", eff: "promise", inner });
}

function absObj(properties: Record<string, Abs>): Abs {
  const slots: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(properties)) slots[k] = { value: v };
  return absExact({ k: "obj", slots });
}

function absBrand(name: string): Abs {
  return absExact({ k: "brand", name, shape: absObj({}) });
}

function absPrim(type: "number" | "string" | "boolean" | "bigint" | "symbol"): Abs {
  return absExact({ k: "prim", type });
}

function structurallyEqual(a: Abs, b: Abs): boolean {
  return formatShape(a) === formatShape(b) && Object.is(litValue(a), litValue(b));
}

function dummyFn(): Abs {
  return absFunction(["x"], { body: { type: "BlockStatement", body: [] } as never });
}

function makeFn(
  name: string,
  line: number,
  cases: Array<{ name: string; args: Abs[]; source?: "callsite" }>,
  flags: { skipped?: boolean; noDeclaration?: boolean; entryOnly?: boolean; column?: number } = {},
): FunctionAnalysis {
  return {
    name,
    loc: { start: { line, column: flags.column ?? 0 }, end: { line, column: 0 } },
    paramNames: [],
    cases: cases.map((c) => ({
      name: c.name,
      argAbs: c.args,
      abs: absUnknown(),
      throwsAbs: absExact({ k: "never" }),
      source: c.source,
    })),
    skipped: flags.skipped,
    noDeclaration: flags.noDeclaration,
    entryOnly: flags.entryOnly,
  };
}

function makeAnalysis(functions: FunctionAnalysis[]): AnalysisResult {
  return { functions, diagnostics: [], bindings: new Map(), nodeAbsMap: new Map(), caseHints: [] };
}

describe("serializeCaseArg", () => {
  const matrix: Array<{ label: string; value: Abs }> = [
    { label: "number", value: num() },
    { label: "string", value: str() },
    { label: "boolean", value: bool() },
    { label: "unknown", value: absUnknown() },
    { label: "never", value: absExact({ k: "never" }) },
    { label: "null literal", value: absLit(null) },
    { label: "undefined literal", value: absLit(undefined) },
    { label: "true", value: absLit(true) },
    { label: "false", value: absLit(false) },
    { label: "integer literal", value: absLit(0) },
    { label: "negative float literal", value: absLit(-1.5) },
    { label: "plain string", value: absLit("hello") },
    { label: "string with double quote", value: absLit('a"b') },
    { label: "string with single quote", value: absLit("a'b") },
    { label: "string with backslash", value: absLit("a\\b") },
    { label: "string with colon (value position is safe)", value: absLit("2024-01-01T10:00:00") },
    { label: "string with arrow", value: absLit("a=>b") },
    { label: "union", value: absUnion([num(), str()]) },
    { label: "union of literals", value: absUnion([absLit(1), absLit("x")]) },
    { label: "array", value: absArr(num()) },
    { label: "tuple", value: absTuple([absLit(1), absLit("x")]) },
    { label: "empty tuple", value: absTuple([]) },
    { label: "object", value: absObj({ a: absLit(1), b: str() }) },
    { label: "empty object", value: absObj({}) },
    { label: "non-identifier object key", value: absObj({ "a-b": num() }) },
    { label: "space object key", value: absObj({ "a b": num() }) },
    {
      label: "nested containers",
      value: absObj({
        list: absArr(absUnion([num(), absLit(null)])),
        pair: absTuple([str(), bool()]),
      }),
    },
  ];

  it("serializes every shape in the grammar matrix", () => {
    expect(serializeCaseArg(num())).toBe("T.number");
    expect(serializeCaseArg(absLit(1))).toBe("1");
    expect(serializeCaseArg(absLit("hi"))).toBe('"hi"');
    expect(serializeCaseArg(absLit('a"b'))).toBe("'a\"b'");
    expect(serializeCaseArg(absLit("a'b"))).toBe('"a\'b"');
    expect(serializeCaseArg(absArr(num()))).toBe("T.array(T.number)");
    expect(serializeCaseArg(absTuple([absLit(1), absLit(2)]))).toBe("[1, 2]");
    expect(serializeCaseArg(absTuple([]))).toBe("[]");
    expect(serializeCaseArg(absObj({ a: absLit(1) }))).toBe("{ a: 1 }");
    expect(serializeCaseArg(absObj({}))).toBe("{}");
    expect(serializeCaseArg(absObj({ "a-b": str() }))).toBe('{ "a-b": T.string }');
    expect(serializeCaseArg(absUnion([num(), str()]))).toBe("T.union(T.number, T.string)");
  });

  it("round-trips through parseTypeValueExpr: equivalent parse and idempotent serialize", () => {
    for (const { label, value } of matrix) {
      const s = serializeCaseArg(value);
      expect(s, label).not.toBeNull();
      const parsed = parseTypeValueExpr(s!);
      // 性质 1：serialize(parse(serialize(x))) === serialize(x)
      expect(serializeCaseArg(parsed), label).toBe(s);
      // 性质 2：parse 结果与原值结构等价（shape / 字面量值）
      expect(structurallyEqual(parsed, value), label).toBe(true);
    }
  });

  it("returns null for kinds the grammar cannot express, including nested", () => {
    const nulls: Array<{ label: string; value: Abs }> = [
      { label: "bigint", value: absPrim("bigint") },
      { label: "symbol", value: absPrim("symbol") },
      { label: "function", value: dummyFn() },
      { label: "promise", value: absPromise(num()) },
      { label: "instance", value: absBrand("Error") },
      { label: "array of promise", value: absArr(absPromise(num())) },
      { label: "tuple with instance", value: absTuple([absBrand("Date")]) },
      { label: "object with bigint", value: absObj({ n: absPrim("bigint") }) },
      { label: "union with symbol", value: absUnion([num(), absPrim("symbol")]) },
      { label: "object with function value", value: absObj({ cb: dummyFn() }) },
    ];
    for (const { label, value } of nulls) {
      expect(serializeCaseArg(value), label).toBeNull();
    }
  });

  it("returns null for string/number literals that cannot survive the round-trip", () => {
    // 两种引号并存：文法无转义机制，无法安全包裹
    expect(serializeCaseArg(absLit(`a"b'c`))).toBeNull();
    // 结构字符：破坏参数切分 / 括号配对 / 对象键冒号定位 / JSDoc 终止
    expect(serializeCaseArg(absLit("a,b"))).toBeNull();
    expect(serializeCaseArg(absLit("a(b"))).toBeNull();
    expect(serializeCaseArg(absLit("a}b"))).toBeNull();
    expect(serializeCaseArg(absLit("a*/b"))).toBeNull();
    expect(serializeCaseArg(absLit("a\nb"))).toBeNull();
    // 科学计数法 / 非有限数：文法的数字正则不收
    expect(serializeCaseArg(absLit(NaN))).toBeNull();
    expect(serializeCaseArg(absLit(Infinity))).toBeNull();
    expect(serializeCaseArg(absLit(1e21))).toBeNull();
    expect(serializeCaseArg(absLit(1e-7))).toBeNull();
    // 对象键含双引号 / 冒号 / 首尾引号
    expect(serializeCaseArg(absObj({ 'a"b': num() }))).toBeNull();
    expect(serializeCaseArg(absObj({ "a:b": num() }))).toBeNull();
    expect(serializeCaseArg(absObj({ "'q'": num() }))).toBeNull();
  });
});

describe("buildCaseDirective", () => {
  it("builds a single directive line without trailing newline", () => {
    expect(buildCaseDirective("call@L3", [num(), absLit(1)])).toBe(
      ' * @nudo:case "call@L3" (T.number, 1)',
    );
    expect(buildCaseDirective("x", [])).toBe(' * @nudo:case "x" ()');
  });

  it("propagates unserializable args as null", () => {
    expect(buildCaseDirective("call@L3", [num(), absPromise(str())])).toBeNull();
    expect(buildCaseDirective("call@L3", [absBrand("Error")])).toBeNull();
  });

  it("rejects names the case-name regex cannot carry", () => {
    expect(buildCaseDirective('bad"name', [num()])).toBeNull();
    expect(buildCaseDirective("bad\nname", [num()])).toBeNull();
  });
});


describe("stripGeneratedCaseDirectives", () => {
  it("removes call@ case lines and the orphaned empty JSDoc block", () => {
    const source = `/**
 * @nudo:case "call@L3" (1, 2)
 * @nudo:case "call@L4" (T.string)
 */
function add(a, b) {
  return a + b;
}
`;
    const { source: out, removed } = stripGeneratedCaseDirectives(source);
    expect(removed).toEqual(["call@L3", "call@L4"]);
    expect(out).toBe(`function add(a, b) {
  return a + b;
}
`);
  });

  it("keeps the block when it still has prose or other @nudo directives", () => {
    const source = `/**
 * Adds two numbers.
 * @nudo:case "call@L4" (1, 2)
 * @nudo:pure
 */
function add(a, b) {}
`;
    const { source: out, removed } = stripGeneratedCaseDirectives(source);
    expect(removed).toEqual(["call@L4"]);
    expect(out).toBe(`/**
 * Adds two numbers.
 * @nudo:pure
 */
function add(a, b) {}
`);
  });

  it("never touches hand-written cases or plain comments", () => {
    const source = `/**
 * @nudo:case "manual" (1, 2)
 */
function add(a, b) {}

/* plain block comment */
// @nudo:case "other" (T.number)
const x = 1;
`;
    const { source: out, removed } = stripGeneratedCaseDirectives(source);
    expect(removed).toEqual([]);
    expect(out).toBe(source);
  });

  it("deletes hand-written cases that use the reserved call@ prefix (documented behavior)", () => {
    const source = `/**
 * @nudo:case "call@custom" (1)
 * keep me
 */
function add(a, b) {}
`;
    const { source: out, removed } = stripGeneratedCaseDirectives(source);
    expect(removed).toEqual(["call@custom"]);
    expect(out).toBe(`/**
 * keep me
 */
function add(a, b) {}
`);
  });
});

describe("insertGeneratedCaseDirectives", () => {
  it("skips hand-written cases with priority over everything else", () => {
    const source = `/**
 * @nudo:case "manual" (1)
 */
function add(a, b) {
  return a + b;
}
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([makeFn("add", 4, [{ name: "call@L9", args: [num()], source: "callsite" }])]),
    );
    expect(result.changed).toBe(false);
    expect(result.written).toEqual([]);
    expect(result.skipped).toEqual([{ fn: "add", reason: "hand-written" }]);
    expect(result.source).toBe(source);
  });

  it("skips functions that already carry generated directives", () => {
    const source = `/**
 * @nudo:case "call@L2" (1)
 */
function add(a, b) {
  return a + b;
}
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([makeFn("add", 4, [{ name: "call@L9", args: [num()], source: "callsite" }])]),
    );
    expect(result.changed).toBe(false);
    expect(result.skipped).toEqual([{ fn: "add", reason: "already-generated" }]);
    expect(result.source).toBe(source);
  });

  it("skips flagged functions: skipped / noDeclaration / entryOnly", () => {
    const source = `function a(x) { return x; }
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([
        makeFn("a", 1, [{ name: "call@L1", args: [num()], source: "callsite" }], { skipped: true }),
        makeFn("b", 1, [{ name: "call@L1", args: [num()], source: "callsite" }], { noDeclaration: true }),
        makeFn("c", 1, [{ name: "entry@L1", args: [absUnknown()] }], { entryOnly: true }),
      ]),
    );
    expect(result.changed).toBe(false);
    expect(result.skipped).toEqual([
      { fn: "a", reason: "skipped" },
      { fn: "b", reason: "no-declaration" },
      { fn: "c", reason: "entry-only" },
    ]);
  });

  it("skips the whole function when no callsite case is serializable", () => {
    const source = `function add(a, b) {
  return a + b;
}
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([
        makeFn("add", 1, [
          { name: "call@L2", args: [absPromise(num())], source: "callsite" },
          { name: "call@L3", args: [absBrand("Error")], source: "callsite" },
        ]),
      ]),
    );
    expect(result.changed).toBe(false);
    expect(result.written).toEqual([]);
    expect(result.skipped).toEqual([
      { fn: "add", reason: "no-serializable-cases", detail: "case call@L2 not serializable" },
      { fn: "add", reason: "no-serializable-cases", detail: "case call@L3 not serializable" },
    ]);
    expect(result.source).toBe(source);
  });

  it("writes the serializable subset and records dropped cases individually", () => {
    const source = `function add(a, b) {
  return a + b;
}
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([
        makeFn("add", 1, [
          { name: "call@L2", args: [num(), absLit(2)], source: "callsite" },
          { name: "call@L3", args: [absPromise(num())], source: "callsite" },
        ]),
      ]),
    );
    expect(result.changed).toBe(true);
    expect(result.written).toEqual([{ fn: "add", cases: ["call@L2"] }]);
    expect(result.skipped).toEqual([
      { fn: "add", reason: "no-serializable-cases", detail: "case call@L3 not serializable" },
    ]);
    expect(result.source).toBe(`/**
 * @nudo:case "call@L2" (T.number, 2)
 */
function add(a, b) {
  return a + b;
}
`);
  });

  it("reports no-serializable-cases when a function has no callsite cases at all", () => {
    const source = `function add(a, b) {
  return a + b;
}
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([makeFn("add", 1, [{ name: "entry@L1", args: [] }])]),
    );
    expect(result.changed).toBe(false);
    expect(result.skipped).toEqual([
      { fn: "add", reason: "no-serializable-cases", detail: "no callsite cases" },
    ]);
  });

  it("creates a fresh three-line JSDoc block above the declaration", () => {
    const source = `function add(a, b) {
  return a + b;
}
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([
        makeFn("add", 1, [
          { name: "call@L4", args: [num(), str()], source: "callsite" },
          { name: "call@L5", args: [absLit("x")], source: "callsite" },
        ]),
      ]),
    );
    expect(result.source).toBe(`/**
 * @nudo:case "call@L4" (T.number, T.string)
 * @nudo:case "call@L5" ("x")
 */
function add(a, b) {
  return a + b;
}
`);
  });

  it("injects into an existing JSDoc block right after the /** line", () => {
    const source = `/**
 * Adds numbers.
 * @nudo:pure
 */
function add(a, b) {
  return a + b;
}
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([makeFn("add", 5, [{ name: "call@L9", args: [num()], source: "callsite" }])]),
    );
    expect(result.source).toBe(`/**
 * @nudo:case "call@L9" (T.number)
 * Adds numbers.
 * @nudo:pure
 */
function add(a, b) {
  return a + b;
}
`);
  });

  it("indents the new block by the declaration column (babel 0-based)", () => {
    const source = `function outer() {
  function inner(x) {
    return x;
  }
  return inner(1);
}
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([makeFn("inner", 2, [{ name: "call@L5", args: [num()], source: "callsite" }], { column: 2 })]),
    );
    expect(result.source).toBe(`function outer() {
  /**
   * @nudo:case "call@L5" (T.number)
   */
  function inner(x) {
    return x;
  }
  return inner(1);
}
`);
  });

  it("applies multiple function edits bottom-up without line drift", () => {
    const source = `function a1(x) {
  return x;
}
a1(1);

function b2(x) {
  return x;
}
b2("s");
`;
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([
        makeFn("a1", 1, [{ name: "call@L4", args: [num()], source: "callsite" }]),
        makeFn("b2", 6, [{ name: "call@L9", args: [str()], source: "callsite" }]),
      ]),
    );
    expect(result.source).toBe(`/**
 * @nudo:case "call@L4" (T.number)
 */
function a1(x) {
  return x;
}
a1(1);

/**
 * @nudo:case "call@L9" (T.string)
 */
function b2(x) {
  return x;
}
b2("s");
`);
    expect(result.written).toEqual([
      { fn: "a1", cases: ["call@L4"] },
      { fn: "b2", cases: ["call@L9"] },
    ]);
  });

  it("round-trips at source level: inserted directives parse back to equivalent TypeValues", () => {
    const source = `function add(a, b) {
  return a + b;
}
`;
    const argTuple = absObj({ xs: absArr(absUnion([num(), absLit(null)])) });
    const result = insertGeneratedCaseDirectives(
      source,
      makeAnalysis([
        makeFn("add", 1, [{ name: "call@L1", args: [absLit(1), argTuple], source: "callsite" }]),
      ]),
    );
    const fwd = extractDirectives(parse(result.source)).find((f) => f.name === "add")!;
    const caseDirs = fwd.directives.filter((d): d is CaseDirective => d.kind === "case");
    expect(caseDirs.map((d) => d.name)).toEqual(["call@L1"]);
    expect(caseDirs[0].argsAbs).toHaveLength(2);
    expect(litValue(caseDirs[0].argsAbs[0]!)).toBe(1);
    expect(caseDirs[0].argsAbs[1]!.shape.k).toBe("obj");
  });
});

describe("insertGeneratedCaseDirectives with a real analyzeFile result", () => {
  const SOURCE = `function add(a, b) {
  return a + b;
}
const r1 = add(1, 2);
const r2 = add("x", "y");

function unused(u) {
  return u;
}
`;

  it("freezes synthesized callsite cases and skips entry-only functions", () => {
    const analysis = analyzeFile("/test/emit-integration.js", SOURCE);
    const result = insertGeneratedCaseDirectives(SOURCE, analysis);

    expect(result.changed).toBe(true);
    expect(result.written).toEqual([{ fn: "add", cases: ["call@L4", "call@L5"] }]);
    expect(result.skipped.map((s) => s.reason)).toContain("entry-only");

    // 源码级往返：指令可被 parser 解析回等价 TypeValue
    const fwd = extractDirectives(parse(result.source)).find((f) => f.name === "add")!;
    const caseDirs = fwd.directives.filter((d): d is CaseDirective => d.kind === "case");
    expect(caseDirs.map((c) => c.name)).toEqual(["call@L4", "call@L5"]);
    expect(litValue(caseDirs[0].argsAbs[0]!)).toBe(1);
    expect(litValue(caseDirs[0].argsAbs[1]!)).toBe(2);
    expect(litValue(caseDirs[1].argsAbs[0]!)).toBe("x");
    expect(litValue(caseDirs[1].argsAbs[1]!)).toBe("y");
  });

  it("strip(insert(x)) recovers the original source", () => {
    const analysis = analyzeFile("/test/emit-integration.js", SOURCE);
    const { source: emitted } = insertGeneratedCaseDirectives(SOURCE, analysis);
    const { source: recovered, removed } = stripGeneratedCaseDirectives(emitted);
    expect(removed).toEqual(["call@L4", "call@L5"]);
    expect(recovered).toBe(SOURCE);
  });

  it("re-inserting over an already-generated source reports already-generated", () => {
    const analysis = analyzeFile("/test/emit-integration.js", SOURCE);
    const first = insertGeneratedCaseDirectives(SOURCE, analysis);
    const second = insertGeneratedCaseDirectives(first.source, analysis);
    expect(second.changed).toBe(false);
    expect(second.written).toEqual([]);
    expect(second.skipped.map((s) => s.reason)).toContain("already-generated");
  });
});

describe("unifiedDiff", () => {
  it("returns empty string for identical inputs", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n", "f.txt")).toBe("");
  });

  it("formats a single modified line with 3 lines of context", () => {
    const a = ["01", "02", "03", "04", "05", "06", "07", "08"].join("\n");
    const b = ["01", "02", "03", "X4", "05", "06", "07", "08"].join("\n");
    expect(unifiedDiff(a, b, "t.txt")).toBe(
      [`--- a/t.txt`, `+++ b/t.txt`, `@@ -1,7 +1,7 @@`, ` 01`, ` 02`, ` 03`, `-04`, `+X4`, ` 05`, ` 06`, ` 07`, ""].join("\n"),
    );
  });

  it("omits the count when it is exactly 1", () => {
    expect(unifiedDiff("one", "two", "t.txt")).toBe(
      [`--- a/t.txt`, `+++ b/t.txt`, `@@ -1 +1 @@`, `-one`, `+two`, ""].join("\n"),
    );
  });

  it("formats pure insertion with old-side count 0", () => {
    expect(unifiedDiff("x\ny\nz", "new\nx\ny\nz", "t.txt")).toBe(
      [`--- a/t.txt`, `+++ b/t.txt`, `@@ -1,3 +1,4 @@`, `+new`, ` x`, ` y`, ` z`, ""].join("\n"),
    );
  });

  it("formats pure deletion", () => {
    expect(unifiedDiff("a\nb", "a", "t.txt")).toBe(
      [`--- a/t.txt`, `+++ b/t.txt`, `@@ -1,2 +1 @@`, ` a`, `-b`, ""].join("\n"),
    );
  });

  it("splits hunks separated by more than 2*context equal lines", () => {
    const a = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).join("\n");
    const b = a.replace("02", "X2").replace("11", "Y11");
    expect(unifiedDiff(a, b, "t.txt")).toBe(
      [
        `--- a/t.txt`,
        `+++ b/t.txt`,
        `@@ -1,5 +1,5 @@`,
        ` 01`,
        `-02`,
        `+X2`,
        ` 03`,
        ` 04`,
        ` 05`,
        `@@ -8,5 +8,5 @@`,
        ` 08`,
        ` 09`,
        ` 10`,
        `-11`,
        `+Y11`,
        ` 12`,
        "",
      ].join("\n"),
    );
  });
});
