/**
 * FIX-D1 回归：F-3-silent-drop-malformed-directives 11 类实例。
 * 非法/边界形态发 nudo:directive-syntax / nudo:contract-syntax 显式诊断，
 * 或合法解析——不再静默丢弃。
 *
 * 同时覆盖 I2：parseCaseArgExpr 静默 fallback 不再无声。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { parse } from "../parse.ts";
import {
  extractDirectives,
  extractDirectivesQuiet,
  extractInlineDirectives,
  parseCaseArgExpr,
  takeDirectiveDiags,
  takeDirectiveDiagsSince,
  directiveDiagCount,
  setDirectiveDiagCollector,
} from "../directives.ts";
import type { CaseDirective, MockDirective, SkipDirective, AsDirective } from "../directives.ts";

function extractWithDiags(source: string) {
  takeDirectiveDiags(); // 清空
  const ast = parse(source);
  const fns = extractDirectives(ast);
  const diags = takeDirectiveDiags();
  return { fns, diags };
}

function extractInlineWithDiags(source: string) {
  takeDirectiveDiags();
  const ast = parse(source);
  const stmt = (ast as any).program.body[0];
  const dirs = extractInlineDirectives(stmt);
  const diags = takeDirectiveDiags();
  return { dirs, diags };
}

beforeEach(() => {
  setDirectiveDiagCollector(null);
  takeDirectiveDiags();
});

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
    takeDirectiveDiags();
    // extractInlineDirectives 走 CommentLine；用 parse 的 leadingComments
    const src = `
function f() {
  return 1;
}
// @nudo:as number() // why
`;
    // 直接测 parseAbsExprDiag 路径：用 extractInlineDirectives 带 CommentLine
    const ast = parse(`// @nudo:as number() // why
const x = 1;`);
    const stmt = (ast as any).program.body[0];
    const dirs = extractInlineDirectives(stmt);
    const diags = takeDirectiveDiags();
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

describe("collector API", () => {
  it("setDirectiveDiagCollector receives diags", () => {
    const seen: Array<{ code: string; message: string }> = [];
    setDirectiveDiagCollector((d) => seen.push(d));
    extractWithDiags(`/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }`);
    setDirectiveDiagCollector(null);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]!.code).toBe("nudo:directive-syntax");
  });

  it("takeDirectiveDiags drains the buffer", () => {
    extractWithDiags(`/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }`);
    // extractWithDiags 已 take 过
    expect(takeDirectiveDiags()).toHaveLength(0);
  });
});

describe("takeDirectiveDiagsSince watermark（R2B-003：对齐 takeInterfaceDiagsSince）", () => {
  const BAD = `/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }`;

  it("只排本次增量，既有诊断保留", () => {
    takeDirectiveDiags();
    // 第一条诊断（在途验证待消费）
    extractDirectives(parse(BAD));
    const since = directiveDiagCount(); // 锚：既有诊断保留
    // 第二条诊断（工具自身探测）——同源再 extract 会重新 emit
    extractDirectives(parse(BAD));
    expect(takeDirectiveDiagsSince(since).length).toBe(1);
    // 既有诊断仍在队列，全量 take 才取走
    expect(takeDirectiveDiags().length).toBe(1);
  });

  it("不窃取在途其他消费方的诊断（跨文件错报回归）", () => {
    takeDirectiveDiags();
    const badB = `/**
 * @nudo:case 'b' (1)
 */
function g(x) { return x; }`;
    // 文件 B 的 hover 探测 emit 后不 drain（模拟纯查询路径）
    extractDirectives(parse(badB));
    const before = directiveDiagCount();
    // 文件 A 的分析：锚定自身增量后 extract + take
    extractDirectives(parse(BAD));
    const mine = takeDirectiveDiagsSince(before);
    expect(mine.some((d) => d.message.includes("single-quoted"))).toBe(true);
    // B 的诊断不得混入 A 的结果，也不得被偷走
    expect(mine.some((d) => d.message.includes("'b'"))).toBe(false);
    const leftover = takeDirectiveDiags();
    expect(leftover.some((d) => d.message.includes("'b'"))).toBe(true);
  });

  it("extractDirectivesQuiet 排干自身增量并丢弃，不污染 buffer", () => {
    takeDirectiveDiags();
    extractDirectivesQuiet(parse(BAD));
    expect(takeDirectiveDiags()).toHaveLength(0);
  });

  it("take 之后同源再 extract 可重新 emit（重分析不丢报）", () => {
    takeDirectiveDiags();
    extractDirectives(parse(BAD));
    expect(takeDirectiveDiags().length).toBe(1);
    // 全量 take 清 seen → 再 extract 重新 emit
    extractDirectives(parse(BAD));
    expect(takeDirectiveDiags().length).toBe(1);
  });
});
