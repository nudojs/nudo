/**
 * BUG-014 回归：parseCaseArgExpr 结构字面量递归无深度上限。
 * `@nudo:case` 实参含超深嵌套（`[`×5000）曾以 RangeError 打穿 extractDirectives
 * ——文法边界必须走 nudo:directive-syntax 诊断，不能把宿主栈深当隐式限制。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import {
  extractDirectives,
  parseCaseArgExpr,
  type DirectiveDiag,
} from "../directives.ts";
import type { CaseDirective } from "../directives.ts";

function extractWithDiags(source: string) {
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(parse(source), { diags });
  return { fns, diags };
}

function nestedArrays(depth: number, leaf = "1"): string {
  return "[".repeat(depth) + leaf + "]".repeat(depth);
}

function nestedObjects(depth: number, leaf = "1"): string {
  return "{a:".repeat(depth) + leaf + "}".repeat(depth);
}

describe("BUG-014: deep structural literals hit the depth cap, not the host stack", () => {
  it("parseCaseArgExpr: hostile deep array literals (5000 / 20000) do not throw, emit diagnostic", () => {
    for (const depth of [5000, 20000]) {
      const deep = nestedArrays(depth);
      // 公开入口直调：不得打穿宿主栈（诊断面走 case 实参通道）
      expect(() => parseCaseArgExpr(deep), `depth=${depth}`).not.toThrow();
      const { diags } = extractWithDiags(`/**
 * @nudo:case "deep" (${deep})
 */
function f(x) { return x; }`);
      expect(
        diags.some(
          (d) => d.code === "nudo:directive-syntax" && d.message.includes("nesting"),
        ),
        `depth=${depth}`,
      ).toBe(true);
      // 诊断报文截断预览：不得把 10 万字符实参灌进诊断
      expect(diags[0]!.message.length, `depth=${depth}`).toBeLessThan(200);
    }
  });

  it("parseCaseArgExpr: 5000-deep object literal does not throw, emits diagnostic", () => {
    const deep = nestedObjects(5000);
    expect(() => parseCaseArgExpr(deep)).not.toThrow();
    const { diags } = extractWithDiags(`/**
 * @nudo:case "deep" (${deep})
 */
function f(x) { return x; }`);
    expect(
      diags.some(
        (d) => d.code === "nudo:directive-syntax" && d.message.includes("nesting"),
      ),
    ).toBe(true);
  });

  it("parseCaseArgExpr: builder nesting beyond the cap does not throw", () => {
    const deep = "array(".repeat(64) + "number()" + ")".repeat(64);
    expect(() => parseCaseArgExpr(deep)).not.toThrow();
    const { diags } = extractWithDiags(`/**
 * @nudo:case "deep" (${deep})
 */
function f(x) { return x; }`);
    expect(
      diags.some(
        (d) => d.code === "nudo:directive-syntax" && d.message.includes("nesting"),
      ),
    ).toBe(true);
  });

  it("extractDirectives on hostile case arg returns normally with a case", () => {
    const deep = nestedArrays(5000);
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "deep" (${deep})
 */
function f(x) { return x; }`);
    // 进程不崩：extract 正常返回，case 保留（实参折叠 unknown），诊断显式
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"));
    expect(cases).toHaveLength(1);
    expect(
      diags.some(
        (d) => d.code === "nudo:directive-syntax" && d.message.includes("nesting"),
      ),
    ).toBe(true);
  });

  it("30-deep legit array case still parses fully, no diagnostics", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "ok" (${nestedArrays(30)})
 */
function f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(cases).toHaveLength(1);
    // 完整解析：30 层 tuple 嵌套不折叠 unknown
    let shape = cases[0]!.argsAbs[0]!.shape;
    let depth = 0;
    while (shape.k === "tuple") {
      depth++;
      shape = shape.elements[0]!.shape;
    }
    expect(depth).toBe(30);
    expect(shape.k).toBe("prim");
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });

  it("legit mixed structure at real-world depth parses (shape/array/object)", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "tree" ({ items: [ { v: [1, [2, [3]]] } ] })
 */
function f(x) { return x; }`);
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"));
    expect(cases).toHaveLength(1);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });
});

describe("BUG-014 same-class: parseNudoMockExpr sinon prefix strip is iterative", () => {
  it("mock expr with 30000 `sinon.` prefixes does not throw, mock is kept", () => {
    const expr = "sinon.".repeat(30000) + "stub()";
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:mock m = ${expr}
 */
function f(x) { return x; }`);
    const mocks = fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock"));
    expect(mocks).toHaveLength(1);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });

  it("single `sinon.` prefix still strips to the bare helper chain", () => {
    const { fns } = extractWithDiags(`/**
 * @nudo:mock m = sinon.stub().returns(42)
 */
function f(x) { return x; }`);
    const mocks = fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock"));
    expect(mocks).toHaveLength(1);
  });
});
