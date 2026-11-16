/**
 * 模块套件：directive 解析面（case/mock/skip/as/import/expected/file-directive）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractFileDirectives, type DirectiveDiag, extractInlineDirectives, extractDirectives, type CaseDirective, runWithDirectiveDiags as runWithDirectiveDiags_____directives_ts, runWithDirectiveDiags as runWithDirectiveDiags_____directives_ts_1, runWithDirectiveDiags as runWithDirectiveDiags_____directives_ts_2, type MockDirective, parseCaseArgExpr } from "../directives.ts";
import { formatShape, extractFileEnvNames, extractMockModuleRecords, litValue, type Abs } from "@nudojs/core";
import { emitDirectiveDiag, runWithDirectiveDiags } from "../directives/diag.ts";
import { parseCaseExpectedAbs, parseAbsExprDiag, parseAbsExpr } from "../directives/case-arg.ts";
import { parseArrowFunctionExpr } from "../directives/expr-scan.ts";
import { parseSinonExpr } from "../directives/mock-expr.ts";

// ---------------------------------------------------------------------------
// 文件级指令（mock-module / import / env）诊断
// ---------------------------------------------------------------------------
function inlineOf(source: string): {
  dirs: ReturnType<typeof extractInlineDirectives>;
  diags: DirectiveDiag[];
} {
  const ast = parse(source);
  const stmt = ast.program.body[0]!;
  const diags: DirectiveDiag[] = [];
  const dirs = extractInlineDirectives(stmt, { diags });
  return { dirs, diags };
}

describe("文件级指令诊断", () => {
  it("mock-module/import/env 的合法与畸形载荷矩阵", () => {
    const bad = fileDiags(`/// @nudo:mock-module axios from ./m.js\nimport axios from "axios";\n`);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.code).toBe("nudo:directive-syntax");
    expect(bad[0]!.message).toContain("Unrecognized @nudo:mock-module form");
    const good = `/// @nudo:mock-module 'axios' from './m.js'\nimport axios from "axios";\n`;
    expect(fileDiags(good)).toEqual([]);
    expect(extractFileDirectives(parse(good), { diags: [] })).toEqual([{ kind: "mock-module", source: "axios", fromPath: "./m.js" }]);

    for (const src of [
      `/* @nudo:import { a } from "./x.nudo.js" */\nexport function f(){}\n`,
      `/**\n * @nudo:import { a } from "./x.nudo.js"\n */\nexport function f(){}\n`,
    ]) {
      const diags = fileDiags(src);
      expect(diags, src).toHaveLength(1);
      expect(diags[0]!.code, src).toBe("nudo:directive-syntax");
      expect(diags[0]!.message, src).toContain("@nudo:import is a file-level directive");
    }
    expect(fileDiags(`/// @nudo:import { a } from "./x.nudo.js"\nexport function f(){}\n`)).toEqual([]);

    for (const src of ["/// @nudo:env\nexport function f(){}", "/// @nudo:env \nexport function f(){}", `/// @nudo:env node";\nexport function f(){}`]) {
      const diags = fileDiags(src);
      expect(diags, src).toHaveLength(1);
      expect(diags[0]!.code, src).toBe("nudo:directive-syntax");
    }
    expect(fileDiags(`/// @nudo:env node";\nexport function f(){}`)[0]!.message).toContain("Unrecognized @nudo:env list");
    const envSrc = `/// @nudo:env node web\nexport function f(){}\n`;
    expect(fileDiags(envSrc)).toEqual([]);
    expect(extractFileDirectives(parse(envSrc), { diags: [] })).toEqual([{ kind: "env", envs: ["node", "web"] }]);
  });
});

describe("@nudo:as 载荷分隔与括号", () => {
  it("括号/空格/嵌套都产出；裸标签与不可识别诊断；标签边界不吞邻近词", () => {
    const cases = [
      { src: "// @nudo:as(string())\nconst value = 1;", shape: "prim" },
      { src: "// @nudo:as number()\nconst value = 1;", shape: "prim" },
      { src: "// @nudo:as(shape({ port: number() }))\nconst value = 1;", shape: "obj" },
    ];
    for (const { src, shape } of cases) {
      const { dirs, diags } = inlineOf(src);
      expect(dirs, src).toHaveLength(1);
      if (dirs[0]!.kind === "as") expect(dirs[0]!.typeAbs.shape.k, src).toBe(shape);
      expect(diags, src).toEqual([]);
    }
    const bare = inlineOf("// @nudo:as\nconst value = 1;");
    expect(bare.dirs).toHaveLength(0);
    expect(bare.diags[0]!.code).toBe("nudo:directive-syntax");
    expect(bare.diags[0]!.message).toContain("@nudo:as requires a type expression");
    const bad = inlineOf("// @nudo:as(T.number)\nconst value = 1;");
    expect(bad.dirs).toHaveLength(1);
    expect(bad.diags[0]!.message).toContain("Unrecognized type expression in @nudo:as");
    for (const tag of ["@nudo:asXYZ", "@nudo:assume", "@nudo:ascii"]) {
      const { dirs, diags } = inlineOf(`// ${tag}\nconst value = 1;`);
      expect(dirs, tag).toHaveLength(0);
      expect(diags, tag).toEqual([]);
    }
  });
});

