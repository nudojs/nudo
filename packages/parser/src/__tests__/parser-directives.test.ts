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
  it("畸形 mock-module 告警；单引号合法载荷静默并产出", () => {
    const bad = fileDiags(`/// @nudo:mock-module axios from ./m.js\nimport axios from "axios";\n`);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.code).toBe("nudo:directive-syntax");
    expect(bad[0]!.message).toContain("Unrecognized @nudo:mock-module form");

    const good = `/// @nudo:mock-module 'axios' from './m.js'\nimport axios from "axios";\n`;
    expect(fileDiags(good)).toEqual([]);
    expect(extractFileDirectives(parse(good), { diags: [] })).toEqual([
      { kind: "mock-module", source: "axios", fromPath: "./m.js" },
    ]);
  });

  it("块注释 / JSDoc 的 import 告警；行注释静默", () => {
    const invalid = [
      `/* @nudo:import { a } from "./x.nudo.js" */\nexport function f(){}\n`,
      `/**\n * @nudo:import { a } from "./x.nudo.js"\n */\nexport function f(){}\n`,
    ];
    for (const src of invalid) {
      const diags = fileDiags(src);
      expect(diags, src).toHaveLength(1);
      expect(diags[0]!.code, src).toBe("nudo:directive-syntax");
      expect(diags[0]!.message, src).toContain("@nudo:import is a file-level directive");
    }
    expect(fileDiags(`/// @nudo:import { a } from "./x.nudo.js"\nexport function f(){}\n`)).toEqual([]);
  });

  it("裸 / 尾随空白 / 不可读 env 列表都告警", () => {
    for (const src of ["/// @nudo:env\nexport function f(){}", "/// @nudo:env \nexport function f(){}", `/// @nudo:env node";\nexport function f(){}`]) {
      const diags = fileDiags(src);
      expect(diags, src).toHaveLength(1);
      expect(diags[0]!.code, src).toBe("nudo:directive-syntax");
    }
    expect(fileDiags(`/// @nudo:env node";\nexport function f(){}`)[0]!.message).toContain("Unrecognized @nudo:env list");
  });

  it("空格分隔的 env 列表合法并产出", () => {
    const src = `/// @nudo:env node web\nexport function f(){}\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([{ kind: "env", envs: ["node", "web"] }]);
  });
});

describe("@nudo:as 载荷分隔与括号", () => {
  it("无空格 / 有空格 / 嵌套括号都产出类型且零诊断", () => {
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
  });

  it("裸标签 / 无法识别载荷有诊断；标签边界不吞 assume/ascii/asXYZ", () => {
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
  it("无空格 / 有空格 / `)` 后注释：类型保留且只报尾注释一条", () => {
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
  });

  it("字符串内的注释符不是尾注释", () => {
    const { dirs, diags } = inlineOf('// @nudo:as lit("a//b")\nconst value = 1;');
    expect(dirs).toHaveLength(1);
    if (dirs[0]!.kind === "as") expect(dirs[0]!.typeAbs.shape.k).toBe("prim");
    expect(diags).toEqual([]);
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
  it("case 期望值带尾注释仍解析，且与无注释形态一致、零诊断", () => {
    expect(caseExpected(WITH_COMMENT)).toBe("string");
    expect(caseExpected(WITH_COMMENT)).toBe(caseExpected(WITHOUT_COMMENT));
    expect(fnDiags(WITH_COMMENT)).toEqual([]);

    const withString = `/**\n * @nudo:case "x" (1) => shape({ url: string() })\n */\nexport function f(a) { return a; }`;
    expect(fnDiags(withString)).toEqual([]);
    expect(caseExpected(withString)).toContain("url");
  });

  it("skip 返回类型带尾注释仍解析，且与无注释形态一致、零诊断", () => {
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
  it("显式 emit：不同位置两条、同位置一条、无位置沿用旧身份", () => {
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
  });

  it("同一块两条相同 as 尾注释各报一条；同一语句复扫只报一条", () => {
    const src = ["/**", " * @nudo:as string()// why", " * @nudo:as string()// why", " */", "const a = 1;", ""].join("\n");
    const stmt = parse(src).program.body[0]!;
    const two: DirectiveDiag[] = [];
    extractInlineDirectives(stmt, { diags: two });
    const trailing = two.filter((d) => d.message.includes("Trailing comment in @nudo:as"));
    expect(trailing).toHaveLength(2);
    expect(trailing[0]!.at).toBeDefined();
    expect(trailing[1]!.at).toBeDefined();
    expect(trailing[0]!.at!.line).not.toBe(trailing[1]!.at!.line);

    const oneSrc = "// @nudo:as string()// why\nconst a = 1;\n";
    const oneStmt = parse(oneSrc).program.body[0]!;
    const once: DirectiveDiag[] = [];
    runWithDirectiveDiags(once, () => {
      extractInlineDirectives(oneStmt);
      extractInlineDirectives(oneStmt);
    });
    expect(once.filter((d) => d.message.includes("Trailing comment in @nudo:as"))).toHaveLength(1);
  });

  it("两个函数里的逐字相同畸形 case 各报一条（位置不同）", () => {
    const src = ["/**", " * @nudo:case 't' (1)", " */", "function f(x) { return x; }", "/**", " * @nudo:case 't' (1)", " */", "function g(x) { return x; }", ""].join("\n");
    const diags: DirectiveDiag[] = [];
    extractDirectives(parse(src), { diags });
    const malformed = diags.filter((d) => d.message.includes("Malformed @nudo:case"));
    expect(malformed).toHaveLength(2);
    expect(malformed[0]!.at).toBeDefined();
    expect(malformed[1]!.at).toBeDefined();
    expect(malformed[0]!.at!.line).not.toBe(malformed[1]!.at!.line);
  });
});

describe("缺失期望值 / 期望解析失败", () => {
  it("空 `=>` 尾告警；无 `=>` 保持静默", () => {
    const empty = fnDiags(`/** @nudo:case "empty" (1) =>  */\nexport function f(x) { return x; }\n`);
    expect(empty).toHaveLength(1);
    expect(empty[0]!.code).toBe("nudo:directive-syntax");
    expect(empty[0]!.message).toContain("missing expected expression after '=>'");
    expect(fnDiags(`/** @nudo:case "plain" (1) */\nexport function f(x) { return x; }\n`)).toEqual([]);
  });

  it("合法期望值与下一行期望值都静默并保留 case", () => {
    const sameLine = `/** @nudo:case "ok" (1) => 999 */\nexport function f(x) { return x; }\n`;
    expect(fnDiags(sameLine)).toEqual([]);
    expect(caseDirectives(sameLine)).toHaveLength(1);

    const nextLine = `/**\n * @nudo:case "multi" (2) =>\n *   4\n */\nexport function f(x) { return x * 2; }\n`;
    expect(fnDiags(nextLine)).toEqual([]);
    expect(caseDirectives(nextLine)).toHaveLength(1);
  });

  it("directive.expected：解析失败不是 unknown；显式 unknown 保留", () => {
    const { fns, diags } = extractWithDiags(`/**\n * @nudo:case "malformed" (1) => bogus()\n * @nudo:case "explicit" (1) => unknown\n */\nfunction f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(cases).toHaveLength(2);
    expect(cases[0]!.expected).toBeDefined();
    expect(cases[0]!.expected!.shape.k).not.toBe("unknown");
    expect(cases[1]!.expected!.shape.k).toBe("unknown");
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("=> expected") && d.message.includes("bogus()"))).toBe(true);
  });

  it("严格 API parseCaseExpectedAbs：失败 undefined，合法/unknown 有值", () => {
    const diags: DirectiveDiag[] = [];
    const failed = runWithDirectiveDiags_____directives_ts(diags, () => parseCaseExpectedAbs("bogus()", EXPECTED_CTX));
    expect(failed).toBeUndefined();
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(parseCaseExpectedAbs("1e3", EXPECTED_CTX)).toBeDefined();
    expect(parseCaseExpectedAbs("unknown", EXPECTED_CTX)).toBeDefined();
  });
});

