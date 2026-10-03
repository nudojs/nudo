/**
 * FIX-D1 回归：F-3-silent-drop-malformed-directives 11 类实例。
 * 非法/边界形态发 nudo:directive-syntax / nudo:contract-syntax 显式诊断，
 * 或合法解析——不再静默丢弃。
 *
 * 同时覆盖 I2：parseCaseArgExpr 静默 fallback 不再无声。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import {
  extractDirectives,
  extractDirectivesQuiet,
  extractInlineDirectives,
  parseCaseArgExpr,
  runWithDirectiveDiags,
  type DirectiveDiag,
} from "../directives.ts";
import type { CaseDirective, MockDirective, SkipDirective, AsDirective, ReplaceDirective } from "../directives.ts";

function extractWithDiags(source: string) {
  const ast = parse(source);
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(ast, { diags });
  return { fns, diags };
}

function extractInlineWithDiags(source: string) {
  const ast = parse(source);
  const stmt = (ast as any).program.body[0];
  const diags: DirectiveDiag[] = [];
  const dirs = extractInlineDirectives(stmt, { diags });
  return { dirs, diags };
}

describe("F-3 #1-3: malformed case names", () => {
  it("#1 single-quoted name → diagnostic, no case", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"));
    expect(cases).toHaveLength(0);
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("single-quoted"))).toBe(true);
  });

  it("#2 empty name → diagnostic, no case", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "" (1)
 */
function f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"));
    expect(cases).toHaveLength(0);
    expect(diags.some((d) => d.code === "nudo:directive-syntax")).toBe(true);
  });

  it("#3 escaped quote in name → diagnostic, no clean case", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "a\\"b" (2)
 */
function f(x) { return x; }`);
    // 无论是否误提取到脏 name，必须有诊断（不得静默）
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some((d) => d.code === "nudo:directive-syntax")).toBe(true);
    // 不得产出名字为 a\ 的脏 case
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    for (const c of cases) {
      expect(c.name).not.toBe("a\\");
    }
  });

  it("valid double-quoted name is accepted silently", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "ok" (1)
 */
function f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"));
    expect(cases).toHaveLength(1);
    expect(diags).toHaveLength(0);
  });
});

describe("F-3 #4: mock names", () => {
  it("Unicode identifiers (变量/café) are legal parses", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:mock 变量 = 1
 * @nudo:mock café = 2
 */
function f(x) { return x; }`);
    const mocks = fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock")) as MockDirective[];
    expect(mocks.map((m) => m.name).sort()).toEqual(["café", "变量"]);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });

  it("non-identifier name (foo-bar) → diagnostic, no mock", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:mock foo-bar = 1
 */
function f(x) { return x; }`);
    const mocks = fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock"));
    expect(mocks).toHaveLength(0);
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("not a valid identifier"))).toBe(true);
  });

  it("ASCII identifier remains valid", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:mock _ok = 3
 */
function f(x) { return x; }`);
    const mocks = fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock"));
    expect(mocks).toHaveLength(1);
    expect(diags).toHaveLength(0);
  });
});

