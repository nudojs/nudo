/**
 * 模块套件：emit 产物保真面（缩进/CRLF/BOM/EOF/section 幂等/可重现）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { abs as makeAbs, num, abs, numLit, type Abs, execNudoModule, formatConstraint, type NudoConstraint } from "@nudojs/core";
import { analyzeFile, type AnalysisResult } from "@nudojs/service";
import { insertGeneratedCaseDirectives, serializeCaseArgs, buildCaseDirective, unifiedDiff, stripGeneratedCaseDirectives } from "../case-emitter.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitContract } from "../contract-emitter.ts";
import { sanitizeCommentText } from "@nudojs/core/internal";
import { sanitizeLineCommentText } from "../line-comment.ts";
import { formatDraftModule } from "../contract-draft.ts";
import { absToZodSchemaModule } from "../schema-generator.ts";
import { absToStandardSchemaModule } from "../standard-schema.ts";
import { generateFunctionDtsLines } from "../dts-generator.ts";
import type { CaseResult, FunctionAnalysis } from "../../analyzer-types.ts";
import { defaultLoadModule } from "../../load-module.ts";
import { deriveFromRoot, emitDerivedFromRoot } from "../contract-derivation.ts";

// ---------------------------------------------------------------------------
// Bug 507 — freeze 写回的 JSDoc 块按声明语句列缩进
// ---------------------------------------------------------------------------
describe("[emit-] Bug 507 — freeze 写回的 JSDoc 块按声明语句列缩进", () => {
// emit--freeze-indent.part.ts — Bug 507：
// `nudo test --freeze` 为**导出函数**写回的 JSDoc 块缩进错位
//（按 `function` 关键字列号缩进，而非声明语句列号）。
//
// 复现形态：`export function greet(u) {...}` 的函数节点列是 7
//（`export default function` 是 15），但**声明语句**在列 0 ⇒ 旧实现把整块
// 右移 7/15 列，块与声明视觉脱节。
//
// 修法：缩进基准改为**声明行的行首缩进**（见 case-emitter.ts 的
// leadingIndent / insertGeneratedCaseDirectives）。
//
// 用例含：
// - 改前会失败的形态（导出函数 / 默认导出函数 ⇒ 块必须在列 0）；
// - 负控制（嵌套函数仍按声明行缩进 ⇒ 修复不把所有块拍平到列 0；
//   已有 JSDoc 块的注入位置不受影响）。





function absExact(shape: Parameters<typeof makeAbs>[0]): ReturnType<typeof makeAbs> {
  return makeAbs(shape, undefined, undefined, "exact");
}

function makeFn(
  name: string,
  line: number,
  cases: Array<{ name: string; args: ReturnType<typeof makeAbs>[]; source?: "callsite" }>,
  flags: { column?: number } = {},
): FunctionAnalysis {
  return {
    name,
    loc: { start: { line, column: flags.column ?? 0 }, end: { line, column: 0 } },
    paramNames: [],
    cases: cases.map((c) => ({
      name: c.name,
      argAbs: c.args,
      abs: absExact({ k: "unknown" }),
      throwsAbs: absExact({ k: "never" }),
      source: c.source,
    })),
  };
}

function makeAnalysis(functions: FunctionAnalysis[]): AnalysisResult {
  return { functions, diagnostics: [], bindings: new Map(), nodeAbsMap: new Map(), caseHints: [] };
}

/** 源文件里某行的行首缩进（0 基列） */
function indentOf(source: string, lineText: string): number {
  const line = source.split("\n").find((l) => l.includes(lineText));
  return line === undefined ? -1 : line.length - line.trimStart().length;
}