describe("解析失败与显式 unknown 可区分", () => {
  it("失败 ⇒ never + 诊断；as/replace/skip 上下文保持 unknown", () => {
    const failure = withDiags(() => parseAbsExprDiag("bogus()", EXPECTED_CTX));
    expect(failure.value.shape.k).toBe("never");
    expect(failure.value.shape.k).not.toBe("unknown");
    expect(failure.diags).toHaveLength(1);
    expect(failure.diags[0]!.code).toBe("nudo:directive-syntax");
    expect(failure.diags[0]!.message).toContain(EXPECTED_CTX);
    expect(failure.diags[0]!.message).toContain("bogus()");

    for (const ctx of ["@nudo:as", "@nudo:replace", "@nudo:skip =>"]) {
      const { value } = withDiags(() => parseAbsExprDiag("bogus()", ctx));
      expect(value.shape.k, ctx).toBe("unknown");
    }
  });

  it("显式 unknown / any / any() 仍是 unknown 且零诊断", () => {
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
  it("class 体 / 对象字面量体 / 字段 / mock-module 均拦截并告警", () => {
    const blocked = [
      { name: "class method", src: envInClass, kind: "env" },
      { name: "object method", src: envInObject, kind: "env" },
      { name: "class field", src: envInClassField, kind: "env" },
      { name: "mock-module in class", src: mockInClass, kind: "mock" },
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
  });

  it("数组 / 解构模式 / 嵌套数组里的 env 与 mock-module 均拦截", () => {
    const blocked = [
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
      expect(extractFileDirectives(parse(src), { diags: [] }), name).toEqual([]);
      if (kind === "env") expect(extractFileEnvNames(src), name).toEqual([]);
      else expect(extractMockModuleRecords(src), name).toEqual([]);
    }
  });

  it("对照：声明上方的顶层指令与函数体内指令口径", () => {
    const legal = [
      { name: "class 上方", src: `/// @nudo:env node\nexport class A { m() { return 1; } }\n` },
      { name: "对象字面量上方", src: `/// @nudo:env node\nexport const o = { a: 1 };\n` },
    ];
    for (const { name, src } of legal) {
      expect(fileDiags(src), name).toEqual([]);
      expect(extractFileDirectives(parse(src), { diags: [] }), name).toEqual([{ kind: "env", envs: ["node"] }]);
    }
    const inFn = `export function f() {\n  /// @nudo:env node\n  return 1;\n}\n`;
    const diags = fileDiags(inFn);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
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
  it("`@nudo:env` in a function body is still diagnosed + not promoted (Bug 847)", () => {
    const src = `export function f() {\n  /// @nudo:env node\n  return 1;\n}\n`;
    const diags = fileDiags(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(src)).toEqual([]);
  });

  it("a function-level `@nudo:case` above a function declaration is still bound to it", () => {
    const src = `/// @nudo:env node\n/// @nudo:case "c1" (1) => 2\nexport function f(a) {\n  return a + 1;\n}\n`;
    const fns = extractDirectives(parse(src), { diags: [] });
    const f = fns.find((x) => x.name === "f");
    expect(f).toBeDefined();
    expect(f!.directives.some((d) => d.kind === "case")).toBe(true);
    // 文件级闸门不牵连函数级指令：同一文件里的 `@nudo:env` 仍按顶层放行
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a function-level `@nudo:case` above a class method is still bound to it", () => {
    const src = `export class Calculator {\n  /// @nudo:case "c1" (1, 2) => 3\n  add(a, b) {\n    return a + b;\n  }\n}\n`;
    const fns = extractDirectives(parse(src), { diags: [] });
    const m = fns.find((x) => x.name === "Calculator.add");
    expect(m).toBeDefined();
    expect(m!.directives.some((d) => d.kind === "case")).toBe(true);
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
describe("file-level directives inside a function body are not file scope", () => {
/**
 * **文件级** `@nudo:env` / `@nudo:mock-module` 写在**函数体内部**也被当成
 * 文件级指令 ⇒ 整文件 env / 模块替换被静默改写，**零诊断**。
 *
 * 根因：文件级指令的**作用域 = 词法位置**这一约束只在**块注释**分支被检查；行注释
 * 分支**没有位置闸门**。
 *
 * 位置闸门口径（与 core 文本路径同口径）：文件级指令**不得落在任何函数体内**；
 * 顶层位置（文件头 / `export` 行 / 语句之间）一律放行。
 */




function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

const ENV_IN_FN = `export function f(a) {
  /// @nudo:env node
  return process.pid;
}
`;

const MOCK_MODULE_IN_FN = `export function f(a) {
  /// @nudo:mock-module "fs" from "./mock-fs.js"
  return a;
}
`;

describe("file-level directives inside a function body are not file scope", () => {
  it("`/// @nudo:env node` in a function body is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_FN);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("at the top of the file");
    expect(extractFileDirectives(parse(ENV_IN_FN), { diags: [] })).toEqual([]);
  });

  it("`/// @nudo:mock-module` in a function body is not promoted + is diagnosed", () => {
    const diags = fileDiags(MOCK_MODULE_IN_FN);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("at the top of the file");
    expect(extractFileDirectives(parse(MOCK_MODULE_IN_FN), { diags: [] })).toEqual([]);
  });

  it("the same directive at the top of the file still works", () => {
    const src = `/// @nudo:env node\nexport function f() {\n  return 1;\n}\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node"] },
    ]);
  });

  it("a top-level directive after other statements still works (top level is allowed)", () => {
    const src = `export function g() {\n  return 1;\n}\n/// @nudo:env node\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node"] },
    ]);
  });

  it("a directive on an export line still works", () => {
    const src = `export /// @nudo:env node\nfunction f() {\n  return 1;\n}\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node"] },
    ]);
  });
});
});

// ---------------------------------------------------------------------------
// 行内指令的粘连形态必须发诊断
// ---------------------------------------------------------------------------
describe("行内指令的粘连形态必须发诊断", () => {
/**
 * （parser 面）：行内指令的**粘连**形态此前对扫描器**完全不可见**
 * ⇒ **零诊断**地蒸发。
 *
 * - `@nudo:replaceFoo <target> <typeExpr>` ⇒ 既不匹配严格正则、也不匹配宽松
 * 正则 ⇒ 整条行内指令消失（连同它本该替换的类型）。
 *
 * 修复：粘连形态**看得见** ⇒ 发既有码 `nudo:directive-syntax`。
 *
 * ⚠ `@nudo:as` 侧**未改**：标签名被延长（`@nudo:asXYZ`）⇒ 不是 `@nudo:as`
 * 指令、且零诊断——族 28（）已合入并钉死该行为
 * （`parser--as-payload-separator.part.ts` 的「tag boundary」用例）⇒
 * 本片不推翻（越界发现，见交付报告）。
 */




function extractInlineWithDiags(source: string) {
  const ast = parse(source);
  const stmt = (ast as any).program.body[0];
  const diags: DirectiveDiag[] = [];
  const dirs = extractInlineDirectives(stmt, { diags });
  return { dirs, diags };
}

describe("行内指令的粘连形态必须发诊断", () => {
  it("@nudo:replaceFoo（粘连）→ nudo:directive-syntax，无指令", () => {
    const { dirs, diags } = extractInlineWithDiags(`/**
 * @nudo:replaceFoo x number()
 */
const a = 1;`);
    expect(dirs.filter((d) => d.kind === "replace")).toHaveLength(0);
    expect(
      diags.some(
        (d) =>
          d.code === "nudo:directive-syntax" &&
          d.message.includes("Malformed @nudo:replace directive"),
      ),
    ).toBe(true);
  });

  it("@nudo:assume 不是 @nudo:as 的粘连形态（不误伤）", () => {
    const { dirs, diags } = extractInlineWithDiags(`/**
 * @nudo:assume d <= max
 */
const a = 1;`);
    expect(dirs.filter((d) => d.kind === "as")).toHaveLength(0);
    expect(diags).toHaveLength(0);
  });

  it("合法形态不回归（@nudo:as number() / @nudo:replace x number()）", () => {
    const as = extractInlineWithDiags(`/**
 * @nudo:as number()
 */
const a = 1;`);
    expect(as.dirs.filter((d) => d.kind === "as")).toHaveLength(1);
    expect(as.diags).toHaveLength(0);

    const rep = extractInlineWithDiags(`/**
 * @nudo:replace x number()
 */
const a = 1;`);
    expect(rep.dirs.filter((d) => d.kind === "replace")).toHaveLength(1);
    expect(rep.diags).toHaveLength(0);
  });
});
});

// ---------------------------------------------------------------------------
// 行注释形态的 @nudo:import 位置错位必须可见
// ---------------------------------------------------------------------------
describe("行注释形态的 @nudo:import 位置错位必须可见", () => {
/**
 * `@nudo:import` 的**行注释**形态写在函数体 / 类体 / 对象体 /
 * 数组体 / 解构模式体内 ⇒ **零诊断**地失效（core 文本路的位置闸门把它拦下，
 * 引用它的 `@nudo:contract` 被静默丢弃 ⇒ 门禁假绿）；而同一位置上的
 * **块注释**形态却会明确告警「这是文件级指令」⇒ 同一指令两形态口径相反。
 *
 * 根因：`packages/parser/src/directives/file-directives.ts` 的 misplaced 分支
 * 只认 `@nudo:env` / `@nudo:mock-module`（`warnMisplacedFileTagLine` 的标签
 * 联合类型里没有 `import`）⇒ `@nudo:import` 落在 `continue` 之前的 if 链外
 * ⇒ 无声丢弃。
 *
 * 断言非永真：改前函数体内的 `/// @nudo:import` 的诊断数为 **0**，文件头的
 * 形态也是 0（对照组改前改后都必须是 0）。
 */




function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

function importDiags(src: string): DirectiveDiag[] {
  return fileDiags(src).filter((d) => d.message.includes("@nudo:import"));
}

describe("行注释形态的 @nudo:import 位置错位必须可见", () => {
  it("函数体内的 /// @nudo:import ⇒ 一条 nudo:directive-syntax（改前：零诊断）", () => {
    const diags = importDiags(`/**
 * @nudo:contract y positive
 */
export function bar(y) {
  /// @nudo:import { positive } from "./std.nudo.js"
  return y;
}
`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("@nudo:import is a file-level directive");
    expect(diags[0]!.message).toContain("line comment inside");
  });

  it("文件头的 /// @nudo:import ⇒ 零该诊断（合法位置）", () => {
    const diags = importDiags(`/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract y positive
 */
export function bar(y) { return y; }
`);
    expect(diags).toEqual([]);
  });

  it("两种注释形态在同一位置**口径一致**（块注释原本就告警）", () => {
    const insideLine = importDiags(`export function bar(y) {
  /// @nudo:import { positive } from "./std.nudo.js"
  return y;
}
`);
    const insideBlock = importDiags(`export function bar(y) {
  /** @nudo:import { positive } from "./std.nudo.js" */
  return y;
}
`);
    expect(insideLine).toHaveLength(1);
    expect(insideBlock).toHaveLength(1);
    // 同一族诊断码（文案按形态分工，但都点名「文件级指令」）
    expect(insideLine[0]!.code).toBe(insideBlock[0]!.code);
    expect(insideBlock[0]!.message).toContain("@nudo:import is a file-level directive");
  });

  it("对象字面量体内的行注释形态同样告警（嵌套体闸门全族一致）", () => {
    const diags = importDiags(`export const conf = {
  /// @nudo:import { positive } from "./std.nudo.js"
  port: 1,
};
`);
    expect(diags).toHaveLength(1);
  });

  it("显式 diags 通道与 runWithDirectiveDiags 域都能收到（消费面无分叉）", () => {
    const src = `export function bar(y) {
  /// @nudo:import { positive } from "./std.nudo.js"
  return y;
}
`;
    const inDomain: DirectiveDiag[] = [];
    runWithDirectiveDiags_____directives_ts_2(inDomain, () => {
      extractFileDirectives(parse(src));
    });
    expect(inDomain.filter((d) => d.message.includes("@nudo:import"))).toHaveLength(1);
    // 函数级抽取（同一份源码）不受影响：@nudo:import 不是函数级指令
    expect(extractDirectives(parse(src))).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// async arrow payload keeps its async flag
// ---------------------------------------------------------------------------
describe("async arrow payload keeps its async flag", () => {
/**
 * `@nudo:mock f = async (x) => x + 1` 的 **async 语义被静默丢弃**
 * ⇒ mock 被建模成**同步**函数 ⇒ 调用点 `f(1).then(…)` 报「method 'then'
 * missing on number receiver」⇒ **error 级** `nudo:entry-may-throw` **假红**
 * （native 不抛：native 返回 Promise）。
 *
 * 根因（expr-scan.ts `parseArrowFunctionExpr`）：解析层只取箭头的**参数与体**，
 * `init.async` **根本没有被读出来** ⇒ service 据此把 mock 建成同步函数
 * （`mock-abs.ts` 的 `async: false` 硬编码——**service 侧改动见交付报告**）。
 *
 * 修法（parser 侧）：扫描结果带上 `async` 标志（`async (x) => …` ⇒ true），
 * 消费面（service 的 mock 构造）据此把 mock 建成 async 函数。
 */





function mockOf(source: string): MockDirective {
  const fns = extractDirectives(parse(source));
  const mocks = fns.flatMap((f) =>
    f.directives.filter((d): d is MockDirective => d.kind === "mock"),
  );
  expect(mocks).toHaveLength(1);
  return mocks[0]!;
}

describe("async arrow payload keeps its async flag", () => {
  it("`async (x) => x + 1` is scanned as async", () => {
    const r = parseArrowFunctionExpr("async (x) => x + 1");
    expect(r).not.toBeNull();
    expect(r!.async).toBe(true);
    expect(r!.params).toEqual(["x"]);
  });

  it("sync arrow is scanned as sync (negative control)", () => {
    const r = parseArrowFunctionExpr("(x) => x + 1");
    expect(r).not.toBeNull();
    expect(r!.async).toBe(false);
  });

  it("async arrow without params is still async", () => {
    const r = parseArrowFunctionExpr("async () => 1");
    expect(r).not.toBeNull();
    expect(r!.async).toBe(true);
    expect(r!.params).toEqual([]);
  });

  it("`async function` expression is scanned as async", () => {
    const r = parseArrowFunctionExpr("async function (x) { return x; }");
    expect(r).not.toBeNull();
    expect(r!.async).toBe(true);
  });

  it("the `@nudo:mock` directive carries the async flag", () => {
    const mock = mockOf(
      `/**
 * @nudo:mock f = async (x) => x + 1
 */
export function caller() { return f(1); }`,
    );
    expect(mock.arrowFn).toBeDefined();
    expect(mock.arrowFn!.async).toBe(true);
  });

  it("a sync mock directive stays sync (negative control)", () => {
    const mock = mockOf(
      `/**
 * @nudo:mock f = (x) => x + 1
 */
export function caller() { return f(1); }`,
    );
    expect(mock.arrowFn).toBeDefined();
    expect(mock.arrowFn!.async).toBe(false);
  });

  it("the sinon `stub().callsFake(…)` path also keeps the async flag", async () => {
    // 857 的**第三处**（sinon 路径）：`mock-expr.ts` 的 `stub.callsFake({… async: false})`
    // 此前同样把 async 硬编码成 false ⇒ `stub().callsFake(async (x) => …)`
    // 被建模成同步函数 ⇒ 调用点 `.then(…)` 报「method 'then' missing」。
    const { parseNudoMockExpr } = await import("../directives/mock-expr.ts");
    const asyncHelper = parseNudoMockExpr("stub().callsFake(async (x) => x + 1)");
    expect(asyncHelper).not.toBeNull();
    expect(asyncHelper!.callsFakeImpl).toBeDefined();
    expect(asyncHelper!.callsFakeImpl!.async).toBe(true);

    const syncHelper = parseNudoMockExpr("stub().callsFake((x) => x + 1)");
    expect(syncHelper).not.toBeNull();
    expect(syncHelper!.callsFakeImpl!.async).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// an empty @nudo:mock payload must not evaporate silently
// ---------------------------------------------------------------------------
describe("an empty @nudo:mock payload must not evaporate silently", () => {
/**
 * `@nudo:mock` 的**载荷为空**（`@nudo:mock fetch =` / `@nudo:mock g from`）
 * ⇒ 指令**静默蒸发**、零诊断 ⇒ mock 丢失 ⇒ 分析退化成 unknown / 假红。
 *
 * 根因：宽松标签正则（`@nudo:mock\b[ \t]*([^\n]*)`）看得到标签，但两条严格文法
 * （inline `= <expr>` / from `from "<path>"`）都不命中 ⇒ 既不建 mock 也不告警。
 */




function fnDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return diags;
}

function mockDirectives(src: string): unknown[] {
  return extractDirectives(parse(src), { diags: [] }).flatMap((f) =>
    f.directives.filter((d) => d.kind === "mock"),
  );
}

const EMPTY_INLINE = `/**
 * @nudo:mock fetch =
 */
export function f(a) {
  return fetch(a);
}
`;

const EMPTY_FROM = `/**
 * @nudo:mock g from
 */
export function f(a) {
  return g(a);
}
`;

describe("an empty @nudo:mock payload must not evaporate silently", () => {
  it("`@nudo:mock fetch =` → nudo:directive-syntax (empty payload)", () => {
    const diags = fnDiags(EMPTY_INLINE);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("empty or invalid payload");
  });

  it("`@nudo:mock g from` → nudo:directive-syntax (missing path)", () => {
    const diags = fnDiags(EMPTY_FROM);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("empty or invalid payload");
  });

  it("no mock directive is produced for the empty payload", () => {
    expect(mockDirectives(EMPTY_INLINE)).toEqual([]);
    expect(mockDirectives(EMPTY_FROM)).toEqual([]);
  });

  it("valid payload forms stay silent", () => {
    const inline = `/**
 * @nudo:mock fetch = (u) => ({ ok: true })
 */
export function f(u) {
  return fetch(u);
}
`;
    const from = `/**
 * @nudo:mock g from "./g.js"
 */
export function f(u) {
  return g(u);
}
`;
    expect(fnDiags(inline)).toEqual([]);
    expect(fnDiags(from)).toEqual([]);
    expect(mockDirectives(inline)).toHaveLength(1);
    expect(mockDirectives(from)).toHaveLength(1);
  });
});
});

// ---------------------------------------------------------------------------
// a glued @nudo:mock<name> tag must be visible to the scanner
// ---------------------------------------------------------------------------
describe("a glued @nudo:mock<name> tag must be visible to the scanner", () => {
/**
 * `@nudo:mock<name> = …`（标签与名字之间**无空白**）⇒ **连宽松标签正则
 * 都不匹配** ⇒ 整条 mock **对扫描器完全不可见** ⇒ **零诊断** ⇒ **分析跑在真身上**
 * （`promise<unknown>` 而非 `promise<{ id: 1 }>`）⇒ **假绿**。
 *
 * 根因：三条 mock 正则都以 `\b` 收尾——`@nudo:mock` 后紧跟词字符时词边界不成立，
 * 宽松形态（用于诊断非法名形态）也看不见这条指令。
 */




function fnDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return diags;
}

function mockDirectives(src: string): unknown[] {
  return extractDirectives(parse(src), { diags: [] }).flatMap((f) =>
    f.directives.filter((d) => d.kind === "mock"),
  );
}

const GLUED = `/**
 * @nudo:mockfetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
 */
export async function f(url) {
  const res = await fetch(url);
  return res.json();
}
`;

describe("a glued @nudo:mock<name> tag must be visible to the scanner", () => {
  it("emits nudo:directive-syntax naming the missing space", () => {
    const diags = fnDiags(GLUED);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain(
      "expected a space between '@nudo:mock' and the name",
    );
  });

  it("the glued tag does not become a mock directive", () => {
    expect(mockDirectives(GLUED)).toEqual([]);
  });

  it("the spaced form still works and stays silent", () => {
    const spaced = `/**
 * @nudo:mock fetch = (url) => ({ ok: true })
 */
export async function f(url) {
  return fetch(url);
}
`;
    expect(fnDiags(spaced)).toEqual([]);
    expect(mockDirectives(spaced)).toHaveLength(1);
  });
});
});

// ---------------------------------------------------------------------------
// file-level @nudo:mock-module is not a function-level @nudo:mock
// ---------------------------------------------------------------------------
describe("file-level @nudo:mock-module is not a function-level @nudo:mock", () => {
/**
 * 文件级 `/// @nudo:mock-module` 被**函数级** `@nudo:mock` 标签正则
 * 误捕：正确写法产生**伪造的** nudo:directive-syntax 警告（"Malformed @nudo:mock:
 * cannot parse name … — got: -module …"）。
 *
 * 根因：mock 标签正则用 `\b` 收尾，`@nudo:mock` 后的 `-` 仍满足词边界 ⇒ 文件级
 * `@nudo:mock-module` 落进函数级 mock 扫描器。
 */




function fnDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return diags;
}

function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

const FILE_LEVEL_MOCK_MODULE = `/// @nudo:mock-module "fs" from "./mock-fs.js"
export function f() {
  return 1;
}
`;

describe("file-level @nudo:mock-module is not a function-level @nudo:mock", () => {
  it("produces no nudo:directive-syntax warning", () => {
    expect(fnDiags(FILE_LEVEL_MOCK_MODULE)).toEqual([]);
    expect(fileDiags(FILE_LEVEL_MOCK_MODULE)).toEqual([]);
  });

  it("leaks no function-level mock directive", () => {
    const fns = extractDirectives(parse(FILE_LEVEL_MOCK_MODULE), { diags: [] });
    expect(fns.flatMap((f) => f.directives)).toEqual([]);
  });

  it("still extracts the file-level mock-module directive", () => {
    expect(extractFileDirectives(parse(FILE_LEVEL_MOCK_MODULE), { diags: [] })).toEqual([
      { kind: "mock-module", source: "fs", fromPath: "./mock-fs.js" },
    ]);
  });

  it("function-level @nudo:mock still works (no over-blocking)", () => {
    const src = `/**
 * @nudo:mock fetch = (u) => ({ ok: true })
 */
export function f(u) {
  return fetch(u);
}
`;
    expect(fnDiags(src)).toEqual([]);
    const fns = extractDirectives(parse(src), { diags: [] });
    expect(fns).toHaveLength(1);
    expect(fns[0]!.directives.map((d) => d.kind)).toEqual(["mock"]);
  });
});
});

// ---------------------------------------------------------------------------
// mock payload params carry binding semantics
// ---------------------------------------------------------------------------
describe("mock payload params carry binding semantics", () => {
/**
 * `@nudo:mock g = ({ a, b }) => a + b` 的**形参根本没被绑定** ⇒
 * mock 体读到未声明全局 ⇒ `ReferenceError` ⇒ **error 级**假红 + dts 产物写出
 * `caller(): never`（**错误类型声明**）。
 *
 * 根因（expr-scan.ts `parseArrowFunctionExpr` 的形参循环）：形参被降级成
 * 「名字 / 占位名」而**无绑定语义**——解构形参退化成占位名 `__destructured_0`、
 * `AssignmentPattern`（默认值）**整条丢弃**（连同 `params` / `paramPatterns` 的
 * 下标对齐）、rest 形参保留字面 `...`。
 *
 * 修法（parser 侧）：形参表现在带**绑定语义**——
 * - `params`：**JS 源码形态**（消费面拼函数签名用）：标识符是名字、默认形参保留
 * 默认值（`a = 1`）、rest 保留 `...`、解构保留源码形态（`{ a, b }`）；
 * - `paramPatterns`：形参 AST（原样，1:1 对齐）——消费面可自行解构绑定；
 * - `boundNames`：**绑定的名字**（解构列出顶层绑定名；rest 是裸名；默认是绑定名）
 * ——自由标识符分析（作用域）按此判定「已被形参绑定」。
 */





function mockOf(source: string): MockDirective {
  const fns = extractDirectives(parse(source));
  const mocks = fns.flatMap((f) =>
    f.directives.filter((d): d is MockDirective => d.kind === "mock"),
  );
  expect(mocks).toHaveLength(1);
  return mocks[0]!;
}

describe("mock payload params carry binding semantics", () => {
  it("object destructuring keeps the pattern and exposes the bound names", () => {
    const r = parseArrowFunctionExpr("({ a, b }) => a + b");
    expect(r).not.toBeNull();
    expect(r!.params).toEqual(["{ a, b }"]);
    expect(r!.paramPatterns[0]!.type).toBe("ObjectPattern");
    expect(r!.boundNames).toEqual([["a", "b"]]);
  });

  it("array destructuring keeps the pattern and exposes the bound names", () => {
    const r = parseArrowFunctionExpr("([a, b]) => a + b");
    expect(r).not.toBeNull();
    expect(r!.params).toEqual(["[a, b]"]);
    expect(r!.paramPatterns[0]!.type).toBe("ArrayPattern");
    expect(r!.boundNames).toEqual([["a", "b"]]);
  });

  it("default value params are kept (not dropped) and expose the bound name", () => {
    const r = parseArrowFunctionExpr("(a = 1) => a");
    expect(r).not.toBeNull();
    expect(r!.params).toEqual(["a = 1"]);
    expect(r!.paramPatterns[0]!.type).toBe("AssignmentPattern");
    expect(r!.boundNames).toEqual([["a"]]);
  });

  it("rest params keep the `...` in the signature and expose the bare bound name", () => {
    const r = parseArrowFunctionExpr("(...args) => args.length");
    expect(r).not.toBeNull();
    expect(r!.params).toEqual(["...args"]);
    expect(r!.paramPatterns[0]!.type).toBe("RestElement");
    expect(r!.boundNames).toEqual([["args"]]);
  });

  it("plain identifiers are unchanged", () => {
    const r = parseArrowFunctionExpr("(a, b) => a + b");
    expect(r).not.toBeNull();
    expect(r!.params).toEqual(["a", "b"]);
    expect(r!.boundNames).toEqual([["a"], ["b"]]);
  });

  it("params / paramPatterns / boundNames stay 1:1 aligned (no dropped slots)", () => {
    const r = parseArrowFunctionExpr("(a = 1, { b }, ...rest) => a");
    expect(r).not.toBeNull();
    expect(r!.params).toHaveLength(3);
    expect(r!.paramPatterns).toHaveLength(3);
    expect(r!.boundNames).toHaveLength(3);
    expect(r!.boundNames).toEqual([["a"], ["b"], ["rest"]]);
  });

  it("the `@nudo:mock` directive carries the binding semantics", () => {
    const mock = mockOf(
      `/**
 * @nudo:mock g = ({ a, b }) => a + b
 */
export function caller() { return g({ a: 1, b: 2 }); }`,
    );
    expect(mock.arrowFn).toBeDefined();
    expect(mock.arrowFn!.params).toEqual(["{ a, b }"]);
    expect(mock.arrowFn!.paramPatterns[0]!.type).toBe("ObjectPattern");
    expect(mock.arrowFn!.boundNames).toEqual([["a", "b"]]);
  });
});
});

// ---------------------------------------------------------------------------
// skip / mock declaration faces reject non-literals
// ---------------------------------------------------------------------------
describe("skip / mock declaration faces reject non-literals", () => {
/**
 * 回归：同一贪婪切片在 `@nudo:skip` / `@nudo:mock` **声明面**。
 *
 * `@nudo:skip => "a" + "b"` 的声明返回类型、`@nudo:mock` 载荷里的字符串值
 * 都走同一套字符串分支 ⇒ 旧实现把 `a" + "b` 折成**声明的类型 / mock 值**
 * ⇒ 签名与 dts 给出**错误的类型声明**（谁也没写过的字符串）。
 *
 * 修法：与 同源——字符串分支的词法边界判定单源在
 * `directives/string-literal.ts`；非单个字面量 ⇒ unknown（不折错值）。
 */







describe("skip / mock declaration faces reject non-literals", () => {
  it("@nudo:skip return type is unknown, not a wrong string", () => {
    const fns = extractDirectives(
      parse(`
/**
 * @nudo:skip => "a" + "b"
 */
export function f() { return "ab"; }
`),
    );
    const d = fns[0]?.directives.find((x) => x.kind === "skip");
    expect(d).toBeDefined();
    if (!d || d.kind !== "skip") return;
    const returns = d.returns as Abs | undefined;
    expect(returns).toBeDefined();
    expect(["unknown", "never"]).toContain(returns!.shape.k);
    expect(litValue(returns!).ok).toBe(false);
  });

  it("mock payload value is unknown, not a wrong string", () => {
    const abs = parseAbsExpr('"a" + "b"');
    expect(["unknown", "never"]).toContain(abs.shape.k);
    expect(litValue(abs).ok).toBe(false);
  });

  it("sinon mock return value is unknown, not a wrong string", () => {
    const expr = parseSinonExpr('sinon.stub().returns("a" + "b")');
    expect(expr).not.toBeNull();
    const lv = expr ? litValue(expr.returnValue!) : { ok: false as const };
    expect(lv.ok).toBe(false);
  });

  it("a literal mock payload is unaffected", () => {
    const expr = parseSinonExpr('sinon.stub().returns("ab")');
    expect(expr).not.toBeNull();
    if (!expr) return;
    expect(litValue(expr.returnValue!)).toEqual({ ok: true, value: "ab" });
  });
});
});

// ---------------------------------------------------------------------------
// @nudo:skip=> <expr> (no space) must not drop the payload
// ---------------------------------------------------------------------------
describe("@nudo:skip=> <expr> (no space) must not drop the payload", () => {
/**
 * `@nudo:skip=> <expr>`（标签与载荷之间**无空白**）⇒ **载荷被静默丢弃**、
 * 零诊断 ⇒ 声明的返回类型**没生效** ⇒ 签名从 `f() => number` 退化成 `f() => any`
 * ⇒ **any 泄漏到产物面** + **假绿**。
 *
 * 根因：`SKIP_REGEX` 把「分隔空白」写进必需结构（`\b(?:[ \t]+(\S[^\n]*))?`）——
 * 粘连写法整条载荷匹配不到。
 */





function fnDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return diags;
}

function skipReturns(src: string): string | undefined {
  const fns = extractDirectives(parse(src), { diags: [] });
  for (const fn of fns) {
    for (const d of fn.directives) {
      if (d.kind === "skip") return d.returns === undefined ? undefined : formatShape(d.returns);
    }
  }
  return undefined;
}

const TIGHT = `/**
 * @nudo:skip=> number()
 */
export function f() {
  return "hello";
}
`;

const SPACED = `/**
 * @nudo:skip => number()
 */
export function f() {
  return "hello";
}
`;

describe("@nudo:skip=> <expr> (no space) must not drop the payload", () => {
  it("tight form yields the declared return type", () => {
    expect(skipReturns(TIGHT)).toBe("number");
  });

  it("tight form equals the spaced form", () => {
    expect(skipReturns(TIGHT)).toBe(skipReturns(SPACED));
  });

  it("no diagnostic is emitted for the tight form", () => {
    expect(fnDiags(TIGHT)).toEqual([]);
  });

  it("bare @nudo:skip still declares nothing", () => {
    const bare = `/**
 * @nudo:skip
 */
export function f() {
  return 1;
}
`;
    expect(skipReturns(bare)).toBeUndefined();
    expect(fnDiags(bare)).toEqual([]);
  });

  it("@nudo:skipped is still not a skip directive", () => {
    const src = `/**
 * @nudo:skipped
 */
export function f() {
  return 1;
}
`;
    expect(skipReturns(src)).toBeUndefined();
    expect(fnDiags(src)).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// case witness concatenation is not a literal
// ---------------------------------------------------------------------------
describe("case witness concatenation is not a literal", () => {
/**
 * 回归：同一贪婪切片在 `@nudo:case` **见证**面。
 *
 * 见证实参走 `parseAbsExprDiag` → `parseCaseArgExpr`；旧实现的字符串分支
 * 只查首尾引号 ⇒ `("a" + "b")` 折成 `a" + "b`（自信的错值）⇒ 见证 ⊭ 契约
 * ⇒ 契约门禁**假红**（用户写的见证恰好就是契约要求的值）。
 *
 * 修法：与 同源（字符串分支的词法边界判定）⇒ 非单个字面量落
 * unknown（诊断给出），不再折出错值。
 *
 * 注：`nudo check` 的见证执法面在 core `algebra/check-case-scan.ts`
 * 的 `parseLitArg`（**自带的**贪婪切片，不读 parser 的结果）——core 侧
 * 的同源收口由主 agent 统一处理（见交付报告「需主 agent 收口」段）。
 */





function caseArgs(source: string): Abs[] {
  const fns = extractDirectives(parse(source));
  const d = fns[0]?.directives.find((x) => x.kind === "case");
  if (!d || d.kind !== "case") throw new Error("expected case directive");
  return d.argsAbs;
}

describe("case witness concatenation is not a literal", () => {
  it("witness argument of a concatenation is unknown, not a wrong string", () => {
    const args = caseArgs(`
/**
 * @nudo:case "c" ("a" + "b")
 */
export function f(x) { return x; }
`);
    expect(args).toHaveLength(1);
    // 「解析失败」的表示：unknown（不认识）或 never（fail-closed 表示）——
    // 两种都不是**自信的错值**（绝不等于 `a" + "b`）。
    expect(["unknown", "never"]).toContain(args[0]!.shape.k);
    expect(args[0]!.term).toBeUndefined();
    expect(litValue(args[0]!).ok).toBe(false);
  });

  it("the wrong value \"a\\\" + \\\"b\" is never produced", () => {
    const abs = parseCaseArgExpr('"a" + "b"');
    const lv = litValue(abs);
    expect(lv.ok).toBe(false);
  });

  it("a literal witness is unaffected", () => {
    const args = caseArgs(`
/**
 * @nudo:case "c" ("ab")
 */
export function f(x) { return x; }
`);
    expect(litValue(args[0]!)).toEqual({ ok: true, value: "ab" });
  });
});
});
