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
  extractInlineDirectives,
  parseCaseArgExpr,
  takeDirectiveDiags,
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