describe("F-3 #5: skip prose does not pollute returns", () => {
  it("@nudo:skip prose → returns undefined, not unknown", () => {
    const { fns } = extractWithDiags(`/**
 * @nudo:skip this function is flaky
 */
function f(x) { return x; }`);
    const skips = fns.flatMap((f) => f.directives.filter((d) => d.kind === "skip")) as SkipDirective[];
    expect(skips).toHaveLength(1);
    expect(skips[0]!.returns).toBeUndefined();
  });

  it("@nudo:skip bare number() is prose (not explicit type form)", () => {
    const { fns } = extractWithDiags(`/**
 * @nudo:skip number()
 */
function f(x) { return x; }`);
    const skips = fns.flatMap((f) => f.directives.filter((d) => d.kind === "skip")) as SkipDirective[];
    expect(skips[0]!.returns).toBeUndefined();
  });

  it("@nudo:skip => number() is explicit type", () => {
    const { fns } = extractWithDiags(`/**
 * @nudo:skip => number()
 */
function f(x) { return x; }`);
    const skips = fns.flatMap((f) => f.directives.filter((d) => d.kind === "skip")) as SkipDirective[];
    expect(skips[0]!.returns?.shape.k).toBe("prim");
  });

  it("@nudo:skip (number()) is explicit type", () => {
    const { fns } = extractWithDiags(`/**
 * @nudo:skip (number())
 */
function f(x) { return x; }`);
    const skips = fns.flatMap((f) => f.directives.filter((d) => d.kind === "skip")) as SkipDirective[];
    expect(skips[0]!.returns?.shape.k).toBe("prim");
  });

  it("@nudo:skip without args → returns undefined", () => {
    const { fns } = extractWithDiags(`/**
 * @nudo:skip
 */
function f(x) { return x; }`);
    const skips = fns.flatMap((f) => f.directives.filter((d) => d.kind === "skip")) as SkipDirective[];
    expect(skips[0]!.returns).toBeUndefined();
  });

  it("@nudo:skip => unrecognized → diagnostic", () => {
    const { diags } = extractWithDiags(`/**
 * @nudo:skip => T.number
 */
function f(x) { return x; }`);
    expect(diags.some((d) => d.code === "nudo:directive-syntax")).toBe(true);
  });
});

describe("F-3 #9-10: @nudo:as forms", () => {
  it("#9 trailing comment in type → diagnostic", () => {
    // extractInlineDirectives 走 CommentLine；直接测 parseAbsExprDiag 路径
    const { dirs, diags } = extractInlineWithDiags(`// @nudo:as number() // why
const x = 1;`);
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("Trailing comment"))).toBe(true);
    // 仍然产出 as directive（type 取注释前部分）
    expect(dirs.some((d) => d.kind === "as")).toBe(true);
  });

  it("#10 block comment @nudo:as → legal parse", () => {
    const { dirs, diags } = extractInlineWithDiags(`/* @nudo:as number() */
const x = 1;`);
    expect(dirs.some((d) => d.kind === "as")).toBe(true);
    const asDir = dirs.find((d) => d.kind === "as") as AsDirective;
    expect(asDir.typeAbs.shape.k).toBe("prim");
    expect(diags).toHaveLength(0);
  });

  it("clean CommentLine @nudo:as → legal parse, no diag", () => {
    const { dirs, diags } = extractInlineWithDiags(`// @nudo:as number()
const x = 1;`);
    expect(dirs.some((d) => d.kind === "as")).toBe(true);
    expect(diags).toHaveLength(0);
  });
});

describe("I2: parseCaseArgExpr silent fallback becomes visible", () => {
  it("unrecognized expression in case arg → diagnostic", () => {
    const { diags } = extractWithDiags(`/**
 * @nudo:case "t" (T.number)
 */
function f(x) { return x; }`);
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("Unrecognized"))).toBe(true);
  });

  it("explicit unknown/any is NOT a diagnostic", () => {
    const { diags } = extractWithDiags(`/**
 * @nudo:case "t" (unknown)
 */
function f(x) { return x; }`);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });

  it("valid constraint builder is NOT a diagnostic", () => {
    const { diags } = extractWithDiags(`/**
 * @nudo:case "t" (number())
 */
function f(x) { return x; }`);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });

  it("garbage in expected → diagnostic", () => {
    const { diags } = extractWithDiags(`/**
 * @nudo:case "t" (1) => not_a_type
 */
function f(x) { return x; }`);
    expect(diags.some((d) => d.code === "nudo:directive-syntax")).toBe(true);
  });
});