describe("@nudo:as 尾随注释按词法边界切分", () => {
  it("尾注释只报一条且类型保留；字符串内注释符不算", () => {
    for (const src of [
      "// @nudo:as string()// why\nconst value = 1;",
      "// @nudo:as string() // why\nconst value = 1;",
      "// @nudo:as number()//note\nconst value = 1;",
    ]) {
      const { dirs, diags } = inlineOf(src);
      expect(dirs, src).toHaveLength(1);
      if (dirs[0]!.kind === "as") expect(dirs[0]!.typeAbs.shape.k, src).toBe("prim");
      expect(diags, src).toHaveLength(1);
      expect(diags[0]!.message, src).toContain("Trailing comment in @nudo:as type expression");
    }
    const inString = inlineOf('// @nudo:as lit("a//b")\nconst value = 1;');
    expect(inString.dirs).toHaveLength(1);
    if (inString.dirs[0]!.kind === "as") expect(inString.dirs[0]!.typeAbs.shape.k).toBe("prim");
    expect(inString.diags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// directives inside a malformed @nudo:case must not leak
// ---------------------------------------------------------------------------
function fnDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return diags;
}

function caseExpected(src: string): string | undefined {
  for (const fn of extractDirectives(parse(src), { diags: [] })) {
    for (const d of fn.directives) {
      if (d.kind === "case") return d.expected === undefined ? undefined : formatShape(d.expected);
    }
  }
  return undefined;
}

function skipReturns(src: string): string | undefined {
  for (const fn of extractDirectives(parse(src), { diags: [] })) {
    for (const d of fn.directives) {
      if (d.kind === "skip" && d.returns !== null) return d.returns === undefined ? undefined : formatShape(d.returns);
    }
  }
  return undefined;
}

const caseDirectives = (src: string) =>
  extractDirectives(parse(src), { diags: [] }).flatMap((f) => f.directives.filter((d) => d.kind === "case"));

const MALFORMED_CASE = `/**
 * @nudo:case 'bad' (
 *   @nudo:mock fetch = (u) => ({ ok: true }))
 */
export function f(a) { return fetch(a).ok; }
`;

const WITH_COMMENT = `/**
 * @nudo:case "x" (1) => string() // 期望值是字符串
 */
export function f(a) { return a + 1; }
`;
const WITHOUT_COMMENT = `/**
 * @nudo:case "x" (1) => string()
 */
export function f(a) { return a + 1; }
`;
const SKIP_WITH_COMMENT = `/**
 * @nudo:skip => number() // 期望返回数字
 */
export function f(a) { return a + 1; }
`;
const SKIP_PLAIN = `/**
 * @nudo:skip => number()
 */
export function f(a) { return a + 1; }
`;
const GLUED = `/**
 * @nudo:case"c1" (1, 2)
 */
export function add(a, b) { return a + b; }
`;

describe("畸形 case 参数不得泄漏内部指令", () => {
  it("内部 mock 不成为真指令；畸形名有诊断；合法 case 保持参数", () => {
    expect(extractDirectives(parse(MALFORMED_CASE)).flatMap((f) => f.directives.map((d) => d.kind))).not.toContain("mock");
    expect(fnDiags(MALFORMED_CASE).some((d) => d.message.includes("single-quoted name"))).toBe(true);

    const ok = `/**\n * @nudo:case "ok" (1) => 2\n */\nexport function f(a) { return a + 1; }`;
    expect(extractDirectives(parse(ok)).flatMap((f) => f.directives.map((d) => d.kind))).toEqual(["case"]);
    expect(fnDiags(ok)).toEqual([]);
  });
});

describe("尾随注释不得作废 case 期望值 / skip 返回类型", () => {
  it("case 与 skip 带尾注释仍解析、与无注释一致、零诊断", () => {
    expect(caseExpected(WITH_COMMENT)).toBe("string");
    expect(caseExpected(WITH_COMMENT)).toBe(caseExpected(WITHOUT_COMMENT));
    expect(fnDiags(WITH_COMMENT)).toEqual([]);
    const withString = `/**\n * @nudo:case "x" (1) => shape({ url: string() })\n */\nexport function f(a) { return a; }`;
    expect(fnDiags(withString)).toEqual([]);
    expect(caseExpected(withString)).toContain("url");
    expect(skipReturns(SKIP_WITH_COMMENT)).toBe("number");
    expect(skipReturns(SKIP_WITH_COMMENT)).toBe(skipReturns(SKIP_PLAIN));
    expect(fnDiags(SKIP_WITH_COMMENT)).toEqual([]);
  });
});

describe("粘连标签 @nudo:case\"name\" 的可见性", () => {
  it("粘连形态诊断且不产 case；空格形态正常且静默", () => {
    const diags = fnDiags(GLUED);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("expected a space between '@nudo:case' and the name");
    expect(caseDirectives(GLUED)).toEqual([]);

    const spaced = `/**\n * @nudo:case "c1" (1, 2)\n */\nexport function add(a, b) { return a + b; }`;
    expect(fnDiags(spaced)).toEqual([]);
    expect(caseDirectives(spaced)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// diagnostic dedup identity carries the position
// ---------------------------------------------------------------------------
function extractWithDiags(source: string) {
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(parse(source), { diags });
  return { fns, diags };
}

const EXPECTED_CTX = '@nudo:case "t" => expected';
const withDiags = <T>(fn: () => T): { value: T; diags: DirectiveDiag[] } => {
  const diags: DirectiveDiag[] = [];
  const value = runWithDirectiveDiags_____directives_ts_1(diags, fn);
  return { value, diags };
};

describe("诊断去重身份包含位置", () => {
  it("显式位置/同位置/无位置/块内重复/跨函数/复扫的去重矩阵", () => {
    const different: DirectiveDiag[] = [];
    runWithDirectiveDiags(different, () => {
      emitDirectiveDiag({ code: "nudo:directive-syntax", message: "Malformed @nudo:case: …", at: { line: 2, column: 3 } });
      emitDirectiveDiag({ code: "nudo:directive-syntax", message: "Malformed @nudo:case: …", at: { line: 7, column: 3 } });
    });
    expect(different).toHaveLength(2);
    expect(different.map((d) => d.at)).toEqual([{ line: 2, column: 3 }, { line: 7, column: 3 }]);

    const same: DirectiveDiag[] = [];
    runWithDirectiveDiags(same, () => {
      emitDirectiveDiag({ code: "nudo:directive-syntax", message: "Malformed @nudo:case: …", at: { line: 2, column: 3 } });
      emitDirectiveDiag({ code: "nudo:directive-syntax", message: "Malformed @nudo:case: …", at: { line: 2, column: 3 } });
    });
    expect(same).toHaveLength(1);

    const legacy: DirectiveDiag[] = [];
    runWithDirectiveDiags(legacy, () => {
      emitDirectiveDiag({ code: "nudo:directive-syntax", message: "same text" });
      emitDirectiveDiag({ code: "nudo:directive-syntax", message: "same text" });
    });
    expect(legacy).toHaveLength(1);

    const src = ["/**", " * @nudo:as string()// why", " * @nudo:as string()// why", " */", "const a = 1;", ""].join("\n");
    const stmt = parse(src).program.body[0]!;
    const two: DirectiveDiag[] = [];
    extractInlineDirectives(stmt, { diags: two });
    const trailing = two.filter((d) => d.message.includes("Trailing comment in @nudo:as"));
    expect(trailing).toHaveLength(2);
    expect(trailing[0]!.at!.line).not.toBe(trailing[1]!.at!.line);

    const oneStmt = parse("// @nudo:as string()// why\nconst a = 1;\n").program.body[0]!;
    const once: DirectiveDiag[] = [];
    runWithDirectiveDiags(once, () => {
      extractInlineDirectives(oneStmt);
      extractInlineDirectives(oneStmt);
    });
    expect(once.filter((d) => d.message.includes("Trailing comment in @nudo:as"))).toHaveLength(1);

    const fnSrc = ["/**", " * @nudo:case 't' (1)", " */", "function f(x) { return x; }", "/**", " * @nudo:case 't' (1)", " */", "function g(x) { return x; }", ""].join("\n");
    const diags: DirectiveDiag[] = [];
    extractDirectives(parse(fnSrc), { diags });
    const malformed = diags.filter((d) => d.message.includes("Malformed @nudo:case"));
    expect(malformed).toHaveLength(2);
    expect(malformed[0]!.at!.line).not.toBe(malformed[1]!.at!.line);
  });
});

describe("缺失期望值 / 期望解析失败", () => {
  it("空 => 告警、无 => 静默、合法/续行静默、失败非 unknown、显式 unknown、严格 API", () => {
    const empty = fnDiags(`/** @nudo:case "empty" (1) =>  */\nexport function f(x) { return x; }\n`);
    expect(empty).toHaveLength(1);
    expect(empty[0]!.code).toBe("nudo:directive-syntax");
    expect(empty[0]!.message).toContain("missing expected expression after '=>'");
    expect(fnDiags(`/** @nudo:case "plain" (1) */\nexport function f(x) { return x; }\n`)).toEqual([]);

    const sameLine = `/** @nudo:case "ok" (1) => 999 */\nexport function f(x) { return x; }\n`;
    expect(fnDiags(sameLine)).toEqual([]);
    expect(caseDirectives(sameLine)).toHaveLength(1);
    const nextLine = `/**\n * @nudo:case "multi" (2) =>\n *   4\n */\nexport function f(x) { return x * 2; }\n`;
    expect(fnDiags(nextLine)).toEqual([]);
    expect(caseDirectives(nextLine)).toHaveLength(1);

    const { fns, diags } = extractWithDiags(`/**\n * @nudo:case "malformed" (1) => bogus()\n * @nudo:case "explicit" (1) => unknown\n */\nfunction f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(cases).toHaveLength(2);
    expect(cases[0]!.expected!.shape.k).not.toBe("unknown");
    expect(cases[1]!.expected!.shape.k).toBe("unknown");
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("=> expected") && d.message.includes("bogus()"))).toBe(true);

    const strict: DirectiveDiag[] = [];
    const failed = runWithDirectiveDiags_____directives_ts(strict, () => parseCaseExpectedAbs("bogus()", EXPECTED_CTX));
    expect(failed).toBeUndefined();
    expect(strict).toHaveLength(1);
    expect(strict[0]!.code).toBe("nudo:directive-syntax");
    expect(parseCaseExpectedAbs("1e3", EXPECTED_CTX)).toBeDefined();
    expect(parseCaseExpectedAbs("unknown", EXPECTED_CTX)).toBeDefined();
  });
});

describe("解析失败与显式 unknown 可区分", () => {
  it("失败 never+诊断；as/replace/skip 保 unknown；显式 unknown/any/any() 零诊断", () => {
    const failure = withDiags(() => parseAbsExprDiag("bogus()", EXPECTED_CTX));
    expect(failure.value.shape.k).toBe("never");
    expect(failure.diags).toHaveLength(1);
    expect(failure.diags[0]!.code).toBe("nudo:directive-syntax");
    expect(failure.diags[0]!.message).toContain(EXPECTED_CTX);
    expect(failure.diags[0]!.message).toContain("bogus()");
    for (const ctx of ["@nudo:as", "@nudo:replace", "@nudo:skip =>"]) {
      expect(withDiags(() => parseAbsExprDiag("bogus()", ctx)).value.shape.k, ctx).toBe("unknown");
    }
    for (const expr of ["unknown", "any", "any()"]) {
      const { value, diags } = withDiags(() => parseAbsExprDiag(expr, EXPECTED_CTX));
      expect(value.shape.k, expr).toBe("unknown");
      expect(diags, expr).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// file-level directives in a class / object body are not file scope
// ---------------------------------------------------------------------------
function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

const parserEnvs = (src: string): string[] =>
  extractFileDirectives(parse(src), { diags: [] })
    .filter((d) => d.kind === "env")
    .flatMap((d) => d.envs);

const parserMockModules = (src: string): Array<{ source: string; names?: string[]; fromPath: string }> =>
  extractFileDirectives(parse(src), { diags: [] })
    .filter((d) => d.kind === "mock-module")
    .map((d) => ({ source: d.source, ...(d.names ? { names: d.names } : {}), fromPath: d.fromPath }));

const coreMockModules = (src: string): Array<{ source: string; names?: string[]; fromPath: string }> =>
  extractMockModuleRecords(src).map((r) => ({ source: r.source, ...(r.names ? { names: r.names } : {}), fromPath: r.fromPath }));

const envInClass = `export class A {\n  /// @nudo:env node\n  m() { return 1; }\n}\n`;
const envInObject = `export const o = {\n  /// @nudo:env node\n  m() { return 1; },\n};\n`;
const envInClassField = `export class A {\n  /// @nudo:env node\n  x = 1;\n}\n`;
const mockInClass = `export class A {\n  /// @nudo:mock-module "fs" from "./mock-fs.js"\n  m() { return 1; }\n}\n`;
const envInArray = `export const a = [\n  /// @nudo:env node\n  1,\n];\n`;
const envInObjectPattern = `export const {\n  /// @nudo:env node\n  a,\n} = obj;\n`;
const envInArrayPattern = `export const [\n  /// @nudo:env node\n  a,\n] = arr;\n`;
const mockInArray = `export const a = [\n  /// @nudo:mock-module "fs" from "./mock-fs.js"\n  1,\n];\n`;
const mockInObjectPattern = `export const {\n  /// @nudo:mock-module "fs" from "./mock-fs.js"\n  a,\n} = obj;\n`;
const envInNestedArray = `export const a = [\n  [\n    /// @nudo:env node\n    1,\n  ],\n];\n`;

describe("嵌套体里的文件级指令不提升", () => {
  it("class/对象/字段/数组/两种解构/嵌套数组都拦截；顶层与函数体口径对照", () => {
    const blocked = [
      { name: "class method", src: envInClass, kind: "env" },
      { name: "object method", src: envInObject, kind: "env" },
      { name: "class field", src: envInClassField, kind: "env" },
      { name: "mock-module in class", src: mockInClass, kind: "mock" },
      { name: "array element env", src: envInArray, kind: "env" },
      { name: "object pattern env", src: envInObjectPattern, kind: "env" },
      { name: "array pattern env", src: envInArrayPattern, kind: "env" },
      { name: "mock in array", src: mockInArray, kind: "mock" },
      { name: "mock in object pattern", src: mockInObjectPattern, kind: "mock" },
      { name: "nested array env", src: envInNestedArray, kind: "env" },
    ];
    for (const { name, src, kind } of blocked) {
      const diags = fileDiags(src);
      expect(diags, name).toHaveLength(1);
      expect(diags[0]!.code, name).toBe("nudo:directive-syntax");
      expect(diags[0]!.message, name).toContain("at the top of the file");
      expect(extractFileDirectives(parse(src), { diags: [] }), name).toEqual([]);
      if (kind === "env") expect(extractFileEnvNames(src), name).toEqual([]);
      else expect(extractMockModuleRecords(src), name).toEqual([]);
    }
    for (const { name, src } of [
      { name: "class 上方", src: "/// @nudo:env node\nexport class A { m() { return 1; } }\n" },
      { name: "对象字面量上方", src: "/// @nudo:env node\nexport const o = { a: 1 };\n" },
    ]) {
      expect(fileDiags(src), name).toEqual([]);
      expect(extractFileDirectives(parse(src), { diags: [] }), name).toEqual([{ kind: "env", envs: ["node"] }]);
    }
    const inFn = "export function f() {\n  /// @nudo:env node\n  return 1;\n}\n";
    expect(fileDiags(inFn)).toHaveLength(1);
    expect(fileDiags(inFn)[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(inFn), { diags: [] })).toEqual([]);
  });
});

describe("合法顶层指令不被过度拦截", () => {
  it("文件首 / class 上方 / 对象 / 数组 / 两种解构 / 数组后置都放行且两通道一致", () => {
    const cases = [
      `/// @nudo:env node\nexport function f() { return 1; }\n`,
      `/// @nudo:env node\nexport class A { m() { return 1; } }\n`,
      `/// @nudo:env node\nexport const o = { a: 1 };\n`,
      `/// @nudo:env node\nexport const a = [1, 2];\n`,
      `/// @nudo:env node\nexport const { a, b } = obj;\n`,
      `/// @nudo:env node\nexport const [a, b] = arr;\n`,
      `export const a = [1, 2];\n/// @nudo:env node\n`,
    ];
    for (const src of cases) {
      expect(fileDiags(src), src).toEqual([]);
      expect(parserEnvs(src), src).toEqual(["node"]);
      expect(extractFileEnvNames(src), src).toEqual(["node"]);
    }
  });
});

// ---------------------------------------------------------------------------
// 验收 6：函数级语义不变
// ---------------------------------------------------------------------------

describe("function-level directive semantics are unchanged", () => {
  it("函数体 env 诊断不提升；函数/类方法上的 case 绑定不变；顶层 env 仍放行", () => {
    const src = "export function f() {\n  /// @nudo:env node\n  return 1;\n}\n";
    const diags = fileDiags(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(src)).toEqual([]);

    const withCase = '/// @nudo:env node\n/// @nudo:case "c1" (1) => 2\nexport function f(a) {\n  return a + 1;\n}\n';
    const f = extractDirectives(parse(withCase), { diags: [] }).find((x) => x.name === "f")!;
    expect(f.directives.some((d) => d.kind === "case")).toBe(true);
    expect(parserEnvs(withCase)).toEqual(["node"]);
    expect(extractFileEnvNames(withCase)).toEqual(["node"]);

    const cls = 'export class Calculator {\n  /// @nudo:case "c1" (1, 2) => 3\n  add(a, b) {\n    return a + b;\n  }\n}\n';
    const m = extractDirectives(parse(cls), { diags: [] }).find((x) => x.name === "Calculator.add")!;
    expect(m.directives.some((d) => d.kind === "case")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 验收 7：两条通道逐例一致
// ---------------------------------------------------------------------------

const SAMPLES: Array<{ name: string; src: string }> = [
  {
    name: "class body — method above",
    src: `export class A {\n  /// @nudo:env node\n  m() {\n    return 1;\n  }\n}\n`,
  },
  {
    name: "class body — field above",
    src: `export class A {\n  /// @nudo:env node\n  x = 1;\n}\n`,
  },
  {
    name: "class body — constructor above",
    src: `export class A {\n  /// @nudo:env node\n  constructor() {\n    this.x = 1;\n  }\n}\n`,
  },
  {
    name: "nested class body",
    src: `export class A {\n  static inner = class B {\n    /// @nudo:env node\n    m() {\n      return 1;\n    }\n  };\n}\n`,
  },
  {
    name: "object literal body — method above",
    src: `export const o = {\n  /// @nudo:env node\n  m() {\n    return 1;\n  },\n};\n`,
  },
  {
    name: "object literal body — property above",
    src: `export const o = {\n  /// @nudo:env node\n  a: 1,\n};\n`,
  },
  {
    name: "array literal body — element above",
    src: `export const a = [\n  /// @nudo:env node\n  1,\n];\n`,
  },
  {
    name: "array literal body — nested array above",
    src: `export const a = [\n  [\n    /// @nudo:env node\n    1,\n  ],\n];\n`,
  },
  {
    name: "object pattern body — key above",
    src: `export const {\n  /// @nudo:env node\n  a,\n} = obj;\n`,
  },
  {
    name: "array pattern body — element above",
    src: `export const [\n  /// @nudo:env node\n  a,\n] = arr;\n`,
  },
  {
    name: "function body",
    src: `export function f() {\n  /// @nudo:env node\n  return 1;\n}\n`,
  },
  {
    name: "top of file",
    src: `/// @nudo:env node\nexport function f() {\n  return 1;\n}\n`,
  },
  {
    name: "above a class declaration",
    src: `/// @nudo:env node\nexport class A {\n  m() {\n    return 1;\n  }\n}\n`,
  },
  {
    name: "above an object literal statement",
    src: `/// @nudo:env node\nexport const o = {\n  a: 1,\n};\n`,
  },
  {
    name: "above an array literal statement",
    src: `/// @nudo:env node\nexport const a = [1, 2];\n`,
  },
  {
    name: "above a destructuring declaration",
    src: `/// @nudo:env node\nexport const { a, b } = obj;\n`,
  },
  {
    name: "above an array-destructuring declaration",
    src: `/// @nudo:env node\nexport const [a, b] = arr;\n`,
  },
  {
    name: "top-level switch body",
    src: `export const x = 1;\nswitch (x) {\n  case 1:\n    /// @nudo:env node\n    break;\n  default:\n    break;\n}\n`,
  },
  {
    name: "top-level try block",
    src: `export const x = 1;\ntry {\n  /// @nudo:env node\n  x;\n} catch {\n  x;\n}\n`,
  },
  {
    name: "switch inside a function body",
    src: `export function f(x) {\n  switch (x) {\n    case 1:\n      /// @nudo:env node\n      return 1;\n    default:\n      return 0;\n  }\n}\n`,
  },
  {
    name: "TS interface body",
    src: `interface Foo {\n  /// @nudo:env node\n  a: string;\n}\nexport const x = 1;\n`,
  },
  {
    name: "mock-module above an array element",
    src: `export const a = [\n  /// @nudo:mock-module "fs" from "./mock-fs.js"\n  1,\n];\n`,
  },
  {
    name: "mock-module above a destructuring key",
    src: `export const {\n  /// @nudo:mock-module "fs" from "./mock-fs.js"\n  a,\n} = obj;\n`,
  },
  {
    name: "mock-module at top of file",
    src: `/// @nudo:mock-module "fs" from "./mock-fs.js"\nexport const a = 1;\n`,
  },
];

describe("the parser AST channel and the core text channel agree case by case", () => {
  it.each(SAMPLES.map((s) => [s.name, s.src] as const))(
    "env extraction matches on: %s",
    (_name, src) => {
      expect(parserEnvs(src)).toEqual(extractFileEnvNames(src));
    },
  );

  it.each(SAMPLES.map((s) => [s.name, s.src] as const))(
    "mock-module extraction matches on: %s",
    (_name, src) => {
      expect(parserMockModules(src)).toEqual(coreMockModules(src));
    },
  );
});

// ---------------------------------------------------------------------------
// file-level directives inside a function body are not file scope
// ---------------------------------------------------------------------------
const envInFn = `export function f(a) {\n  /// @nudo:env node\n  return process.pid;\n}\n`;
const mockInFn = `export function f(a) {\n  /// @nudo:mock-module "fs" from "./mock-fs.js"\n  return a;\n}\n`;

describe("函数体内的文件级指令不提升", () => {
  it("env / mock-module 在函数体内都拦截并告警", () => {
    for (const src of [envInFn, mockInFn]) {
      const diags = fileDiags(src);
      expect(diags, src).toHaveLength(1);
      expect(diags[0]!.code, src).toBe("nudo:directive-syntax");
      expect(diags[0]!.message, src).toContain("at the top of the file");
      expect(extractFileDirectives(parse(src), { diags: [] }), src).toEqual([]);
    }
  });

  it("文件头 / 语句之间 / export 行上的顶层指令仍放行", () => {
    const legal = [
      `/// @nudo:env node\nexport function f() { return 1; }\n`,
      `export function g() { return 1; }\n/// @nudo:env node\n`,
      `export /// @nudo:env node\nfunction f() { return 1; }\n`,
    ];
    for (const src of legal) {
      expect(fileDiags(src), src).toEqual([]);
      expect(extractFileDirectives(parse(src), { diags: [] }), src).toEqual([{ kind: "env", envs: ["node"] }]);
    }
  });
});

function extractInlineWithDiags(source: string) {
  const ast = parse(source);
  const stmt = (ast as any).program.body[0];
  const diags: DirectiveDiag[] = [];
  const dirs = extractInlineDirectives(stmt, { diags });
  return { dirs, diags };
}

describe("行内粘连指令诊断", () => {
  it("replaceFoo 告警不产指令；assume 不误伤；合法 as/replace 不回归", () => {
    const glued = extractInlineWithDiags(`/**\n * @nudo:replaceFoo x number()\n */\nconst a = 1;`);
    expect(glued.dirs.filter((d) => d.kind === "replace")).toHaveLength(0);
    expect(glued.diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("Malformed @nudo:replace directive"))).toBe(true);

    const assume = extractInlineWithDiags(`/**\n * @nudo:assume d <= max\n */\nconst a = 1;`);
    expect(assume.dirs.filter((d) => d.kind === "as")).toHaveLength(0);
    expect(assume.diags).toHaveLength(0);

    for (const [line, kind] of [["@nudo:as number()", "as"], ["@nudo:replace x number()", "replace"]] as const) {
      const ok = extractInlineWithDiags(`/**\n * ${line}\n */\nconst a = 1;`);
      expect(ok.dirs.filter((d) => d.kind === kind), line).toHaveLength(1);
      expect(ok.diags, line).toHaveLength(0);
    }
  });
});

const importDiags = (src: string): DirectiveDiag[] =>
  fileDiags(src).filter((d) => d.message.includes("@nudo:import"));

describe("行注释 @nudo:import 位置错位可见", () => {
  it("函数体 / 对象体 / 块注释同位置的 import 都告警且点名文件级", () => {
    const inside = [
      `export function bar(y) {\n  /// @nudo:import { positive } from "./std.nudo.js"\n  return y;\n}\n`,
      `export const conf = {\n  /// @nudo:import { positive } from "./std.nudo.js"\n  port: 1,\n};\n`,
      `export function bar(y) {\n  /** @nudo:import { positive } from "./std.nudo.js" */\n  return y;\n}\n`,
    ];
    for (const src of inside) {
      const diags = importDiags(src);
      expect(diags, src).toHaveLength(1);
      expect(diags[0]!.code, src).toBe("nudo:directive-syntax");
      expect(diags[0]!.message, src).toContain("@nudo:import is a file-level directive");
    }
  });

  it("文件头合法位置与 runWithDirectiveDiags 域内消费一致", () => {
    const top = `/// @nudo:import { positive } from "./std.nudo.js"\n/**\n * @nudo:contract y positive\n */\nexport function bar(y) { return y; }\n`;
    expect(importDiags(top)).toEqual([]);

    const src = `export function bar(y) {\n  /// @nudo:import { positive } from "./std.nudo.js"\n  return y;\n}\n`;
    const inDomain: DirectiveDiag[] = [];
    runWithDirectiveDiags_____directives_ts_2(inDomain, () => {
      extractFileDirectives(parse(src));
    });
    expect(inDomain.filter((d) => d.message.includes("@nudo:import"))).toHaveLength(1);
    expect(extractDirectives(parse(src))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// async arrow payload keeps its async flag
// ---------------------------------------------------------------------------
function mockOf(source: string): MockDirective {
  const fns = extractDirectives(parse(source));
  const mocks = fns.flatMap((f) => f.directives.filter((d): d is MockDirective => d.kind === "mock"));
  expect(mocks).toHaveLength(1);
  return mocks[0]!;
}

const mockDirectives = (src: string) =>
  extractDirectives(parse(src), { diags: [] }).flatMap((f) => f.directives.filter((d) => d.kind === "mock"));

function caseArgs(source: string): Abs[] {
  const fns = extractDirectives(parse(source));
  const d = fns[0]?.directives.find((x) => x.kind === "case");
  if (!d || d.kind !== "case") throw new Error("expected case directive");
  return d.argsAbs;
}

describe("async 标志在全链路保留", () => {
  it("箭头 / async 无参 / async function / 指令 / sinon callsFake 都保留 async", async () => {
    const arrows = [
      { expr: "async (x) => x + 1", async: true, params: ["x"] },
      { expr: "(x) => x + 1", async: false, params: ["x"] },
      { expr: "async () => 1", async: true, params: [] },
      { expr: "async function (x) { return x; }", async: true },
    ];
    for (const { expr, async, params } of arrows) {
      const r = parseArrowFunctionExpr(expr);
      expect(r, expr).not.toBeNull();
      expect(r!.async, expr).toBe(async);
      if (params) expect(r!.params, expr).toEqual(params);
    }

    const asyncMock = mockOf(`/**\n * @nudo:mock f = async (x) => x + 1\n */\nexport function caller() { return f(1); }`);
    expect(asyncMock.arrowFn!.async).toBe(true);
    const syncMock = mockOf(`/**\n * @nudo:mock f = (x) => x + 1\n */\nexport function caller() { return f(1); }`);
    expect(syncMock.arrowFn!.async).toBe(false);

    const { parseNudoMockExpr } = await import("../directives/mock-expr.ts");
    const asyncHelper = parseNudoMockExpr("stub().callsFake(async (x) => x + 1)");
    expect(asyncHelper!.callsFakeImpl!.async).toBe(true);
    const syncHelper = parseNudoMockExpr("stub().callsFake((x) => x + 1)");
    expect(syncHelper!.callsFakeImpl!.async).toBe(false);
  });
});

const EMPTY_MOCK = [
  `/**\n * @nudo:mock fetch =\n */\nexport function f(a) { return fetch(a); }`,
  `/**\n * @nudo:mock g from\n */\nexport function f(a) { return g(a); }`,
];
const VALID_MOCK = [
  `/**\n * @nudo:mock fetch = (u) => ({ ok: true })\n */\nexport function f(u) { return fetch(u); }`,
  `/**\n * @nudo:mock g from "./g.js"\n */\nexport function f(u) { return g(u); }`,
];

describe("空 mock 载荷不静默蒸发", () => {
  it("空 inline / 空 from 告警且不产 mock；合法载荷静默且产 mock", () => {
    for (const src of EMPTY_MOCK) {
      const diags = extractDirectives(parse(src), { diags: [] }) && (() => {
        const d: DirectiveDiag[] = [];
        extractDirectives(parse(src), { diags: d });
        return d;
      })();
      expect(diags, src).toHaveLength(1);
      expect(diags[0]!.code, src).toBe("nudo:directive-syntax");
      expect(diags[0]!.message, src).toContain("empty or invalid payload");
      expect(mockDirectives(src), src).toEqual([]);
    }
    for (const src of VALID_MOCK) {
      const d: DirectiveDiag[] = [];
      extractDirectives(parse(src), { diags: d });
      expect(d, src).toEqual([]);
      expect(mockDirectives(src), src).toHaveLength(1);
    }
  });
});

describe("粘连 mock 标签可见性", () => {
  it("mockfetch 诊断不产 mock；空格形态静默且产 mock", () => {
    const glued = `/**\n * @nudo:mockfetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })\n */\nexport async function f(url) { return (await fetch(url)).json(); }`;
    const d: DirectiveDiag[] = [];
    extractDirectives(parse(glued), { diags: d });
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("expected a space between '@nudo:mock' and the name");
    expect(mockDirectives(glued)).toEqual([]);

    const spaced = `/**\n * @nudo:mock fetch = (url) => ({ ok: true })\n */\nexport async function f(url) { return fetch(url); }`;
    expect(fnDiags(spaced)).toEqual([]);
    expect(mockDirectives(spaced)).toHaveLength(1);
  });
});

describe("文件级 mock-module 不误入函数级 mock", () => {
  it("零诊断、零函数级泄漏，文件级指令仍被抽取；函数级 mock 正常", () => {
    const src = `/// @nudo:mock-module "fs" from "./mock-fs.js"\nexport function f() { return 1; }\n`;
    expect(fnDiags(src)).toEqual([]);
    expect(fileDiags(src)).toEqual([]);
    expect(extractDirectives(parse(src), { diags: [] }).flatMap((f) => f.directives)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([{ kind: "mock-module", source: "fs", fromPath: "./mock-fs.js" }]);

    const fnMock = `/**\n * @nudo:mock fetch = (u) => ({ ok: true })\n */\nexport function f(u) { return fetch(u); }`;
    expect(fnDiags(fnMock)).toEqual([]);
    expect(extractDirectives(parse(fnMock), { diags: [] })[0]!.directives.map((d) => d.kind)).toEqual(["mock"]);
  });
});

describe("mock 形参绑定语义", () => {
  const PARAMS = [
    { expr: "({ a, b }) => a + b", params: ["{ a, b }"], pattern: "ObjectPattern", bound: ["a", "b"] },
    { expr: "([a, b]) => a + b", params: ["[a, b]"], pattern: "ArrayPattern", bound: ["a", "b"] },
    { expr: "(a = 1) => a", params: ["a = 1"], pattern: "AssignmentPattern", bound: ["a"] },
    { expr: "(...args) => args.length", params: ["...args"], pattern: "RestElement", bound: ["args"] },
    { expr: "(a, b) => a + b", params: ["a", "b"], pattern: "Identifier", bound: ["a"] },
  ];

  it("解构 / 默认 / rest / 普通形参都保留源码形态与绑定名", () => {
    for (const { expr, params, pattern, bound } of PARAMS) {
      const r = parseArrowFunctionExpr(expr);
      expect(r, expr).not.toBeNull();
      expect(r!.params, expr).toEqual(params);
      expect(r!.paramPatterns[0]!.type, expr).toBe(pattern);
      expect(r!.boundNames[0], expr).toEqual(bound);
    }
    const mixed = parseArrowFunctionExpr("(a = 1, { b }, ...rest) => a");
    expect(mixed!.params).toHaveLength(3);
    expect(mixed!.paramPatterns).toHaveLength(3);
    expect(mixed!.boundNames).toEqual([["a"], ["b"], ["rest"]]);
  });

  it("指令携带同一组绑定语义", () => {
    const mock = mockOf(`/**\n * @nudo:mock g = ({ a, b }) => a + b\n */\nexport function caller() { return g({ a: 1, b: 2 }); }`);
    expect(mock.arrowFn!.params).toEqual(["{ a, b }"]);
    expect(mock.arrowFn!.paramPatterns[0]!.type).toBe("ObjectPattern");
    expect(mock.arrowFn!.boundNames).toEqual([["a", "b"]]);
  });
});

describe("声明面拒绝非字面量拼接", () => {
  it("skip 返回 / mock 值 / sinon 返回值都不折错字符串；字面量不受影响", () => {
    const skip = extractDirectives(parse(`/**\n * @nudo:skip => "a" + "b"\n */\nexport function f() { return "ab"; }`), { diags: [] })
      .flatMap((f) => f.directives.filter((d) => d.kind === "skip"))[0] as { returns?: Abs };
    expect(skip.returns).toBeDefined();
    expect(["unknown", "never"]).toContain(skip.returns!.shape.k);
    expect(litValue(skip.returns!).ok).toBe(false);

    const mockAbs = parseAbsExpr('"a" + "b"');
    expect(["unknown", "never"]).toContain(mockAbs.shape.k);
    expect(litValue(mockAbs).ok).toBe(false);

    const sinon = parseSinonExpr('sinon.stub().returns("a" + "b")');
    expect(litValue(sinon!.returnValue!).ok).toBe(false);

    const literal = parseSinonExpr('sinon.stub().returns("ab")');
    expect(litValue(literal!.returnValue!)).toEqual({ ok: true, value: "ab" });
  });
});

describe("@nudo:skip=> 无空格载荷", () => {
  it("紧贴形态与空格形态同返回类型、零诊断；裸标签/ skipped 无返回", () => {
    const tight = `/**\n * @nudo:skip=> number()\n */\nexport function f() { return "hello"; }`;
    const spaced = `/**\n * @nudo:skip => number()\n */\nexport function f() { return "hello"; }`;
    expect(skipReturns(tight)).toBe("number");
    expect(skipReturns(tight)).toBe(skipReturns(spaced));
    expect(fnDiags(tight)).toEqual([]);

    for (const src of [`/**\n * @nudo:skip\n */\nexport function f() { return 1; }`, `/**\n * @nudo:skipped\n */\nexport function f() { return 1; }`]) {
      expect(skipReturns(src), src).toBeUndefined();
      expect(fnDiags(src), src).toEqual([]);
    }
  });
});

describe("case 见证不折非字面量拼接", () => {
  it("拼接见证落 unknown/never 且无错值；字面量见证不受影响", () => {
    const args = caseArgs(`/**\n * @nudo:case "c" ("a" + "b")\n */\nexport function f(x) { return x; }`);
    expect(args).toHaveLength(1);
    expect(["unknown", "never"]).toContain(args[0]!.shape.k);
    expect(args[0]!.term).toBeUndefined();
    expect(litValue(args[0]!).ok).toBe(false);

    const direct = parseCaseArgExpr('"a" + "b"');
    expect(litValue(direct).ok).toBe(false);

    const literal = caseArgs(`/**\n * @nudo:case "c" ("ab")\n */\nexport function f(x) { return x; }`);
    expect(litValue(literal[0]!)).toEqual({ ok: true, value: "ab" });
  });
});