describe("Bug 507 — freeze 写回的 JSDoc 块按声明语句列缩进", () => {
  it("export function：块落在列 0（不是 function 关键字的列 7）", () => {
    const source = `export function greet(u) {
  return u.name;
}
const r = greet({ name: "Ada" });
`;
    const analysis = analyzeFile("/test/bug-507-export.js", source);
    const fn = analysis.functions.find((f) => f.name === "greet");
    // 前置：真实分析器给出的函数节点列确实是 7（`function` 关键字所在列）
    expect(fn?.loc.start.column).toBe(7);

    const result = insertGeneratedCaseDirectives(source, analysis);
    expect(result.changed).toBe(true);
    const blockLine = result.source.split("\n").find((l) => l.includes("/**"));
    expect(blockLine).toBe("/**");
    expect(indentOf(result.source, "/**")).toBe(0);
    // 指令行与块尾行同样在列 0
    expect(result.source.split("\n")[1]).toBe(' * @nudo:case "call@L4" ({ name: "Ada" })');
    expect(result.source.split("\n")[2]).toBe(" */");
  });

  it("export default function：块落在列 0（不是 function 关键字的列 15）", () => {
    const source = `export default function greet(u) {
  return u.name;
}
const r = greet({ name: "Ada" });
`;
    const analysis = analyzeFile("/test/bug-507-export-default.js", source);
    const fn = analysis.functions.find((f) => f.name === "greet");
    expect(fn?.loc.start.column).toBe(15);

    const result = insertGeneratedCaseDirectives(source, analysis);
    expect(result.changed).toBe(true);
    expect(result.source.split("\n")[0]).toBe("/**");
    expect(indentOf(result.source, "/**")).toBe(0);
  });

  it("负控制：嵌套函数仍按声明行的行首缩进（修复不把所有块拍平到列 0）", () => {
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
   * @nudo:case "call@L5" (number())
   */
  function inner(x) {
    return x;
  }
  return inner(1);
}
`);
  });

  it("负控制：已有 JSDoc 块时指令行沿用块自身的缩进（不按函数节点列）", () => {
    const source = `/**
 * Adds numbers.
 */
export function add(a, b) {
  return a + b;
}
const r = add(1, 2);
`;
    const analysis = analyzeFile("/test/bug-507-existing-block.js", source);
    const result = insertGeneratedCaseDirectives(source, analysis);
    expect(result.changed).toBe(true);
    expect(result.source.split("\n")[1]).toMatch(/^ \* @nudo:case "call@L\d+"/);
    // 块首行仍是原样（列 0）
    expect(result.source.split("\n")[0]).toBe("/**");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 547 — freeze 写回不污染 CRLF 源文件的行尾
// ---------------------------------------------------------------------------
describe("[emit-] Bug 547 — freeze 写回不污染 CRLF 源文件的行尾", () => {
// emit--freeze-crlf.part.ts — Bug 547：
// `nudo test --freeze` 把新 `@nudo:case` 块写进 **CRLF 源文件** ⇒ **混合行尾**
//（源文件被污染：原行保留 CRLF，新插入的行是裸 LF）。
//
// 复现形态：CRLF 文件固化后 `file(1)` 从「with CRLF line terminators」变成
// 「with CRLF, LF line terminators」。
//
// 修法：新插入的行按**源文件的主导行尾**写回（case-emitter.ts 的
// dominantEol / insertGeneratedCaseDirectives）——CRLF 主导 ⇒ 新行自带 "\r"。
//
// 用例含：
// - 改前会失败的形态（CRLF 文件写回后不得出现裸 LF）；
// - 负控制（LF 文件仍是 LF；原行行尾逐行保留；指令文本本身不变；
//   二次固化幂等 ⇒ already-generated、不再写盘）。





function absExact(shape: Parameters<typeof makeAbs>[0]): ReturnType<typeof makeAbs> {
  return makeAbs(shape, undefined, undefined, "exact");
}

function makeFn(name: string, line: number, caseName: string): FunctionAnalysis {
  return {
    name,
    loc: { start: { line, column: 0 }, end: { line, column: 0 } },
    paramNames: [],
    cases: [
      {
        name: caseName,
        argAbs: [num()],
        abs: absExact({ k: "unknown" }),
        throwsAbs: absExact({ k: "never" }),
        source: "callsite",
      },
    ],
  };
}

function makeAnalysis(functions: FunctionAnalysis[]): AnalysisResult {
  return { functions, diagnostics: [], bindings: new Map(), nodeAbsMap: new Map(), caseHints: [] };
}

/** 文件里的裸 LF 数（不含 CRLF 的 "\r\n"） */
function bareLfCount(text: string): number {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length;
  return lf - crlf;
}

describe("Bug 547 — freeze 写回不污染 CRLF 源文件的行尾", () => {
  const CRLF_SOURCE = "export function f(x) {\r\n  return x + 1;\r\n}\r\n";

  it("CRLF 文件：固化后仍是纯 CRLF（新块不带裸 LF）", () => {
    const result = insertGeneratedCaseDirectives(
      CRLF_SOURCE,
      makeAnalysis([makeFn("f", 1, "call@L2")]),
    );
    expect(result.changed).toBe(true);
    expect(bareLfCount(result.source)).toBe(0);
    // 期望形态：新块三行都以 CRLF 收尾
    expect(result.source).toBe(
      "/**\r\n" +
        ' * @nudo:case "call@L2" (number())\r\n' +
        " */\r\n" +
        "export function f(x) {\r\n" +
        "  return x + 1;\r\n" +
        "}\r\n",
    );
  });

  it("CRLF 文件：原行的行尾逐行保留（不被改写成 LF）", () => {
    const result = insertGeneratedCaseDirectives(
      CRLF_SOURCE,
      makeAnalysis([makeFn("f", 1, "call@L2")]),
    );
    const original = CRLF_SOURCE.split("\n");
    const emitted = result.source.split("\n");
    // 原三行（含各自的 "\r"）原样出现在写回结果里
    expect(emitted.slice(3)).toEqual(original);
  });

  it("CRLF 文件：真实分析器驱动的固化同样不混排行尾", () => {
    const source = "export function f(x) {\r\n  return x + 1;\r\n}\r\nf(1);\r\n";
    const analysis = analyzeFile("/test/bug-547-crlf.js", source);
    const result = insertGeneratedCaseDirectives(source, analysis);
    expect(result.changed).toBe(true);
    expect(bareLfCount(result.source)).toBe(0);
  });

  it("负控制：LF 文件写回后仍是 LF（不引入 CR）", () => {
    const source = "export function f(x) {\n  return x + 1;\n}\n";
    const result = insertGeneratedCaseDirectives(source, makeAnalysis([makeFn("f", 1, "call@L2")]));
    expect(result.changed).toBe(true);
    expect(result.source.includes("\r")).toBe(false);
    expect(result.source).toBe(
      "/**\n" +
        ' * @nudo:case "call@L2" (number())\n' +
        " */\n" +
        "export function f(x) {\n" +
        "  return x + 1;\n" +
        "}\n",
    );
  });

  it("负控制：二次固化幂等（CRLF 文件第二次不再写盘）", () => {
    const first = insertGeneratedCaseDirectives(
      CRLF_SOURCE,
      makeAnalysis([makeFn("f", 1, "call@L2")]),
    );
    const second = insertGeneratedCaseDirectives(
      first.source,
      makeAnalysis([makeFn("f", 1, "call@L2")]),
    );
    expect(second.changed).toBe(false);
    expect(second.written).toEqual([]);
    expect(second.skipped.map((s) => s.reason)).toContain("already-generated");
    expect(second.source).toBe(first.source);
  });
});
});

// ---------------------------------------------------------------------------
// BUG-069 —— 二次固化必须是被行号漂移免疫的 no-op
// ---------------------------------------------------------------------------
describe("[emit-] BUG-069 —— 二次固化必须是被行号漂移免疫的 no-op", () => {
/**
 * BUG-069 —— `nudo test --freeze`（默认 `add` 模式）**不幂等**：固化把 JSDoc 块
 * 插到函数声明之上 ⇒ 同一调用点的行号整体下移 ⇒ 见证名 `call@L6` → `call@L9`
 * ⇒ 「已固化」判定（只比名字）命中不了 ⇒ 再写一条语义重复的 `@nudo:case`
 * ⇒ 源码每跑一次长一条（无界增长），且 `--freeze --dry-run --exit-on-diff`
 * 第二次就 exit 1（CI 假红）。
 *
 * 判据：见证等价判定不能只看名字 —— 实参载荷（经指令文法规范化）相同即同一条
 * 见证 ⇒ 第二次固化是 **no-op**（跳过原因 `already-generated`）。
 *
 * 本钉按**真实 CLI 路径**建模：第二次插入的 analysis 来自**改写后的源码**
 * （行号已漂），而不是复用第一次的 analysis（那会因名字仍相同而假绿）。
 */




const SOURCE = `export function double(n) {
  return n * 2;
}

export function caller() {
  return double(3);
}
`;

/** 源码里 `@nudo:case` 指令条数 */
function caseCount(source: string): number {
  return (source.match(/@nudo:case/g) ?? []).length;
}

describe("BUG-069 —— 二次固化必须是被行号漂移免疫的 no-op", () => {
  it("第二次固化（重新分析改写后的源码）不再写重复指令", () => {
    const first = insertGeneratedCaseDirectives(SOURCE, analyzeFile("/t/one.js", SOURCE));
    expect(first.written.length).toBe(1);
    expect(caseCount(first.source)).toBe(1);

    // 关键：第二次的 analysis 来自**改写后的源码**（调用点行号已下移）
    const second = insertGeneratedCaseDirectives(
      first.source,
      analyzeFile("/t/one.js", first.source),
    );
    expect(second.written).toEqual([]);
    expect(second.source).toBe(first.source);
    expect(caseCount(second.source)).toBe(1);
    expect(second.skipped).toContainEqual({ fn: "double", reason: "already-generated" });
  });

  it("第三、四次固化同样 no-op（源码不再增长）", () => {
    let source = SOURCE;
    for (let i = 0; i < 4; i++) {
      const out = insertGeneratedCaseDirectives(source, analyzeFile("/t/one.js", source));
      if (i === 0) {
        expect(out.written.length).toBe(1);
      } else {
        expect(out.source).toBe(source);
      }
      source = out.source;
    }
    expect(caseCount(source)).toBe(1);
    expect(source).toBe(
      `/**
 * @nudo:case "call@L6" (3)
 */
` + SOURCE,
    );
  });

  it("同实参、不同名字的见证不重复写（两个调用点传同样的值）", () => {
    const src = `export function double(n) {
  return n * 2;
}

export function caller() {
  return double(3);
}

export function caller2() {
  return double(3);
}
`;
    const out = insertGeneratedCaseDirectives(src, analyzeFile("/t/two.js", src));
    expect(out.written.length).toBe(1);
    expect(caseCount(out.source)).toBe(1);
  });

  it("不同实参的见证仍然各自落地（不误合并）", () => {
    const src = `export function double(n) {
  return n * 2;
}

export function caller() {
  return double(3);
}

export function caller2() {
  return double(4);
}
`;
    const out = insertGeneratedCaseDirectives(src, analyzeFile("/t/three.js", src));
    expect(out.written.length).toBe(1);
    expect(caseCount(out.source)).toBe(2);
    expect(out.source).toContain("(3)");
    expect(out.source).toContain("(4)");
  });

  it("`serializeCaseArgs` 是载荷口径的唯一真源（buildCaseDirective 复用它）", () => {
    const abs = analyzeFile("/t/one.js", SOURCE).functions[0]!.cases[0]!.argAbs!;
    expect(buildCaseDirective("call@L1", abs)).toBe(
      ` * @nudo:case "call@L1" (${serializeCaseArgs(abs)})`,
    );
  });
});
});

// ---------------------------------------------------------------------------
// Bug 564 — 末行无终止符的 diff 可被 git apply 接受
// ---------------------------------------------------------------------------
describe("[emit-] Bug 564 — 末行无终止符的 diff 可被 git apply 接受", () => {
// emit--eof-diff.part.ts — Bug 564：
//
// 源文件**末尾缺少换行**时，`nudo test --freeze --dry-run` 产出的 unified diff
// **不可 apply**（缺 `\ No newline at end of file` 标记 + EOF 行模型多算一格）
// ⇒ `git apply --check -p1` exit 1；而末尾有换行的同一文件完全正常（exit 0）。
//
// 不变量：产出的 diff 必须能被 `git apply` 接受 ⇒ 行模型与 native `diff -u` /
// `git diff` 同口径（末行无终止符 ⇒ 输出标记；末尾有无换行本身是内容差异）。
//
// 本文件同时是**字节保真族**的四形态验收矩阵：
//   ① LF + 有末尾换行 ② LF + 无末尾换行 ③ CRLF ④ UTF-8 BOM
// 每形态都断言：行尾属性不变 / BOM 位置不变 / 末尾换行不变 / diff 可 apply。








const BOM = "\uFEFF";

/** 有顶层调用点 ⇒ 固化会真的写回（有 callsite 见证） */
const LF_SRC = `export function add(a, b) {
  return a + b;
}
const x = add(1, 2);
`;

const FORMS: Array<{ label: string; source: string; bom: boolean; crlf: boolean; eof: boolean }> = [
  { label: "LF + 有末尾换行", source: LF_SRC, bom: false, crlf: false, eof: true },
  { label: "LF + 无末尾换行", source: LF_SRC.replace(/\n$/, ""), bom: false, crlf: false, eof: false },
  { label: "CRLF", source: LF_SRC.replace(/\n/g, "\r\n"), bom: false, crlf: true, eof: true },
  { label: "UTF-8 BOM", source: BOM + LF_SRC, bom: true, crlf: false, eof: true },
];

/** 裸 LF（不含 CRLF）计数 */
function bareLfCount(text: string): number {
  return text.split("\n").length - 1 - (text.split("\r\n").length - 1);
}

/** git 是否可用（不可用时跳过 apply 断言） */
function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 把 unifiedDiff 的产物丢给 `git apply --check -p1`（在临时目录里对着真实
 * 文件）⇒ 补丁可被 git 接受。
 */
function gitApplyAccepts(oldSource: string, newSource: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "nudo-diff-"));
  writeFileSync(join(dir, "lib.js"), oldSource, "utf-8");
  const patch = unifiedDiff(oldSource, newSource, "lib.js");
  try {
    execFileSync("git", ["apply", "--check", "-p1"], { cwd: dir, input: patch, stdio: ["pipe", "ignore", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

describe("Bug 564 — 末行无终止符的 diff 可被 git apply 接受", () => {
  it("末行没有换行时输出 `\\ No newline at end of file` 标记（native diff 同口径）", () => {
    const a = "const x = add(1, 2);\nexport function add(a, b) {\n  return a + b;\n}";
    const b = "const x = add(1, 2);\n/**\n * @nudo:case \"call@L1\" (1, 2)\n */\nexport function add(a, b) {\n  return a + b;\n}";
    const d = unifiedDiff(a, b, "t.txt");

    expect(d).toContain("\\ No newline at end of file");
    // hunk 头与 native `diff -u` 同口径（-1,4 +1,7）
    expect(d).toContain("@@ -1,4 +1,7 @@");
    // 标记紧跟在末行之后
    const lines = d.split("\n");
    expect(lines[lines.length - 3]).toBe(" }");
    expect(lines[lines.length - 2]).toBe("\\ No newline at end of file");
  });

  it("末行有换行时不输出标记（负控制）", () => {
    const d = unifiedDiff("a\nb\n", "a\nB\n", "t.txt");
    expect(d).not.toContain("No newline at end of file");
  });

  it("末尾换行的有无本身是内容差异（与 native diff 同口径）", () => {
    const d = unifiedDiff("a\nb\n", "a\nb", "t.txt");
    expect(d).toContain("-b");
    expect(d).toContain("+b");
    expect(d).toContain("\\ No newline at end of file");
  });

  it("行数不多算一格：末尾有换行的文件不产生 phantom 末行", () => {
    // "a\nb\n" 的真实行数是 2（不是 3）⇒ 纯插入的 hunk 头是 -1,2 +1,3
    const d = unifiedDiff("a\nb\n", "new\na\nb\n", "t.txt");
    expect(d).toContain("@@ -1,2 +1,3 @@");
  });
});

describe("字节保真四形态矩阵（写回只增不改 + diff 可 apply）", () => {
  for (const form of FORMS) {
    it(`${form.label}：行尾/BOM/末尾换行不变，且 diff 可被 git apply 接受`, () => {
      const analysis = analyzeFile("/test/matrix.js", form.source);
      const out = insertGeneratedCaseDirectives(form.source, analysis);
      expect(out.changed).toBe(true);

      // ① 行尾属性不变
      if (form.crlf) {
        expect(bareLfCount(out.source)).toBe(0);
        expect(out.source.includes("\r\n")).toBe(true);
      } else {
        expect(out.source.includes("\r\n")).toBe(false);
      }
      // ② BOM 位置不变（BOM 只在文件最前、全文一枚）
      expect(out.source.startsWith(BOM)).toBe(form.bom);
      expect(out.source.split(BOM).length - 1).toBe(form.bom ? 1 : 0);
      // ③ 末尾换行不变
      expect(out.source.endsWith("\n")).toBe(form.eof);

      // ④ diff 可被 git apply 接受
      if (hasGit()) {
        expect(gitApplyAccepts(form.source, out.source)).toBe(true);
      }
    });
  }
});
});

// ---------------------------------------------------------------------------
// Bug 523 — emit --fn 不重排既有生成段
// ---------------------------------------------------------------------------
describe("[emit-] Bug 523 — emit --fn 不重排既有生成段", () => {
/**
 * Bug 523 — `nudo contract --emit --fn <name>` 把侧车里的 `@generated` 段
 * **重排**（非目标段排到目标段前面）→ 纯顺序 diff → `--exit-on-diff` 在 CI 上
 * **假红**。
 *
 * 根因：update 模式剥掉全部生成段后按「非目标段在前 + 目标段在后」重排，
 * 丢掉了段与段的**相对次序**。正确做法是**按原位置**把每个段替换/保留。
 *
 * 负控制：内容真的变了时仍然要改写（就地替换，不是「永远不动」）。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-523-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// BUG-035：`@nudo:case` 的**纯点观测见证**（实参全是字面量、无断言）不是契约
// 产物 ⇒ 本夹具的两条 case 改为**带断言的域声明**（`=> 期望值`），契约内容
// （`fn({ x: lit(1) }, lit(2))`）不变，段序语义不变。
const SRC = `/**
 * @nudo:case "a" (1) => 2
 */
export function alpha(x) { return x + 1; }
/**
 * @nudo:case "b" (2) => 4
 */
export function beta(x) { return x * 2; }
`;

/**
 * 侧车：alpha 在前、beta 在后（首次 emit 生成的形态）。
 *
 * BUG-035 证据范围收口：生成段现为**四行**（`@generated` / `source` /
 * `evidence` / export）⇒ 本夹具按**当轮格式**更新（断言文本一条未动：这里钉的
 * 是「段序不重排 / 无改动」，不是段的行数）。
 */
const SIDECAR = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: e.js:alpha
// evidence: local
export const alpha = fn({ x: lit(1) }, lit(2));

// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: e.js:beta
// evidence: local
export const beta = fn({ x: lit(2) }, lit(4));
`;

describe("Bug 523 — emit --fn 不重排既有生成段", () => {
  it("keeps the section order (no reorder diff) when refreshing one target", async () => {
    const file = join(dir, "e.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "e.nudo.js");
    writeFileSync(sidecar, SIDECAR);

    const r = await emitContract(file, { fnNames: ["alpha"], mode: "update" });
    // alpha 段内容未变 → 无改动、无 diff（CI 的 --exit-on-diff 不再假红）
    expect(r.changed).toBe(false);
    expect(r.diff).toBeUndefined();
    expect(readFileSync(sidecar, "utf-8")).toBe(SIDECAR);
    // 段序保持 alpha → beta
    const after = readFileSync(sidecar, "utf-8");
    expect(after.indexOf("alpha")).toBeLessThan(after.indexOf("beta"));
  });

  it("rewrites the target section in place (content change still lands)", async () => {
    const file = join(dir, "e.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "e.nudo.js");
    // alpha 段的旧证据（lit(1)）已过期 → 必须被改写
    writeFileSync(
      sidecar,
      `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: e.js:alpha
export const alpha = fn({ x: lit(99) }, lit(100));

// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: e.js:beta
export const beta = fn({ x: lit(2) }, lit(4));
`,
    );
    const r = await emitContract(file, { fnNames: ["alpha"], mode: "update" });
    expect(r.changed).toBe(true);
    const after = readFileSync(sidecar, "utf-8");
    expect(after).toContain("export const alpha = fn({ x: lit(1) }, lit(2));");
    expect(after).not.toContain("lit(99)");
    // 段序仍是 alpha → beta（就地替换，不是搬到末尾）
    expect(after.indexOf("alpha")).toBeLessThan(after.indexOf("beta"));
  });

  it("is idempotent: a second emit reports no change and does not write", async () => {
    const file = join(dir, "e.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "e.nudo.js");
    writeFileSync(sidecar, SIDECAR);
    const first = await emitContract(file, { fnNames: ["alpha"], mode: "update" });
    // 第一次也不能是「重排」——段序不变 ⇒ 零改动（修前：beta 段被搬到 alpha 前）
    expect(first.changed).toBe(false);
    const second = await emitContract(file, { fnNames: ["alpha"], mode: "update" });
    expect(second.changed).toBe(false);
    expect(readFileSync(sidecar, "utf-8")).toBe(SIDECAR);
  });
});
});

// ---------------------------------------------------------------------------
// BUG-035 残留 —— 证据消失 ⇒ 陈旧生成段被刷新（删除）
// ---------------------------------------------------------------------------
describe("[emit-] BUG-035 残留 —— 证据消失 ⇒ 陈旧生成段被刷新（删除）", () => {
/**
 * BUG-035 残留 —— **证据消失后旧生成段不得留存**（侧车的刷新语义）。
 *
 * 现象（BUG-035 改后仍留的残渣）：改前 `@nudo:case` 的**调试见证**被写成
 * 契约（`fn({ x: lit(5) }, lit(6))`）并落进侧车；BUG-035 改后见证不再产
 * 契约，**但改前落盘的旧段还留在侧车里** ⇒ 侧车继续承诺「f 只接受 x = 5、
 * 只返回 6」，而门禁说「f(x: any) => number | string」——**同一份源码，
 * 侧车与门禁互相矛盾**，且没有任何东西会把它清掉。
 *
 * 修法（`packages/service/src/emit/section-provenance.ts` + `contract-emitter.ts`）：
 * update 模式下今天的分析对该导出**没有证据**时，既有生成段必须被**刷新**
 * （无新证据 ⇒ 删段）。但只有**可证**证据已消失的段才删：
 * - 段钉住**单点字面量**（某个顶层槽是 `lit(...)`）⇒ 今天的发射模型里调用点
 *   观测一律拓宽（BUG-021）⇒ 单点字面量域**只可能**来自文件内证据
 *   （`@nudo:case` 域声明 / 入口推断）⇒ 当前分析对文件内证据的视野完整
 *   ⇒ 「今天没证据」= 「证据没了」⇒ 删段；
 * - 其余段（宽域，可能来自 `--from` 跨文件记录）⇒ **不可证** ⇒ 保留
 *   （「没看到证据」≠「证据没了」⇒ 不得据此删用户契约）。
 *
 * 删段的**双条件**（缺一不可）：今天的投影是 `noEvidence`（真的**什么证据都没有**
 * ——不是「证据在但投影不出」，也不是 `@nudo:skip` 关掉分析）**且**该段的证据
 * 可证在文件内（单点字面量、无 `// derived-from:` 标签）。
 *
 * 钉：① 证据消失 ⇒ 陈旧生成段被删（+ 台账 removed + info 诊断）；
 * ② **手写段逐字存活**（生成/手写的分界 = `@generated` 标记行）；
 * ③ 新鲜发射**逐字节相同**（幂等：删段后再跑不产生二次改动）；
 * ④ 宽域段（跨文件记录来源）在证据缺失时**留存**（不误删 ⇒ 无数据丢失）；
 * ⑤ 证据还在 ⇒ **刷新**（改写）而不是删除；
 * ⑥ `@nudo:skip` 关掉分析 ⇒ 段**保留**（关分析不是「行为没了」）；
 * ⑦ 证据在但投影不出（域形状 case）⇒ 段**保留**（投影失败 ≠ 证据消失）。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-035-stale-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 无任何证据的源文件（没有调用点、没有指令 case） */
const SRC_NO_EVIDENCE = `export function f(x) {
  return x + 1;
}
`;

/** 有调用点证据的源文件（今天的分析能把域投影出来） */
const SRC_WITH_CALL = `export function f(x) {
  return x + 1;
}
f(9);
`;

/**
 * BUG-035 改前落盘的**见证契约段**（点观测见证被当成契约写进侧车）。
 * 单点字面量域 ⇒ 在今天的发射模型里只可能来自文件内证据。
 */
const STALE_WITNESS_SECTION = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:f
export const f = fn({ x: lit(5) }, lit(6));
`;

/** 手写段（用户自己写的契约）——发射器永不覆盖 */
const HANDWRITTEN = `// 手写段：API 表面想强制的契约
export const g = fn({ n: number().gt(0) }, string());
`;

/** 跨文件调用记录来源的段（宽域：调用点观测被拓宽到基类型） */
const WIDE_SECTION = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:f
export const f = fn({ x: number() }, number());
`;

const IMPORT = `import { fn, number, string } from "@nudojs/core";\n`;

/** 写源 + 写侧车 → 返回文件路径 */
function fixture(src: string, sidecar: string): { file: string; sidecarPath: string } {
  const file = join(dir, "lib.js");
  writeFileSync(file, src);
  const sidecarPath = join(dir, "lib.nudo.js");
  writeFileSync(sidecarPath, sidecar);
  return { file, sidecarPath };
}

describe("BUG-035 残留 —— 证据消失 ⇒ 陈旧生成段被刷新（删除）", () => {
  it("见证契约段在证据消失后被删（+ 台账 removed + info 诊断）", async () => {
    const { file, sidecarPath } = fixture(SRC_NO_EVIDENCE, STALE_WITNESS_SECTION);
    const r = await emitContract(file, { mode: "update" });
    // 段被删 ⇒ 侧车不再承诺「只接受 x = 5」
    expect(readFileSync(sidecarPath, "utf-8")).toBe("");
    expect(r.changed).toBe(true);
    expect(r.removed).toEqual(["f"]);
    // 台账：既没有「写」也没有「跳过」——是「删」
    expect(r.written).toEqual([]);
    expect(r.skipped).toContainEqual({ fn: "f", reason: "not-projectable" });
    expect(
      r.issues.some((i) => i.severity === "info" && i.message.includes("evidence disappeared")),
    ).toBe(true);
  });

  it("手写段逐字存活（生成/手写的分界 = @generated 标记行）", async () => {
    const { file, sidecarPath } = fixture(
      SRC_NO_EVIDENCE,
      `${IMPORT}\n${HANDWRITTEN}\n${STALE_WITNESS_SECTION}`,
    );
    const before = readFileSync(sidecarPath, "utf-8");
    const r = await emitContract(file, { mode: "update" });
    const after = readFileSync(sidecarPath, "utf-8");
    // 手写段逐字不动（import + 手写契约都留着）
    expect(after).toBe(`${IMPORT}\n${HANDWRITTEN}\n`);
    expect(after).toContain("export const g = fn({ n: number().gt(0) }, string());");
    expect(after).not.toContain("@generated");
    expect(r.removed).toEqual(["f"]);
    expect(before).toContain("export const g");
  });

  it("删段后再跑：逐字节相同（幂等，不产生二次改动）", async () => {
    const { file, sidecarPath } = fixture(SRC_NO_EVIDENCE, STALE_WITNESS_SECTION);
    const first = await emitContract(file, { mode: "update" });
    expect(first.changed).toBe(true);
    const afterFirst = readFileSync(sidecarPath, "utf-8");
    const second = await emitContract(file, { mode: "update" });
    expect(second.changed).toBe(false);
    expect(second.removed).toBeUndefined();
    expect(readFileSync(sidecarPath, "utf-8")).toBe(afterFirst);
  });

  it("新鲜发射（有证据）逐字节相同：同状态两次发射结果一致", async () => {
    const { file, sidecarPath } = fixture(SRC_WITH_CALL, "");
    const first = await emitContract(file, { fnNames: ["f"], mode: "add" });
    expect(first.written).toEqual(["f"]);
    const bytes = readFileSync(sidecarPath, "utf-8");
    const second = await emitContract(file, { fnNames: ["f"], mode: "update" });
    expect(second.changed).toBe(false);
    expect(readFileSync(sidecarPath, "utf-8")).toBe(bytes);
  });

  it("宽域段（跨文件记录来源）留存：证据缺失 ≠ 证据没了（不误删用户契约）", async () => {
    const { file, sidecarPath } = fixture(SRC_NO_EVIDENCE, WIDE_SECTION);
    const before = readFileSync(sidecarPath, "utf-8");
    const r = await emitContract(file, { mode: "update" });
    expect(r.changed).toBe(false);
    expect(r.removed).toBeUndefined();
    expect(readFileSync(sidecarPath, "utf-8")).toBe(before);
    expect(r.skipped).toContainEqual({ fn: "f", reason: "not-projectable" });
  });

  it("证据还在 ⇒ 刷新（改写）而不是删除", async () => {
    const { file, sidecarPath } = fixture(SRC_WITH_CALL, STALE_WITNESS_SECTION);
    const r = await emitContract(file, { mode: "update" });
    expect(r.removed).toBeUndefined();
    expect(r.written).toEqual(["f"]);
    const after = readFileSync(sidecarPath, "utf-8");
    // BUG-021：调用点点观测拓宽到基类型 ⇒ 段被改写成宽域
    expect(after).toContain("export const f = fn({ x: number() }, number());");
    expect(after).not.toContain("lit(5)");
  });

  it("@nudo:skip（用户显式关掉分析）⇒ 段保留：关分析不是「行为没了」", async () => {
    // @nudo:skip 的面是「不分析」，不是「没有证据」——删段会丢失用户契约
    const { file, sidecarPath } = fixture(
      `/**\n * @nudo:skip\n */\nexport function f(x) {\n  return x + 1;\n}\n`,
      STALE_WITNESS_SECTION,
    );
    const before = readFileSync(sidecarPath, "utf-8");
    const r = await emitContract(file, { mode: "update" });
    expect(r.removed).toBeUndefined();
    expect(r.changed).toBe(false);
    expect(readFileSync(sidecarPath, "utf-8")).toBe(before);
  });

  it("证据在但投影不出 ⇒ 段保留：投影失败 ≠ 证据消失", async () => {
    // 域形状 case（约束构建器实参）是**域来源**但投影不出（not-projectable）
    // ——证据还在，只是不可表达 ⇒ 既有段必须保留
    const { file, sidecarPath } = fixture(
      `/**\n * @nudo:case "dom" (number())\n */\nexport function f(x) {\n  return x + 1;\n}\n`,
      STALE_WITNESS_SECTION,
    );
    const before = readFileSync(sidecarPath, "utf-8");
    const r = await emitContract(file, { mode: "update" });
    expect(r.removed).toBeUndefined();
    expect(r.changed).toBe(false);
    expect(readFileSync(sidecarPath, "utf-8")).toBe(before);
    expect(r.skipped).toContainEqual({ fn: "f", reason: "not-projectable" });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 411: 行注释清洗器口径（模块私有）
// ---------------------------------------------------------------------------
describe("[emit-] Bug 411: 行注释清洗器口径（模块私有）", () => {
/**
 * Bug 411 —— 行注释（`//`）上下文被**块注释**的转义口径污染
 *
 * 根因：core 的 `sanitizeCommentText`（`core/src/algebra/codegen-escape.ts`）
 * 只有**一种**行为——无条件把块注释闭合序列（星号 + 斜杠）转义成 `*\/`。那是
 * **块注释 / JSDoc** 口径（必要：否则注释体被提前闭合）。但**行注释**到行尾
 * 结束，闭合序列在 `//` 上下文**没有语法含义** ⇒ 转义纯属污染：
 * `nudo contract --draft` 的契约草案注释被写成 `*\/`，而用户要把这段文字
 * **原样抄进侧车**。
 *
 * 修法：service 侧新增**模块私有**的 `emit/line-comment.ts`
 * （`sanitizeLineCommentText`）——行注释里**原样保留**闭合序列，但**换行 /
 * 控制字符仍必须中和**（否则 `//` 注释里的换行会把后续文本注入代码）。
 * 块注释侧（JSDoc，`emit/dts-generator.ts`）**保持 core 口径不变**。
 */










/** 对象 Abs（键可为任意字符串——含闭合序列） */
function objAbs(slots: Record<string, Abs>): Abs {
  const built: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(slots)) built[k] = { value: v };
  return abs({ k: "obj", slots: built as never }, undefined, undefined, "exact");
}

/** 数字收窄（带不可投影 pred，用于制造 dropped 注记） */
function numWithUnprojectable(): Abs {
  return abs(
    { k: "prim", type: "number" },
    { op: "var", id: "x" },
    { op: "gt", a: { op: "var", id: "x" }, b: { op: "var", id: "y" } },
    "exact",
  );
}

function fnAnalysis(cases: CaseResult[]): FunctionAnalysis {
  return {
    name: "f",
    loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
    paramNames: ["x"],
    cases,
  };
}

describe("Bug 411: 行注释清洗器口径（模块私有）", () => {
  it("行注释里原样保留块注释闭合序列（不转义）", () => {
    expect(sanitizeLineCommentText("/* no evidence — tighten */")).toBe(
      "/* no evidence — tighten */",
    );
    expect(sanitizeLineCommentText("a */ b")).toBe("a */ b");
  });

  it("换行 / 控制字符仍必须中和成空格（`//` 注释被顶出代码的防线）", () => {
    expect(sanitizeLineCommentText("a\nb")).toBe("a b");
    expect(sanitizeLineCommentText("a\r\nb")).toBe("a  b");
    expect(sanitizeLineCommentText("a\u2028b")).toBe("a b");
    expect(sanitizeLineCommentText("a\u2029b")).toBe("a b");
    expect(sanitizeLineCommentText("a\u0007b")).toBe("a b");
  });

  it("块注释侧口径不变（core 的 sanitizeCommentText 仍转义闭合序列）", () => {
    expect(sanitizeCommentText("a */ b")).toBe("a *\\/ b");
  });
});

describe("Bug 411: 契约草案的行注释不得被转义污染", () => {
  const draft = formatDraftModule(
    "/tmp/demo/lib.js",
    [
      {
        fn: "add",
        identity: "add",
        paramEvidence: "none",
        returnEvidence: "symbolic",
        params: [
          { name: "a", display: "/* no evidence — tighten */", projected: false },
          { name: "b", display: "/* no evidence — tighten */", projected: false },
        ],
        returns: {
          display:
            "/* symbolic: number | string — add: (a: A1, b: A2) => number | string = (A1 + A2) */",
          projected: false,
        },
        dsl: "fn({})",
      },
    ],
    "/tmp/demo/lib.nudo.js",
  );

  it("行注释里的闭合序列原样保留（旧实现写成 `*\\/`）", () => {
    expect(draft).toContain("//   a: /* no evidence — tighten */");
    expect(draft).toContain("//   b: /* no evidence — tighten */");
    expect(draft).toContain(
      "//   returns: /* symbolic: number | string — add: (a: A1, b: A2) => number | string = (A1 + A2) */",
    );
    expect(draft).not.toContain("*\\/");
  });
});

describe("Bug 411: dropped 注记的行注释不得被转义污染", () => {
  it("zod: `//   ` 注记行保留闭合序列", () => {
    const a = objAbs({ "a*/b": numWithUnprojectable() });
    const { source, dropped } = absToZodSchemaModule({ out: a });
    expect(dropped.length).toBeGreaterThan(0);
    const noteLines = source.split("\n").filter((l) => l.startsWith("//   "));
    expect(noteLines.length).toBeGreaterThan(0);
    expect(noteLines.join("\n")).toContain("a*/b: pred not projected");
    expect(noteLines.join("\n")).not.toContain("*\\/");
  });

  it("standard-schema: `//   ` 注记行保留闭合序列", () => {
    const a = objAbs({ "a*/b": numWithUnprojectable() });
    const { source, dropped } = absToStandardSchemaModule({ out: a });
    expect(dropped.length).toBeGreaterThan(0);
    const noteLines = source.split("\n").filter((l) => l.includes("pred not projected"));
    expect(noteLines.length).toBeGreaterThan(0);
    expect(noteLines.join("\n")).toContain("a*/b: pred not projected");
    expect(noteLines.join("\n")).not.toContain("*\\/");
  });
});

describe("Bug 411 反向闸: 块注释（JSDoc）侧仍必须转义闭合序列", () => {
  it("dts JSDoc 注释体里的闭合序列仍被转义（未被本片改动波及）", () => {
    const c: CaseResult = {
      name: "x*/ process.exit(1); /*",
      argAbs: [numLit(1)],
      abs: numLit(1),
      throwsAbs: abs({ k: "never" }, undefined, undefined, "exact"),
    };
    const lines = generateFunctionDtsLines(fnAnalysis([c]));
    const jsdoc = lines[0]!;
    expect(jsdoc).toContain("*\\/");
    const withoutClose = jsdoc.slice(0, jsdoc.lastIndexOf("*/"));
    expect(withoutClose).not.toContain("*/");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 540 — 侧车写盘的字节保真（行尾 / BOM / 末尾换行）
// ---------------------------------------------------------------------------
describe("[emit-] Bug 540 — 侧车写盘的字节保真（行尾 / BOM / 末尾换行）", () => {
/**
 * Bug 540 — 侧车发射把 **CRLF** 侧车写成**混合行尾**（`file(1)` 报
 * “with CRLF, LF line terminators”）→ 手写段保持 CRLF、新追加的 `@generated`
 * 段是**裸 LF**。
 *
 * 根因：基底用 `src.slice` 原样保留（CRLF 不变），生成段由
 * `normalizeSection` / `joinSections` 用**硬编码的 "\n"** 拼出来（永远 LF），
 * 最后 `writeFileSync` 不做行尾归一 ⇒ 追加即引入混排。
 *
 * 本文件钉住写盘端的**字节保真**（三种源文件都要过）：
 * ① CRLF 侧车 → 发射后仍是纯 CRLF；② UTF-8 BOM 侧车 → BOM 保留（且零改动
 * 不判「有改动」）；③ 末尾无换行的侧车 → 发射后仍可装载且幂等。
 * 负控制：LF 侧车的行为不变。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-540-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// BUG-035：`@nudo:case` 的**纯点观测见证**（实参全是字面量、无断言）不是契约
// 产物 ⇒ 夹具的 case 改为**带断言的域声明**（`=> 期望值`），契约内容
// （`fn({ x: lit(1) }, lit(2))`）与字节保真语义不变。
const SRC = `/**
 * @nudo:case "c" (1) => 2
 */
export function h(x) { return x + 1; }
`;

const HANDWRITTEN_LF = `import { fn, number } from "@nudojs/core";\n\nexport const other = fn({ x: number() }, number());\n`;
const HANDWRITTEN_CRLF = HANDWRITTEN_LF.replace(/\n/g, "\r\n");

const countEols = (s: string): { crlf: number; lf: number } => ({
  crlf: (s.match(/\r\n/g) ?? []).length,
  lf: (s.match(/(?<!\r)\n/g) ?? []).length,
});

describe("Bug 540 — 侧车写盘的字节保真（行尾 / BOM / 末尾换行）", () => {
  it("keeps a CRLF sidecar pure CRLF (no mixed line terminators)", async () => {
    const file = join(dir, "h.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "h.nudo.js");
    writeFileSync(sidecar, HANDWRITTEN_CRLF);

    const r = await emitContract(file, { fnNames: ["h"], mode: "update" });
    expect(r.written).toEqual(["h"]);
    const after = readFileSync(sidecar, "utf-8");
    const eols = countEols(after);
    // 生成段也必须是 CRLF（裸 LF 会让 file(1) 报 "CRLF, LF"）
    expect(eols.lf).toBe(0);
    expect(eols.crlf).toBeGreaterThan(0);
    expect(after).toContain("export const h = fn({ x: lit(1) }, lit(2));");
  });

  it("keeps a UTF-8 BOM sidecar's BOM and reports no change on a no-op emit", async () => {
    const file = join(dir, "h.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "h.nudo.js");
    const bom = "\uFEFF";
    writeFileSync(sidecar, bom + HANDWRITTEN_LF);

    // 零契约变化的 emit 不得判「有改动」（BOM 被吃掉 ⇒ 假 diff）
    const noop = await emitContract(file, { fnNames: ["other"], mode: "update" });
    expect(noop.changed).toBe(false);
    expect(readFileSync(sidecar, "utf-8").startsWith(bom)).toBe(true);

    const r = await emitContract(file, { fnNames: ["h"], mode: "update" });
    expect(r.changed).toBe(true);
    const after = readFileSync(sidecar, "utf-8");
    expect(after.startsWith(bom)).toBe(true);
    expect(countEols(after).lf).toBeGreaterThan(0);
  });

  it("handles a sidecar without a trailing newline (idempotent, still loadable)", async () => {
    const file = join(dir, "h.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "h.nudo.js");
    writeFileSync(sidecar, HANDWRITTEN_LF.replace(/\n$/, ""));

    const first = await emitContract(file, { fnNames: ["h"], mode: "update" });
    expect(first.changed).toBe(true);
    const after = readFileSync(sidecar, "utf-8");
    expect(after).toContain("export const h = fn({ x: lit(1) }, lit(2));");
    // 写两次 ⇒ 第二次必须报「无改动」且不写盘
    const second = await emitContract(file, { fnNames: ["h"], mode: "update" });
    expect(second.changed).toBe(false);
    expect(readFileSync(sidecar, "utf-8")).toBe(after);
  });

  it("negative control: an LF sidecar keeps LF (no CRLF introduced)", async () => {
    const file = join(dir, "h.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "h.nudo.js");
    writeFileSync(sidecar, HANDWRITTEN_LF);
    await emitContract(file, { fnNames: ["h"], mode: "update" });
    const after = readFileSync(sidecar, "utf-8");
    const eols = countEols(after);
    expect(eols.crlf).toBe(0);
    expect(eols.lf).toBeGreaterThan(0);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 562 — 固化写回保住 UTF-8 BOM 的位置
// ---------------------------------------------------------------------------
describe("[emit-] Bug 562 — 固化写回保住 UTF-8 BOM 的位置", () => {
// emit--bom-fidelity.part.ts — Bug 562（+ Bug 938 的 case-emitter 侧）：
//
// 562：`nudo test --freeze` 的**源码写回**摧毁 UTF-8 BOM ⇒ BOM 从文件首字节
//      被挪到文件中段（`export` 那一行）⇒ 文件不再是「UTF-8 with BOM」，
//      而 BOM 以 U+FEFF 零宽字符的形式夹在源码中间。
// 938（case-emitter 侧）：diff 的**行内容**里出现 BOM ⇒ 「只有 BOM 不同」被
//      渲染成一处内容变更（`--exit-on-diff` 假红 / diff 噪音）。
//
// 不变量：写回只增不改 ⇒ BOM 留在**文件最前**、全文只有一枚、且不进 diff 内容。




const BOM = "\uFEFF";

/** 全文 BOM 计数 */
function bomCount(text: string): number {
  return text.split(BOM).length - 1;
}

/** 有顶层调用点 ⇒ 固化会真的写回（有 callsite 见证） */
const SRC = `export function add(a, b) {
  return a + b;
}
const x = add(1, 2);
`;

describe("Bug 562 — 固化写回保住 UTF-8 BOM 的位置", () => {
  it("BOM 仍在文件最前（不被挪到文件中段），全文只有一枚", () => {
    const src = BOM + SRC;
    const analysis = analyzeFile("/test/bom.js", src);
    const out = insertGeneratedCaseDirectives(src, analysis);

    expect(out.changed).toBe(true);
    expect(out.source.startsWith(BOM)).toBe(true);
    expect(bomCount(out.source)).toBe(1);
    // 首行之后不再出现 BOM（BOM 没跟着首行下移到 `export` 那一行）
    const afterFirstLine = out.source.slice(out.source.indexOf("\n") + 1);
    expect(afterFirstLine.includes(BOM)).toBe(false);
    // 声明行回到「没有 BOM 贴着」的形态（BOM 只在文件最前）
    expect(out.source.split("\n").some((l) => l === "export function add(a, b) {")).toBe(true);
  });

  it("BOM 不被当成缩进抄进新插入的 JSDoc 块（\\s 含 U+FEFF）", () => {
    const src = BOM + SRC;
    const analysis = analyzeFile("/test/bom.js", src);
    const out = insertGeneratedCaseDirectives(src, analysis);

    const block = out.source.split("\n").filter((l) => l.includes("@nudo:case"));
    expect(block.length).toBe(1);
    expect(block[0]!.includes(BOM)).toBe(false);
  });

  it("剥离已生成指令时 BOM 不丢（首行整块被删也不丢）", () => {
    const src = `${BOM}/**
 * @nudo:case "call@L1" (1, 2)
 */
export function add(a, b) {
  return a + b;
}
`;
    const { source: out, removed } = stripGeneratedCaseDirectives(src);
    expect(removed).toEqual(["call@L1"]);
    expect(out.startsWith(BOM)).toBe(true);
    expect(bomCount(out)).toBe(1);
  });

  it("负控制：手写 case（无 call@ 命名）不动，BOM 也不动", () => {
    const src = `${BOM}/**
 * @nudo:case "manual" (1)
 */
export function add(a, b) {
  return a + b;
}
`;
    const { source: out, removed } = stripGeneratedCaseDirectives(src);
    expect(removed).toEqual([]);
    expect(out).toBe(src);
  });
});

describe("Bug 938（case-emitter 侧）— diff 字节保真（BOM 留在行内容里）", () => {
  it("两侧都带 BOM ⇒ 首行是公共行（无内容差异）", () => {
    expect(unifiedDiff(`${BOM}a\nb\n`, `${BOM}a\nb\n`, "t.txt")).toBe("");
    expect(unifiedDiff(`${BOM}a\nb\n`, `${BOM}a\nB\n`, "t.txt")).not.toContain("-a");
  });

  it("只有一侧带 BOM ⇒ 首行如实呈现为内容差异（不谎报「无改动」）", () => {
    // BOM 被发射器吃掉是**真实**的字节改动 ⇒ diff 必须看得见（把 BOM 藏起来
    // 会让「文件被重写」这件事变成空 diff = 谎报无改动）。
    const d = unifiedDiff(`${BOM}a\nb\n`, "a\nb\n", "t.txt");
    expect(d).toContain(`-${BOM}a`);
    expect(d).toContain("+a");
  });

  it("diff 的首行保留 BOM（native git 同形：上下文行含 BOM，补丁才贴得上）", () => {
    const d = unifiedDiff(`${BOM}a\nb\n`, `${BOM}a\nB\n`, "t.txt");
    expect(d).toContain(` ${BOM}a`);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 988 —— 同一被推导函数的派生契约不得随 root 调用点个数漂移
// ---------------------------------------------------------------------------
describe("[emit-] Bug 988 —— 同一被推导函数的派生契约不得随 root 调用点个数漂移", () => {
/**
 * 族 15 / 分片 S14 —— Bug 988 回归钉。
 *
 * Bug 988：同一被推导函数的**派生契约随 root 调用点个数漂移**（组合式精确 vs
 * 展开式 **1 ULP 外推**）⇒ 派生产物**不可复现**，且两种形态的**接受集合在边界
 * 值上相反**（`x = 1`：组合式 `x > 1` 违约，展开式 `x > 0.9999999999999999`
 * 通过）。
 *
 * 夹具：`add2(x) => x + 2`（实现逐字相同），root 分别写
 *   one：`add2(x + 1) + 1`（1 个调用点）
 *   two：`add2(x + 1) + add2(x + 1)`（2 个调用点）
 * ⇒ 改前：one = 组合式 `fn({ x }, x.shift(2))`；two = 展开式
 *   `fn({ x: number().gt(0.9999999999999999) }, number().gt(2.9999999999999996))`
 * ⇒ 改后：两者**完全一致**（组合式、精确、接受集合相同）。
 *
 * 负控制：两个调用点**实参不同**（各链不一致）⇒ 退回展开式 / 不可投影，
 * 不得产出非法侧车（同名不同值的 const）。
 */








let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-s14-988-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const STD = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

const ADD_JS = `export function add2(x) { return x + 2; }\n`;

/** root 调用 add2 的方式不同 ⇒ 派生契约必须一致 */
function writeAddFixture(rootBody: string, sub = "add"): string {
  const d = join(dir, sub);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "std.nudo.js"), STD);
  writeFileSync(join(d, "add.js"), ADD_JS);
  writeFileSync(
    join(d, "lib.js"),
    `import { add2 } from "./add.js";
export function add4(x) { return ${rootBody}; }
`,
  );
  writeFileSync(
    join(d, "lib.nudo.js"),
    `import { fn } from "@nudojs/core";
import { positive } from "./std.nudo.js";
export const add4 = fn({ x: positive }, positive);
`,
  );
  return d;
}

/** 侧车落盘 + 读回契约文本（`export const add2 = …` 那一行） */
function emitAndContractLine(sub: string): string {
  const d = join(dir, sub);
  const e = emitDerivedFromRoot(join(d, "lib.js"), { mode: "update", fnNames: ["add2"] });
  expect(e.sidecars.length).toBe(1);
  const sc = readFileSync(join(d, "add.nudo.js"), "utf-8");
  const line = sc.split("\n").find((l) => l.startsWith("export const add2"));
  return line ?? "";
}

/** 侧车里 add2 的**生效**契约（参数域 / 返回域）——按实际求值结果读，不看文本 */
function effectiveContract(sub: string): { param: string; ret: string } {
  const d = join(dir, sub);
  const sc = readFileSync(join(d, "add.nudo.js"), "utf-8");
  const exports = execNudoModule(sc, { loadModule: defaultLoadModule, fromFile: join(d, "add.nudo.js") });
  const v = exports["add2"] as { fn?: { params?: Record<string, NudoConstraint>; returns?: NudoConstraint } };
  const fn = v.fn!;
  return {
    param: formatConstraint(fn.params!["x"]!),
    ret: formatConstraint(fn.returns!),
  };
}

describe("Bug 988 —— 同一被推导函数的派生契约不得随 root 调用点个数漂移", () => {
  it("调用点 1 次 vs 2 次：派生行（参数位 + 返回位）完全一致", () => {
    writeAddFixture("add2(x + 1) + 1", "one");
    writeAddFixture("add2(x + 1) + add2(x + 1)", "two");

    const one = deriveFromRoot(join(dir, "one", "lib.js"), { fnNames: ["add2"] }).derived[0]!;
    const two = deriveFromRoot(join(dir, "two", "lib.js"), { fnNames: ["add2"] }).derived[0]!;

    expect(one.compositional).toBe(true);
    expect(two.compositional).toBe(true);
    // 参数位
    expect(two.params.map((p) => p.dsl)).toEqual(one.params.map((p) => p.dsl));
    expect(two.params.map((p) => p.prelude)).toEqual(one.params.map((p) => p.prelude));
    // 返回位
    expect(two.returns!.dsl).toBe(one.returns!.dsl);
    expect(formatConstraint(two.returns!.constraint)).toBe(formatConstraint(one.returns!.constraint));
  });

  it("落盘侧车的契约行一致（组合式精确，不是 1 ULP 展开式）", () => {
    writeAddFixture("add2(x + 1) + 1", "one");
    writeAddFixture("add2(x + 1) + add2(x + 1)", "two");

    const lineOne = emitAndContractLine("one");
    const lineTwo = emitAndContractLine("two");
    expect(lineOne).toBe("export const add2 = fn({ x }, x.shift(2));");
    expect(lineTwo).toBe(lineOne);
    // 展开式回退的 1 ULP 字面量不得出现
    expect(lineTwo).not.toContain("0.9999999999999999");
    expect(lineTwo).not.toContain("2.9999999999999996");
  });

  it("两种形态的**接受集合相同**（生效契约：x > 1，返回 > 3）", () => {
    writeAddFixture("add2(x + 1) + 1", "one");
    writeAddFixture("add2(x + 1) + add2(x + 1)", "two");
    emitAndContractLine("one");
    emitAndContractLine("two");

    const one = effectiveContract("one");
    const two = effectiveContract("two");
    // 精确边界（不是 nextDown 保守端点）
    expect(one.param).toBe("number().gt(1)");
    expect(one.ret).toBe("number().gt(3)");
    expect(two).toEqual(one);
  });

  it("负控制：两个调用点实参不同 ⇒ 不可投影（不得产出非法侧车）", () => {
    const d = writeAddFixture("add2(x + 1) + add2(x + 5)", "diff");
    const r = deriveFromRoot(join(d, "lib.js"), { fnNames: ["add2"] });
    const row = r.derived[0]!;
    // 各调用点链不一致 ⇒ 组合式不可用（同名不同值的 const ⇒ 侧车非法 ESM）
    expect(row.compositional).toBe(false);
    const e = emitDerivedFromRoot(join(d, "lib.js"), { mode: "update", fnNames: ["add2"] });
    expect(e.sidecars[0]!.written).toBe(false);
    // 盘上不得出现重复的 const 声明
    let sidecar = "";
    try {
      sidecar = readFileSync(join(d, "add.nudo.js"), "utf-8");
    } catch {
      sidecar = "";
    }
    const consts = sidecar.split("\n").filter((l) => l.startsWith("const "));
    expect(new Set(consts).size).toBe(consts.length);
  });

  it("负控制：单调用点的既有组合式形态不变", () => {
    const d = writeAddFixture("add2(x + 1) + 1", "single");
    const r = deriveFromRoot(join(d, "lib.js"), { fnNames: ["add2"] });
    const row = r.derived[0]!;
    expect(row.compositional).toBe(true);
    expect(row.params[0]!.prelude).toEqual(["const x = positive.shift(1);"]);
    expect(row.returns!.dsl).toBe("x.shift(2)");
  });
});
});
