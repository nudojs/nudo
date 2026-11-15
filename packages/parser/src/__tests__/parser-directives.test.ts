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
// unparsable @nudo:mock-module payload is diagnosed
// ---------------------------------------------------------------------------
describe("unparsable @nudo:mock-module payload is diagnosed", () => {
/**
 * 族 10 片 1 —— 415 / 416 / 417 的**诊断落点**（parser AST 通道）。
 *
 * - 415：`@nudo:mock-module` 标签命中但**载荷解析失败** ⇒ 不再静默丢弃
 * （此前无 else 分支 ⇒ 指令静默蒸发：mock 不生效、门禁照常绿）。
 * - 416：`@nudo:import` 属文件级指令族 ⇒ 块注释形态被**忽略并告警**
 * （口径与 core 文本通道分档后一致）。
 * - 417：`@nudo:env` **裸标签**（没写 env 名）⇒ 告警（此前整行不匹配 ⇒
 * 零诊断地丢弃 ⇒ env 未解析 ⇒ 全局 unknown）。
 */





function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

describe("unparsable @nudo:mock-module payload is diagnosed", () => {
  it("malformed mock-module payload → nudo:directive-syntax warning", () => {
    const diags = fileDiags(
      `/// @nudo:mock-module axios from ./m.js\nimport axios from "axios";\n`,
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("Unrecognized @nudo:mock-module form");
  });

  it("single-quoted mock-module payload is accepted and silent", () => {
    const src = `/// @nudo:mock-module 'axios' from './m.js'\nimport axios from "axios";\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "mock-module", source: "axios", fromPath: "./m.js" },
    ]);
  });
});

describe("block-comment @nudo:import is ignored with a warning", () => {
  it("block comment form → nudo:directive-syntax warning", () => {
    const diags = fileDiags(`/* @nudo:import { a } from "./x.nudo.js" */\nexport function f(){}\n`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("@nudo:import is a file-level directive");
  });

  it("JSDoc block form → warning too", () => {
    const diags = fileDiags(`/**\n * @nudo:import { a } from "./x.nudo.js"\n */\nexport function f(){}\n`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
  });

  it("line comment form stays silent (control)", () => {
    expect(fileDiags(`/// @nudo:import { a } from "./x.nudo.js"\nexport function f(){}\n`)).toEqual([]);
  });
});

describe("bare @nudo:env tag is diagnosed", () => {
  it("bare tag → nudo:directive-syntax warning", () => {
    const diags = fileDiags(`/// @nudo:env\nexport function f(){}\n`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("@nudo:env requires at least one env name");
  });

  it("bare tag with trailing blank → warning too", () => {
    expect(fileDiags(`/// @nudo:env \nexport function f(){}\n`)).toHaveLength(1);
  });

  it("space-separated env list is accepted and silent", () => {
    const src = `/// @nudo:env node web\nexport function f(){}\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node", "web"] },
    ]);
  });

  it("unreadable env list → warning (no silent drop)", () => {
    const diags = fileDiags(`/// @nudo:env node";\nexport function f(){}\n`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("Unrecognized @nudo:env list");
  });
});
});

// ---------------------------------------------------------------------------
// `@nudo:as` payload separator is optional (parenthesised form must not evaporate)
// ---------------------------------------------------------------------------
describe("`@nudo:as` payload separator is optional (parenthesised form must not evaporate)", () => {
/**
 * `@nudo:as` 的**值格**与**类型格**之间**没有空格**（`@nudo:as(string())`）
 * ⇒ 整条指令被**静默丢弃**（零诊断）⇒ 类型覆盖**不生效**（假绿）。
 *
 * 根因（inline-directives.ts）：`AS_LINE_REGEX`（值格要求**至少一个空白**）与
 * `AS_BARE_RE`（无载荷形态**只认光秃秃**的 `@nudo:as`）**分工不闭合** ⇒ 括号
 * 紧贴形态两条正则**都不匹配** ⇒ 整条 `@nudo:as` 蒸发、零诊断。
 *
 * 修法：标签后**分隔空白可有可无**（`@nudo:as(string())` ≡ `@nudo:as string()`）；
 * 载荷的**外层配平括号**可剥（`(string())` ≡ `string()`）——约束文法的预筛正则
 * 锚定构建器名，括号包裹的等价写法此前被判「不认识」；标签后紧跟标识符字符 ⇒
 * **标签名被延长**（`@nudo:assume` / `@nudo:ascii`）⇒ 不是 `@nudo:as` 指令；
 * 无载荷 ⇒ **显式诊断**（不再静默）。
 */




/** 取第一条语句的行内指令 + 其诊断 */
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

describe("`@nudo:as` payload separator is optional (parenthesised form must not evaporate)", () => {
  it("`@nudo:as(string())` (no space) yields a type — not an evaporated directive", () => {
    const { dirs, diags } = inlineOf("// @nudo:as(string())\nconst value = 1;");
    expect(dirs).toHaveLength(1);
    expect(dirs[0]!.kind).toBe("as");
    if (dirs[0]!.kind === "as") {
      expect(dirs[0]!.typeAbs.shape.k).toBe("prim");
      expect(dirs[0]!.typeAbs.shape.k).not.toBe("unknown");
    }
    expect(diags).toEqual([]);
  });

  it("`@nudo:as number()` (spaced form) still yields the same type", () => {
    const { dirs, diags } = inlineOf("// @nudo:as number()\nconst value = 1;");
    expect(dirs).toHaveLength(1);
    if (dirs[0]!.kind === "as") expect(dirs[0]!.typeAbs.shape.k).toBe("prim");
    expect(diags).toEqual([]);
  });

  it("`@nudo:as(shape({ port: number() }))` (nested parens) yields an object type", () => {
    const { dirs, diags } = inlineOf(
      "// @nudo:as(shape({ port: number() }))\nconst value = 1;",
    );
    expect(dirs).toHaveLength(1);
    if (dirs[0]!.kind === "as") expect(dirs[0]!.typeAbs.shape.k).toBe("obj");
    expect(diags).toEqual([]);
  });

  it("bare `@nudo:as` is diagnosed explicitly (never silently ignored)", () => {
    const { dirs, diags } = inlineOf("// @nudo:as\nconst value = 1;");
    expect(dirs).toHaveLength(0);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("@nudo:as requires a type expression");
  });

  it("unrecognised payload is diagnosed instead of evaporating", () => {
    const { dirs, diags } = inlineOf("// @nudo:as(T.number)\nconst value = 1;");
    expect(dirs).toHaveLength(1); // 指令被认出来了（不是被丢弃）
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("Unrecognized type expression in @nudo:as");
  });

  it("tag boundary: `@nudo:asXYZ` / `@nudo:assume` are not `@nudo:as` directives", () => {
    for (const tag of ["@nudo:asXYZ", "@nudo:assume", "@nudo:ascii"]) {
      const { dirs, diags } = inlineOf(`// ${tag}\nconst value = 1;`);
      expect(dirs, tag).toHaveLength(0);
      expect(diags, tag).toEqual([]);
    }
  });
});
});

// ---------------------------------------------------------------------------
// trailing comment in `@nudo:as` is cut by lexical boundary
// ---------------------------------------------------------------------------
describe("trailing comment in `@nudo:as` is cut by lexical boundary", () => {
/**
 * `@nudo:as` 的类型表达式里**尾注释前没有空格**（`string()// why`）⇒
 * 注释被并进表达式 ⇒ **合法类型被判「unsafe」并降级为 unknown**（合法类型覆盖
 * 静默失效）。
 *
 * 根因（inline-directives.ts `findTrailingCommentStart`）：尾注释切分以
 * 「**前导空白**」为**唯一信号** ⇒ `string()// why` 不被切走 ⇒ 整串进 AST
 * 白名单 ⇒ 判 unsafe ⇒ 降级 unknown（并附两条误导性诊断）。
 *
 * 修法：尾注释识别改**词法边界**——表达式结束处的 `//` / `/*` 即尾注释
 * （标识符 / `)` 结尾也算）；只排除「整除」形态（左操作数是数值字面量且 `//`
 * 后紧跟数字）；字符串内的 `//` 不算（字符串感知）。
 */




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

describe("trailing comment in `@nudo:as` is cut by lexical boundary", () => {
  it("`string()// why` (no space) keeps the type (no unknown downgrade)", () => {
    const { dirs, diags } = inlineOf("// @nudo:as string()// why\nconst value = 1;");
    expect(dirs).toHaveLength(1);
    if (dirs[0]!.kind === "as") {
      expect(dirs[0]!.typeAbs.shape.k).toBe("prim");
      expect(dirs[0]!.typeAbs.shape.k).not.toBe("unknown");
    }
    // 只报「尾注释」一条——不再报「unsafe」/「unrecognized」
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("Trailing comment in @nudo:as type expression");
  });

  it("`string() // why` (spaced form) still behaves the same", () => {
    const { dirs, diags } = inlineOf("// @nudo:as string() // why\nconst value = 1;");
    expect(dirs).toHaveLength(1);
    if (dirs[0]!.kind === "as") expect(dirs[0]!.typeAbs.shape.k).toBe("prim");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("Trailing comment in @nudo:as type expression");
  });

  it("comment markers inside a string literal are not a trailing comment", () => {
    const { dirs, diags } = inlineOf('// @nudo:as lit("a//b")\nconst value = 1;');
    expect(dirs).toHaveLength(1);
    if (dirs[0]!.kind === "as") expect(dirs[0]!.typeAbs.shape.k).toBe("prim");
    expect(diags).toEqual([]);
  });

  it("`//` right after `)` is a comment (not swallowed into the expression)", () => {
    const { dirs, diags } = inlineOf("// @nudo:as number()//note\nconst value = 1;");
    expect(dirs).toHaveLength(1);
    if (dirs[0]!.kind === "as") expect(dirs[0]!.typeAbs.shape.k).toBe("prim");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("Trailing comment in @nudo:as type expression");
  });
});
});

// ---------------------------------------------------------------------------
// directives inside a malformed @nudo:case must not leak
// ---------------------------------------------------------------------------
describe("directives inside a malformed @nudo:case must not leak", () => {
/**
 * **畸形**的 `@nudo:case` 不登记**参数区间掩码** ⇒ case 参数里的
 * `@nudo:mock` / `@nudo:skip` **泄漏**成真指令 ⇒ 假红 / d.ts 丢方法。
 *
 * 根因（core `directive-scan.ts` 的 `scanCaseArgSpans`）：只登记**合法** case 形态
 * （双引号名 + 同行实参括号）的区间；畸形形态（单引号名 / 空名 / 缺括号…）的实参
 * 区间没被遮罩 ⇒ 实参里的标签被当成真指令扫描。
 *
 * 掩码落在 core（core-同族钉），本钉钉**产品面**（parser 抽取面）：畸形
 * case 的实参里不再产出 mock 指令，且「畸形 case 名」诊断仍在。
 */




function fnDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return diags;
}

function kinds(src: string): string[] {
  return extractDirectives(parse(src), { diags: [] }).flatMap((f) =>
    f.directives.map((d) => d.kind),
  );
}

const MALFORMED_CASE = `/**
 * @nudo:case 'bad' (
 *   @nudo:mock fetch = (u) => ({ ok: true }))
 */
export function f(a) {
  return fetch(a).ok;
}
`;

describe("directives inside a malformed @nudo:case must not leak", () => {
  it("the inner @nudo:mock does not become a real mock directive", () => {
    expect(kinds(MALFORMED_CASE)).not.toContain("mock");
  });

  it("the malformed case name is still diagnosed", () => {
    const diags = fnDiags(MALFORMED_CASE);
    expect(diags.some((d) => d.message.includes("single-quoted name"))).toBe(true);
  });

  it("a well-formed case keeps its arguments (no over-masking)", () => {
    const ok = `/**
 * @nudo:case "ok" (1) => 2
 */
export function f(a) {
  return a + 1;
}
`;
    expect(kinds(ok)).toEqual(["case"]);
    expect(fnDiags(ok)).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// a trailing comment must not void the @nudo:case expectation
// ---------------------------------------------------------------------------
describe("a trailing comment must not void the @nudo:case expectation", () => {
/**
 * `@nudo:case` 的**期望值**里带**尾注释**（`=> string() // 注释`）
 * ⇒ 期望值解析失败 ⇒ 回退成**显式 unknown** ⇒ **断言被静默作废**（报「1 passed」、
 * exit 0 的**假绿**）。
 *
 * 根因：`=> expected` 表达式没有尾注释归一化——注释被并进表达式 ⇒
 * `parseAbsExprDiag` 解析失败。
 */





function fnDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return diags;
}

function caseExpected(src: string): string | undefined {
  const fns = extractDirectives(parse(src), { diags: [] });
  for (const fn of fns) {
    for (const d of fn.directives) {
      if (d.kind === "case") return d.expected === undefined ? undefined : formatShape(d.expected);
    }
  }
  return undefined;
}

const WITH_COMMENT = `/**
 * @nudo:case "x" (1) => string() // 期望值是字符串
 */
export function f(a) {
  return a + 1;
}
`;

const WITHOUT_COMMENT = `/**
 * @nudo:case "x" (1) => string()
 */
export function f(a) {
  return a + 1;
}
`;

describe("a trailing comment must not void the @nudo:case expectation", () => {
  it("the expected type is parsed (not degraded to unknown)", () => {
    expect(caseExpected(WITH_COMMENT)).toBe("string");
  });

  it("the commented form equals the plain form", () => {
    expect(caseExpected(WITH_COMMENT)).toBe(caseExpected(WITHOUT_COMMENT));
  });

  it("no nudo:directive-syntax warning is emitted", () => {
    expect(fnDiags(WITH_COMMENT)).toEqual([]);
  });

  it("a `//` inside a string literal stays part of the expression", () => {
    const src = `/**
 * @nudo:case "x" (1) => shape({ url: string() })
 */
export function f(a) {
  return a;
}
`;
    expect(fnDiags(src)).toEqual([]);
    expect(caseExpected(src)).toContain("url");
  });
});

describe("(same family): the @nudo:skip return type must not be voided by a trailing comment", () => {
  function skipReturns(src: string): string | undefined {
    const fns = extractDirectives(parse(src), { diags: [] });
    for (const fn of fns) {
      for (const d of fn.directives) {
        if (d.kind === "skip" && d.returns !== null) {
          return d.returns === undefined ? undefined : formatShape(d.returns);
        }
      }
    }
    return undefined;
  }

  it("`@nudo:skip => number() // 注释` keeps the declared return type", () => {
    const src = `/**
 * @nudo:skip => number() // 期望返回数字
 */
export function f(a) {
  return a + 1;
}
`;
    expect(skipReturns(src)).toBe("number");
  });

  it("the commented form equals the plain form", () => {
    const plain = `/**
 * @nudo:skip => number()
 */
export function f(a) {
  return a + 1;
}
`;
    expect(skipReturns(plain)).toBe("number");
  });

  it("no nudo:directive-syntax warning is emitted", () => {
    const src = `/**
 * @nudo:skip => number() // 期望返回数字
 */
export function f(a) {
  return a + 1;
}
`;
    expect(fnDiags(src)).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// a glued @nudo:case"name" tag must be visible to the scanner
// ---------------------------------------------------------------------------
describe("a glued @nudo:case\"name\" tag must be visible to the scanner", () => {
/**
 * `@nudo:case"c1" (1, 2)`（标签与名字之间**无空白**）⇒ 抽取侧（严格
 * `[ \t]+`）**不匹配** + 诊断侧（宽松 `[ \t]*`）**判合法** ⇒ 整条 case **静默
 * 蒸发** ⇒ `nudo test` 一个 case 都不跑、**零诊断**（假绿）。
 *
 * 改后：诊断面按**抽取侧的真实文法**判定 ⇒ 粘连写法命中
 * `nudo:directive-syntax`（口径与族 28 的 `@nudo:mock` 粘连写法一致）。
 */




function fnDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return diags;
}

function caseDirectives(src: string): unknown[] {
  return extractDirectives(parse(src), { diags: [] }).flatMap((f) =>
    f.directives.filter((d) => d.kind === "case"),
  );
}

const GLUED = `/**
 * @nudo:case"c1" (1, 2)
 */
export function add(a, b) {
  return a + b;
}
`;

describe("a glued @nudo:case\"name\" tag must be visible to the scanner", () => {
  it("emits nudo:directive-syntax naming the missing space", () => {
    const diags = fnDiags(GLUED);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain(
      "expected a space between '@nudo:case' and the name",
    );
  });

  it("the glued tag does not become a case directive", () => {
    expect(caseDirectives(GLUED)).toEqual([]);
  });

  it("the spaced form still works and stays silent", () => {
    const spaced = `/**
 * @nudo:case "c1" (1, 2)
 */
export function add(a, b) {
  return a + b;
}
`;
    expect(fnDiags(spaced)).toEqual([]);
    expect(caseDirectives(spaced)).toHaveLength(1);
  });
});
});

// ---------------------------------------------------------------------------
// diagnostic dedup identity carries the position
// ---------------------------------------------------------------------------
describe("diagnostic dedup identity carries the position", () => {
/**
 * 指令诊断的**去重身份 = 文案**（无位置）⇒ 同文件两处**逐字相同**的
 * 畸形指令**塌缩成一条** ⇒ 第二处**完全不可见**（用户修好第一处后以为已经修完）。
 *
 * 根因（diag.ts `emitDirectiveDiag`）：去重键 = `code \0 message`——`DirectiveDiag`
 * 此前**没有位置字段** ⇒ 无法区分两处不同的出错点。
 *
 * 修法：`DirectiveDiag` 带**位置**（`at: { line, column }`），去重身份 =
 * `code + 文案 + 位置`——**同一处同一问题**仍去重（extract + 再解析共域），
 * **不同位置**的同文案问题各报一条。
 *
 * 未升级的调用点（不传 `at`）保持旧身份（`code + 文案`）——兼容期行为，
 * 这些族的「同文案塌缩」仍存在（需各片按交付报告接线）。
 */





describe("diagnostic dedup identity carries the position", () => {
  it("same code+message at two positions → two diagnostics", () => {
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => {
      emitDirectiveDiag({
        code: "nudo:directive-syntax",
        message: "Malformed @nudo:case: …",
        at: { line: 2, column: 3 },
      });
      emitDirectiveDiag({
        code: "nudo:directive-syntax",
        message: "Malformed @nudo:case: …",
        at: { line: 7, column: 3 },
      });
    });
    expect(diags).toHaveLength(2);
    expect(diags[0]!.at).toEqual({ line: 2, column: 3 });
    expect(diags[1]!.at).toEqual({ line: 7, column: 3 });
  });

  it("same code+message at the same position → one diagnostic (same defect)", () => {
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => {
      emitDirectiveDiag({
        code: "nudo:directive-syntax",
        message: "Malformed @nudo:case: …",
        at: { line: 2, column: 3 },
      });
      emitDirectiveDiag({
        code: "nudo:directive-syntax",
        message: "Malformed @nudo:case: …",
        at: { line: 2, column: 3 },
      });
    });
    expect(diags).toHaveLength(1);
  });

  it("without a position the legacy identity (code+message) still dedups", () => {
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => {
      emitDirectiveDiag({ code: "nudo:directive-syntax", message: "same text" });
      emitDirectiveDiag({ code: "nudo:directive-syntax", message: "same text" });
    });
    expect(diags).toHaveLength(1);
  });

  it("two identical `@nudo:as` trailing comments in one block → two diagnostics", () => {
    // 同一注释块内的两条**逐字相同**的畸形指令（同一去重域）⇒ 改前塌缩成一条
    const src = [
      "/**",
      " * @nudo:as string()// why",
      " * @nudo:as string()// why",
      " */",
      "const a = 1;",
      "",
    ].join("\n");
    const ast = parse(src);
    const stmt = ast.program.body[0]!;
    const diags: DirectiveDiag[] = [];
    extractInlineDirectives(stmt, { diags });
    const trailing = diags.filter((d) => d.message.includes("Trailing comment in @nudo:as"));
    expect(trailing).toHaveLength(2);
    expect(trailing[0]!.at).toBeDefined();
    expect(trailing[1]!.at).toBeDefined();
    expect(trailing[0]!.at!.line).not.toBe(trailing[1]!.at!.line);
  });

  it("the same directive scanned twice at the same position → one diagnostic", () => {
    const src = "// @nudo:as string()// why\nconst a = 1;\n";
    const ast = parse(src);
    const stmt = ast.program.body[0]!;
    const diags: DirectiveDiag[] = [];
    // 同一去重域（extract + 再解析共域口径）⇒ 同一处同一问题只报一次
    runWithDirectiveDiags(diags, () => {
      extractInlineDirectives(stmt);
      extractInlineDirectives(stmt);
    });
    expect(diags.filter((d) => d.message.includes("Trailing comment in @nudo:as"))).toHaveLength(1);
  });

  it("two identical malformed `@nudo:case` in different functions → two diagnostics", () => {
    // 848 的**原始复现族**：函数级扫描器（fn-directives）发射的畸形 case 诊断
    // 也必须带位置 ⇒ 两处逐字相同的问题各报一条
    const src = [
      "/**",
      " * @nudo:case 't' (1)",
      " */",
      "function f(x) { return x; }",
      "/**",
      " * @nudo:case 't' (1)",
      " */",
      "function g(x) { return x; }",
      "",
    ].join("\n");
    const diags: DirectiveDiag[] = [];
    extractDirectives(parse(src), { diags });
    const malformed = diags.filter((d) => d.message.includes("Malformed @nudo:case"));
    expect(malformed).toHaveLength(2);
    expect(malformed[0]!.at).toBeDefined();
    expect(malformed[1]!.at).toBeDefined();
    expect(malformed[0]!.at!.line).not.toBe(malformed[1]!.at!.line);
  });
});
});

// ---------------------------------------------------------------------------
// `=>` with a missing expected expression must not be silent
// ---------------------------------------------------------------------------
describe("`=>` with a missing expected expression must not be silent", () => {
/**
 * `=> expected` 在「`=>` 后为空」时被**静默丢弃** ⇒ 该 case 判
 * `[unchecked]` ⇒ 断言**不执法**、`nudo test` **exit 0**、**屏幕上零诊断**
 * （完全静默的假绿）。
 *
 * 改后：期望**写了却抽不出** ⇒ 发 `nudo:directive-syntax`（不再静默吞错）；
 * 期望值在**下一行**时照旧被抽出（核心抽取层负责）。
 */




function fnDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return diags;
}

function caseDirectives(src: string): unknown[] {
  return extractDirectives(parse(src), { diags: [] }).flatMap((f) =>
    f.directives.filter((d) => d.kind === "case"),
  );
}

describe("`=>` with a missing expected expression must not be silent", () => {
  it("emits nudo:directive-syntax for the empty `=>` tail", () => {
    const diags = fnDiags(`/** @nudo:case "empty" (1) =>  */
export function f(x) {
  return x;
}
`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("missing expected expression after '=>'");
  });

  it("negative control: a case without `=>` stays silent", () => {
    expect(
      fnDiags(`/** @nudo:case "plain" (1) */
export function f(x) {
  return x;
}
`),
    ).toEqual([]);
  });

  it("negative control: a well-formed expectation stays silent", () => {
    expect(
      fnDiags(`/** @nudo:case "ok" (1) => 999 */
export function f(x) {
  return x;
}
`),
    ).toEqual([]);
    expect(
      caseDirectives(`/** @nudo:case "ok" (1) => 999 */
export function f(x) {
  return x;
}
`),
    ).toHaveLength(1);
  });

  it("the expectation on the next line is picked up (no diagnostic)", () => {
    const src = `/**
 * @nudo:case "multi" (2) =>
 *   4
 */
export function f(x) {
  return x * 2;
}
`;
    expect(fnDiags(src)).toEqual([]);
    expect(caseDirectives(src)).toHaveLength(1);
  });
});
});

// ---------------------------------------------------------------------------
// 期望值解析失败不得空洞通过（断言层必须看到失败）
// ---------------------------------------------------------------------------
describe("期望值解析失败不得空洞通过（断言层必须看到失败）", () => {
/**
 * 回归：`@nudo:case` 的**期望值**解析失败与「显式 unknown」共用同一个
 * unknown Abs ⇒ 断言面把「没读懂用户的期望」记成「断言通过」
 * （[ok] / 1 passed / exit 0 = 假绿）。
 *
 * 修法（parser 侧）：期望值的解析失败产出**失败表示**（never），与显式 unknown
 * 在 Abs 层面可区分；断言层据此判 FAIL（fail-closed）。
 * 另提供严格 API `parseCaseExpectedAbs`：失败 ⇒ undefined，供下游按
 * 「unchecked（没被检查）」口径收口。
 */







function extractWithDiags(source: string) {
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(parse(source), { diags });
  return { fns, diags };
}

const EXPECTED_CTX = '@nudo:case "t" => expected';

describe("期望值解析失败不得空洞通过（断言层必须看到失败）", () => {
  it("directive.expected：解析失败 ⇒ 失败表示；显式 unknown ⇒ unknown", () => {
    const { fns } = extractWithDiags(`/**
 * @nudo:case "malformed" (1) => bogus()
 * @nudo:case "explicit" (1) => unknown
 */
function f(x) { return x; }`);
    const cases = fns.flatMap(
      (f) => f.directives.filter((d) => d.kind === "case"),
    ) as CaseDirective[];
    expect(cases).toHaveLength(2);
    // 解析失败：不是 unknown（顶类型 ⇒ leqAbs 恒 ok ⇒ 空洞通过）
    expect(cases[0]!.expected).toBeDefined();
    expect(cases[0]!.expected!.shape.k).not.toBe("unknown");
    // 显式 unknown：用户主动声明「不约束」，保持 unknown
    expect(cases[1]!.expected!.shape.k).toBe("unknown");
  });

  it("解析失败仍发 nudo:directive-syntax 诊断（不是静默）", () => {
    const { diags } = extractWithDiags(`/**
 * @nudo:case "malformed" (1) => bogus()
 */
function f(x) { return x; }`);
    expect(
      diags.some(
        (d) =>
          d.code === "nudo:directive-syntax" &&
          d.message.includes("=> expected") &&
          d.message.includes("bogus()"),
      ),
    ).toBe(true);
  });

  it("严格 API parseCaseExpectedAbs：失败 ⇒ undefined（可传递的失败表示）", () => {
    const diags: DirectiveDiag[] = [];
    const failed = runWithDirectiveDiags_____directives_ts(diags, () =>
      parseCaseExpectedAbs("bogus()", EXPECTED_CTX),
    );
    expect(failed).toBeUndefined();
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");

    // 合法期望值 / 显式 unknown ⇒ 仍是 Abs（不是失败）
    expect(parseCaseExpectedAbs("1e3", EXPECTED_CTX)).toBeDefined();
    expect(parseCaseExpectedAbs("unknown", EXPECTED_CTX)).toBeDefined();
  });
});
});

// ---------------------------------------------------------------------------
// 解析失败 ≠ 显式 unknown（失败必须传到断言层）
// ---------------------------------------------------------------------------
describe("解析失败 ≠ 显式 unknown（失败必须传到断言层）", () => {
/**
 * 回归：`parseAbsExprDiag` 把**解析失败**折成**显式 unknown Abs**
 * ⇒ `leqAbs(actual, unknown)` 恒 ok（unknown 是顶类型）⇒ 断言**空洞通过**
 * （报「1 passed」、exit 0 = 假绿）。
 *
 * 修法：解析失败与「显式 unknown」在 Abs 层面**可区分** —— 失败用失败表示
 * （never，底类型：没有任何实际值满足它 ⇒ 断言判 FAIL），显式 unknown 仍是
 * 顶类型（用户主动声明，不约束）。
 */




function withDiags<T>(fn: () => T): { value: T; diags: DirectiveDiag[] } {
  const diags: DirectiveDiag[] = [];
  const value = runWithDirectiveDiags_____directives_ts_1(diags, fn);
  return { value, diags };
}

const EXPECTED_CTX = '@nudo:case "t" => expected';

describe("解析失败 ≠ 显式 unknown（失败必须传到断言层）", () => {
  it("解析失败 ⇒ 失败表示（never），不是 unknown（顶类型）", () => {
    const { value } = withDiags(() => parseAbsExprDiag("bogus()", EXPECTED_CTX));
    expect(value.shape.k).toBe("never");
    expect(value.shape.k).not.toBe("unknown");
  });

  it("显式 unknown / any / any() 仍是 unknown（用户主动声明，不约束）", () => {
    for (const expr of ["unknown", "any", "any()"]) {
      const { value, diags } = withDiags(() => parseAbsExprDiag(expr, EXPECTED_CTX));
      expect(value.shape.k, expr).toBe("unknown");
      expect(diags, expr).toHaveLength(0);
    }
  });

  it("解析失败发 nudo:directive-syntax 诊断（文案带 tag 位置）", () => {
    const { diags } = withDiags(() => parseAbsExprDiag("bogus()", EXPECTED_CTX));
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain(EXPECTED_CTX);
    expect(diags[0]!.message).toContain("bogus()");
  });

  it("非断言面上下文（@nudo:as / @nudo:replace / @nudo:skip）保持 unknown", () => {
    // 这些上下文的 Abs 会进类型覆盖面 / 求值面：never 会污染那里的语义
    for (const ctx of ["@nudo:as", "@nudo:replace", "@nudo:skip =>"]) {
      const { value } = withDiags(() => parseAbsExprDiag("bogus()", ctx));
      expect(value.shape.k, ctx).toBe("unknown");
    }
  });
});
});

// ---------------------------------------------------------------------------
// file-level directives in a class / object body are not file scope
// ---------------------------------------------------------------------------
describe("file-level directives in a class / object body are not file scope", () => {
/**
 * 的「文件级指令**位置闸门**」漏掉 **class 体 / 对象字面量体**
 * ⇒ 方法（字段）**上方**的 `/// @nudo:env` 被**静默提升**成**整文件** env（零诊断）。
 *
 * 根因（`file-directives.ts` 的 `functionBodyRanges`）：闸门区间取自
 * `listFnDirectiveScopes` 的 `scope.node.start/end`；对 `ClassMethod` /
 * `ObjectMethod`，Babel 给的 `node.start` 是**方法键**的位置 ⇒ 方法**上方**的
 * 行注释落在区间**之外** ⇒ 不算 misplaced ⇒ 指令被提升成文件级。
 *
 * 修法：闸门区间再纳入**类体（`ClassBody`）**与**对象字面量体
 * （`ObjectExpression`）** ⇒ 方法 / 字段上方的注释一并被拦下（忽略 +
 * `nudo:directive-syntax` 告警），与函数体口径一致。
 *
 * ⚠ 类**声明上方**的注释（`/// @nudo:env node` 写在 `class A {` 之前）仍是
 * 合法的顶层位置 ⇒ 放行（对照组）。
 */




function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

/** 类体里、方法上方的文件级指令。 */
const ENV_IN_CLASS = `export class A {
  /// @nudo:env node
  m() {
    return 1;
  }
}
`;

/** 对象字面量里、方法上方的文件级指令。 */
const ENV_IN_OBJECT = `export const o = {
  /// @nudo:env node
  m() {
    return 1;
  },
};
`;

/** 类体里、字段上方的文件级指令。 */
const ENV_IN_CLASS_FIELD = `export class A {
  /// @nudo:env node
  x = 1;
}
`;

/** mock-module 同样受闸门约束。 */
const MOCK_MODULE_IN_CLASS = `export class A {
  /// @nudo:mock-module "fs" from "./mock-fs.js"
  m() {
    return 1;
  }
}
`;

describe("file-level directives in a class / object body are not file scope", () => {
  it("`/// @nudo:env node` above a class method is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_CLASS);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("at the top of the file");
    expect(extractFileDirectives(parse(ENV_IN_CLASS), { diags: [] })).toEqual([]);
  });

  it("`/// @nudo:env node` above an object-literal method is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_OBJECT);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(ENV_IN_OBJECT), { diags: [] })).toEqual([]);
  });

  it("`/// @nudo:env node` above a class field is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_CLASS_FIELD);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(ENV_IN_CLASS_FIELD), { diags: [] })).toEqual([]);
  });

  it("`/// @nudo:mock-module` above a class method is not promoted + is diagnosed", () => {
    const diags = fileDiags(MOCK_MODULE_IN_CLASS);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(MOCK_MODULE_IN_CLASS), { diags: [] })).toEqual([]);
  });

  it("control: the same directive above the class declaration still works", () => {
    const src = `/// @nudo:env node\nexport class A {\n  m() {\n    return 1;\n  }\n}\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node"] },
    ]);
  });

  it("control: the same directive above the object literal statement still works", () => {
    const src = `/// @nudo:env node\nexport const o = {\n  a: 1,\n};\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node"] },
    ]);
  });

  it("control: a directive inside a function body is still diagnosed (Bug 847 unchanged)", () => {
    const src = `export function f(a) {\n  /// @nudo:env node\n  return 1;\n}\n`;
    const diags = fileDiags(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// file-level directives in an array / destructuring body are not file scope
// ---------------------------------------------------------------------------
describe("file-level directives in an array / destructuring body are not file scope", () => {
/**
 * 文件级指令的**位置闸门**漏掉 **ArrayExpression（数组字面量体）**
 * 与 **ObjectPattern（解构模式体）** ⇒ 写在数组元素 / 解构键**上方**的
 * `/// @nudo:env` 被**静默提升**成**整文件** env（零诊断）。
 *
 * 根因：闸门区间只覆盖「函数体」（）+「类体 / 对象字面量体」
 * （）；数组字面量体与解构模式体同属**嵌套体**，却**不在**闸门区间内
 * ⇒ 同族洞未闭合（两条通道**同口径**地漏，不是通道漂移）。
 *
 * 修法：闸门区间再纳入 `ArrayExpression` 与 `ObjectPattern`（+ 同族孪生
 * `ArrayPattern`）（parser AST 通道 + core 文本通道**孪生同款**）⇒ 数组元素 /
 * 解构键上方的文件级指令被拦下（不提升 + `nudo:directive-syntax` 告警，
 * **既有诊断码**）。
 *
 * ⚠ 声明**上方**的顶层指令（`class A {` / `const a = [` / `const {` 之前）
 * 仍是合法的顶层位置 ⇒ 放行（对照组）。
 */





function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

/** parser AST 通道抽到的 env 名（文件级）。 */
function parserEnvs(src: string): string[] {
  return extractFileDirectives(parse(src), { diags: [] })
    .filter((d) => d.kind === "env")
    .flatMap((d) => d.envs);
}

/** parser AST 通道抽到的 mock-module 记录（归一化，与 core 文本通道同形）。 */
function parserMockModules(src: string): Array<{
  source: string;
  names?: string[];
  fromPath: string;
}> {
  return extractFileDirectives(parse(src), { diags: [] })
    .filter((d) => d.kind === "mock-module")
    .map((d) => ({
      source: d.source,
      ...(d.names ? { names: d.names } : {}),
      fromPath: d.fromPath,
    }));
}

/** core 文本通道抽到的 mock-module 记录（同形归一化）。 */
function coreMockModules(src: string): Array<{
  source: string;
  names?: string[];
  fromPath: string;
}> {
  return extractMockModuleRecords(src).map((r) => ({
    source: r.source,
    ...(r.names ? { names: r.names } : {}),
    fromPath: r.fromPath,
  }));
}

// ---------------------------------------------------------------------------
// 样例（新增两类嵌套体）
// ---------------------------------------------------------------------------

/** 数组字面量体：元素上方的文件级指令。 */
const ENV_IN_ARRAY = `export const a = [
  /// @nudo:env node
  1,
];
`;

/** 解构模式体（`ObjectPattern`）：键上方的文件级指令。 */
const ENV_IN_OBJECT_PATTERN = `export const {
  /// @nudo:env node
  a,
} = obj;
`;

/** 数组解构模式体（`ArrayPattern`，`ObjectPattern` 的同族孪生）：元素上方的文件级指令。 */
const ENV_IN_ARRAY_PATTERN = `export const [
  /// @nudo:env node
  a,
] = arr;
`;

/** 数组字面量体里的 mock-module。 */
const MOCK_MODULE_IN_ARRAY = `export const a = [
  /// @nudo:mock-module "fs" from "./mock-fs.js"
  1,
];
`;

/** 解构模式体里的 mock-module。 */
const MOCK_MODULE_IN_OBJECT_PATTERN = `export const {
  /// @nudo:mock-module "fs" from "./mock-fs.js"
  a,
} = obj;
`;

/** 更深一层：数组里的数组。 */
const ENV_IN_NESTED_ARRAY = `export const a = [
  [
    /// @nudo:env node
    1,
  ],
];
`;

// ---------------------------------------------------------------------------
// 验收 1 / 2：数组字面量体 + 解构模式体
// ---------------------------------------------------------------------------

describe("file-level directives in an array / destructuring body are not file scope", () => {
  it("`/// @nudo:env node` above an array element is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_ARRAY);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("at the top of the file");
    expect(extractFileDirectives(parse(ENV_IN_ARRAY), { diags: [] })).toEqual([]);
    // core 文本通道：同一口径 ⇒ 同样不生效
    expect(extractFileEnvNames(ENV_IN_ARRAY)).toEqual([]);
  });

  it("`/// @nudo:env node` above a destructuring key is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_OBJECT_PATTERN);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("at the top of the file");
    expect(extractFileDirectives(parse(ENV_IN_OBJECT_PATTERN), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(ENV_IN_OBJECT_PATTERN)).toEqual([]);
  });

  it("`/// @nudo:env node` above an array-pattern element is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_ARRAY_PATTERN);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("at the top of the file");
    expect(extractFileDirectives(parse(ENV_IN_ARRAY_PATTERN), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(ENV_IN_ARRAY_PATTERN)).toEqual([]);
  });

  it("`/// @nudo:mock-module` above an array element is not promoted + is diagnosed", () => {
    const diags = fileDiags(MOCK_MODULE_IN_ARRAY);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(MOCK_MODULE_IN_ARRAY), { diags: [] })).toEqual([]);
    expect(extractMockModuleRecords(MOCK_MODULE_IN_ARRAY)).toEqual([]);
  });

  it("`/// @nudo:mock-module` above a destructuring key is not promoted + is diagnosed", () => {
    const diags = fileDiags(MOCK_MODULE_IN_OBJECT_PATTERN);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(MOCK_MODULE_IN_OBJECT_PATTERN), { diags: [] })).toEqual([]);
    expect(extractMockModuleRecords(MOCK_MODULE_IN_OBJECT_PATTERN)).toEqual([]);
  });

  it("a nested array body is gated too (deeper nesting)", () => {
    const diags = fileDiags(ENV_IN_NESTED_ARRAY);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(ENV_IN_NESTED_ARRAY), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(ENV_IN_NESTED_ARRAY)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 验收 3：类体 / 对象字面量体（ 行为不得回退）
// ---------------------------------------------------------------------------

describe("the class / object body gate () is not regressed", () => {
  it("`/// @nudo:env node` above a class method is still blocked + diagnosed", () => {
    const src = `export class A {\n  /// @nudo:env node\n  m() {\n    return 1;\n  }\n}\n`;
    const diags = fileDiags(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(src)).toEqual([]);
  });

  it("`/// @nudo:env node` above a class field is still blocked + diagnosed", () => {
    const src = `export class A {\n  /// @nudo:env node\n  x = 1;\n}\n`;
    const diags = fileDiags(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(src)).toEqual([]);
  });

  it("`/// @nudo:env node` above an object-literal method is still blocked + diagnosed", () => {
    const src = `export const o = {\n  /// @nudo:env node\n  m() {\n    return 1;\n  },\n};\n`;
    const diags = fileDiags(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(src)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 验收 4 / 5：合法顶层位置放行（不得过度拦截）
// ---------------------------------------------------------------------------

describe("legal top-level positions still pass (no over-blocking)", () => {
  it("a top-of-file directive still works", () => {
    const src = `/// @nudo:env node\nexport function f() {\n  return 1;\n}\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node"] },
    ]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a directive above a class declaration still works", () => {
    const src = `/// @nudo:env node\nexport class A {\n  m() {\n    return 1;\n  }\n}\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a directive above an object literal statement still works", () => {
    const src = `/// @nudo:env node\nexport const o = {\n  a: 1,\n};\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a directive above an array literal statement still works", () => {
    const src = `/// @nudo:env node\nexport const a = [1, 2];\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a directive above a destructuring declaration still works", () => {
    const src = `/// @nudo:env node\nexport const { a, b } = obj;\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a directive above an array-destructuring declaration still works", () => {
    const src = `/// @nudo:env node\nexport const [a, b] = arr;\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a top-level directive after an array literal still works", () => {
    const src = `export const a = [1, 2];\n/// @nudo:env node\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
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