describe("@nudo:sample count grammar (FIX-RESIDUAL #4)", () => {
  it("missing count → explicit diagnostic, no silent ignore", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:sample
 */
function f(x) { return x; }`);
    const sample = fns.flatMap((f) => f.directives).find((d) => d.kind === "sample");
    expect(sample).toBeUndefined();
    expect(
      diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("@nudo:sample")),
    ).toBe(true);
  });

  it("non-numeric token → explicit diagnostic", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:sample abc
 */
function f(x) { return x; }`);
    const sample = fns.flatMap((f) => f.directives).find((d) => d.kind === "sample");
    expect(sample).toBeUndefined();
    expect(
      diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("@nudo:sample")),
    ).toBe(true);
  });

  it("decimal / negative / scientific notation parse without truncation", () => {
    for (const [raw, count] of [
      ["3.5", 3.5],
      ["-2", -2],
      ["1e2", 100],
    ] as const) {
      const { fns, diags } = extractWithDiags(`/**
 * @nudo:sample ${raw}
 */
function f(x) { return x; }`);
      const sample = fns.flatMap((f) => f.directives).find((d) => d.kind === "sample");
      expect(sample, raw).toBeDefined();
      if (sample && sample.kind === "sample") {
        expect(sample.count, raw).toBe(count);
      }
      expect(diags.filter((d) => d.code === "nudo:directive-syntax"), raw).toHaveLength(0);
    }
  });
});

describe("diag channel semantics（显式通道：单次调用内去重 / 纯查询丢弃）", () => {
  const BAD = `/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }`;

  it("同源再 extract 重新 emit（重分析不丢报）", () => {
    const first = extractWithDiags(BAD);
    expect(first.diags).toHaveLength(1);
    const second = extractWithDiags(BAD);
    expect(second.diags).toHaveLength(1);
  });

  it("extractDirectivesQuiet 丢弃诊断（纯查询不产诊断）", () => {
    const fns = extractDirectivesQuiet(parse(BAD));
    expect(fns).toEqual([]);
    // 无可观察面可断言残留——不抛、不落任何调用方数组即为契约
  });

  it("不传 diags 的 extract 在 runWithDirectiveDiags 域内落袋", () => {
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => {
      extractDirectives(parse(BAD));
    });
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
  });

  it("runWithDirectiveDiags：域内复解析共域去重（nudo check D1 口径）", () => {
    // 同一 unsafe 表达式在域内复解析两次（extract + mock 种子复解析形态）只报一次
    const unsafe = "number(), (globalThis.__dedup = 1, 2)";
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => {
      parseCaseArgExpr(unsafe);
      parseCaseArgExpr(unsafe);
    });
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("Unsafe");
    // 新域重新报（重分析不丢报）
    const again: DirectiveDiag[] = [];
    runWithDirectiveDiags(again, () => {
      parseCaseArgExpr(unsafe);
    });
    expect(again).toHaveLength(1);
  });

  it("语句级行内抽取各自独立去重（两条 bare as 各报一次）", () => {
    const ast = parse(`// @nudo:as
const a = 1;
// @nudo:as
const b = 2;`);
    const diags: DirectiveDiag[] = [];
    for (const stmt of (ast as any).program.body) {
      extractInlineDirectives(stmt, { diags });
    }
    expect(diags.filter((d) => d.message.includes("@nudo:as requires"))).toHaveLength(2);
  });
});

describe("BUG-015 S4-003: unclosed argument list no longer silently dropped", () => {
  it(`/* @nudo:case "a" (1 */ → zero cases + unclosed diagnostic`, () => {
    const { fns, diags } = extractWithDiags(`/* @nudo:case "a" (1 */
function f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"));
    expect(cases).toHaveLength(0);
    expect(
      diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("unclosed argument list")),
    ).toBe(true);
  });

  it(`inner closed / outer unclosed ("a" ((1)) variant) → diagnostic`, () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "a" ((1)
 */
function f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"));
    expect(cases).toHaveLength(0);
    expect(
      diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("unclosed argument list")),
    ).toBe(true);
  });

  it("multi-line unclosed argument list → diagnostic", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "a" (
 *   1
 */
function f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"));
    expect(cases).toHaveLength(0);
    expect(
      diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("unclosed argument list")),
    ).toBe(true);
  });

  it("balanced same-line case stays silent (regression guard)", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "ok" (1)
 */
function f(x) { return x; }`);
    expect(fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"))).toHaveLength(1);
    expect(diags).toHaveLength(0);
  });

  it("@nudo:skip (number() unclosed parenthesis → diagnostic, returns undefined", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:skip (number()
 */
function f(x) { return x; }`);
    const skips = fns.flatMap((f) => f.directives.filter((d) => d.kind === "skip")) as SkipDirective[];
    expect(skips[0]!.returns).toBeUndefined();
    expect(
      diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("unclosed parenthesis")),
    ).toBe(true);
  });

  it("@nudo:skip (number()) balanced still parses without diagnostic", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:skip (number())
 */
function f(x) { return x; }`);
    const skips = fns.flatMap((f) => f.directives.filter((d) => d.kind === "skip")) as SkipDirective[];
    expect(skips[0]!.returns?.shape.k).toBe("prim");
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });
});

describe("BUG-015 S4-004: tag/payload separation stays on one line", () => {
  it("empty @nudo:case tag does not glue the next line into a case", () => {
    const { fns, diags } = extractWithDiags(`/*
@nudo:case
"evil" (1)
*/
function f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(cases.map((c) => c.name)).not.toContain("evil");
    expect(cases).toHaveLength(0);
    // 空标签可见：一条 missing-quoted-name 诊断，且不含下一行内容
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("missing quoted name"))).toBe(true);
    expect(diags.some((d) => d.message.includes("evil"))).toBe(false);
  });

  it("empty tag + real tag on next line → real case + attributed diagnostic", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case
 * @nudo:case "real" (1)
 */
function f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(cases.map((c) => c.name)).toEqual(["real"]);
    expect(diags).toHaveLength(1);
    // 诊断文案不得把下一行的真标签吞进 got
    expect(diags[0]!.message.includes("real")).toBe(false);
  });

  it("prose line after empty tag is not reported as the tag payload", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case
 * see docs for "x" (1)
 */
function f(x) { return x; }`);
    expect(fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"))).toHaveLength(0);
    expect(diags.some((d) => d.code === "nudo:directive-syntax")).toBe(true);
    expect(diags.some((d) => d.message.includes("see docs"))).toBe(false);
  });

  it("multi-line case arguments still parse (paren closed on later line)", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "a" (
 *   1,
 *   2
 * )
 */
function f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(cases.map((c) => c.name)).toEqual(["a"]);
    expect(diags).toHaveLength(0);
  });

  it("empty @nudo:mock tag does not glue the next line", () => {
    const { fns, diags } = extractWithDiags(`/*
@nudo:mock
foo = 1
*/
function f(x) { return x; }`);
    const mocks = fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock")) as MockDirective[];
    expect(mocks.map((m) => m.name)).not.toContain("foo");
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("@nudo:mock"))).toBe(true);
    expect(diags.some((d) => d.message.includes("foo"))).toBe(false);
  });

  it("@nudo:mock from with unclosed path quote → diagnostic, no mock", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:mock x from "src
 */
function f(x) { return x; }`);
    const mocks = fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock")) as MockDirective[];
    expect(mocks).toHaveLength(0);
    expect(
      diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("unclosed quote in path")),
    ).toBe(true);
  });

  it("@nudo:mock from with unclosed single-quoted path → diagnostic, no mock", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:mock x from 'src
 */
function f(x) { return x; }`);
    const mocks = fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock")) as MockDirective[];
    expect(mocks).toHaveLength(0);
    expect(
      diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("unclosed quote in path")),
    ).toBe(true);
  });

  it("/// line-comment directive form is recognized (aligned with core prefix)", () => {
    const { fns, diags } = extractWithDiags(`/// @nudo:case "d" (1)
/// @nudo:mock m = 2
function f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    const mocks = fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock")) as MockDirective[];
    expect(cases.map((c) => c.name)).toEqual(["d"]);
    expect(mocks.map((m) => m.name)).toEqual(["m"]);
    expect(diags).toHaveLength(0);
  });
});

describe("BUG-015 S4-006: inline directives accept JSDoc `* ` continuation lines", () => {
  it("/**\\n * @nudo:as number()\\n */ → one as, prim type, no diagnostics", () => {
    const { dirs, diags } = extractInlineWithDiags(`/**
 * @nudo:as number()
 */
const a = 1;`);
    expect(dirs).toHaveLength(1);
    const asDir = dirs.find((d) => d.kind === "as") as AsDirective;
    expect(asDir.typeAbs.shape.k).toBe("prim");
    expect(diags).toHaveLength(0);
  });

  it("/**\\n * @nudo:replace a number()\\n */ → one replace targeting a", () => {
    const { dirs, diags } = extractInlineWithDiags(`/**
 * @nudo:replace a number()
 */
const a = 1;`);
    expect(dirs).toHaveLength(1);
    const rep = dirs.find((d) => d.kind === "replace") as ReplaceDirective;
    expect(rep.targetSource).toBe("a");
    expect(rep.typeAbs.shape.k).toBe("prim");
    expect(diags).toHaveLength(0);
  });

  it("multiple inline directives in one block are each extracted", () => {
    const { dirs, diags } = extractInlineWithDiags(`/**
 * @nudo:replace a number()
 * @nudo:replace b string()
 */
const a = (b) => b;`);
    const reps = dirs.filter((d) => d.kind === "replace") as ReplaceDirective[];
    expect(reps.map((r) => r.targetSource).sort()).toEqual(["a", "b"]);
    expect(diags).toHaveLength(0);
  });

  it("/// line-comment form is recognized", () => {
    const { dirs, diags } = extractInlineWithDiags(`/// @nudo:as number()
const a = 1;`);
    expect(dirs.filter((d) => d.kind === "as")).toHaveLength(1);
    expect(diags).toHaveLength(0);
  });

  it("bare @nudo:as / @nudo:replace lines → explicit diagnostics, no directive", () => {
    const { dirs, diags } = extractInlineWithDiags(`/**
 * @nudo:as
 * @nudo:replace
 */
const a = 1;`);
    expect(dirs).toHaveLength(0);
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("@nudo:as requires"))).toBe(true);
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("@nudo:replace requires"))).toBe(true);
  });

  it("string contents are not mistaken for trailing comments", () => {
    for (const expr of [`lit("http://x")`, `lit("see // docs")`, `shape({ note: lit("a /* b") })`]) {
      const { dirs, diags } = extractInlineWithDiags(`// @nudo:as ${expr}
const a = 1;`);
      expect(dirs.filter((d) => d.kind === "as"), expr).toHaveLength(1);
      expect(diags.some((d) => d.message.includes("Trailing comment")), expr).toBe(false);
    }
  });

  it("real trailing comment after the expression still diagnosed", () => {
    const { dirs, diags } = extractInlineWithDiags(`/**
 * @nudo:as number() // why
 */
const x = 1;`);
    expect(dirs.filter((d) => d.kind === "as")).toHaveLength(1);
    expect(diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("Trailing comment"))).toBe(true);
  });
});

describe("explicit diag channel（extractDirectives opts.diags：调用方自备数组）", () => {
  const BAD = `/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }`;

  it("diags 落调用方数组", () => {
    const sink: DirectiveDiag[] = [];
    const fns = extractDirectives(parse(BAD), { diags: sink });
    expect(fns).toEqual([]); // 非法 case 名 → 无指令产出（诊断已发）
    expect(sink.length).toBeGreaterThan(0);
    expect(sink[0]!.code).toBe("nudo:directive-syntax");
  });

  it("单次调用内同文案去重", () => {
    const sink: DirectiveDiag[] = [];
    // 两个函数各带一条同文案非法 case 名 → 只报一次
    extractDirectives(
      parse(`/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }
/**
 * @nudo:case 't' (1)
 */
function g(x) { return x; }`),
      { diags: sink },
    );
    expect(sink.length).toBe(1);
  });

  it("sink extract 覆盖外层 runWithDirectiveDiags 域（自成新去重域）", () => {
    const outer: DirectiveDiag[] = [];
    const inner: DirectiveDiag[] = [];
    runWithDirectiveDiags(outer, () => {
      extractDirectives(parse(BAD), { diags: inner });
    });
    expect(inner).toHaveLength(1);
    expect(outer).toHaveLength(0);
  });

  it("不传 diags 且无外层域 → 诊断丢弃（纯查询形态）", () => {
    const fns = extractDirectives(parse(BAD));
    expect(fns).toEqual([]); // 非法 case 名 → 无指令产出（诊断已丢弃）
  });
});
