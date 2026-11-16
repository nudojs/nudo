/**
 * parseCaseArgExpr 的结构字面量递归必须有文法深度上限：敌意深嵌套走
 * nudo:directive-syntax 诊断，不打穿宿主栈；合法深度完整解析；sinon 前缀
 * 剥离是迭代的。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, parseCaseArgExpr, type DirectiveDiag, type CaseDirective } from "../directives.ts";

function extractWithDiags(source: string) {
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(parse(source), { diags });
  return { fns, diags };
}

const nestedArrays = (depth: number, leaf = "1") => "[".repeat(depth) + leaf + "]".repeat(depth);
const nestedObjects = (depth: number, leaf = "1") => "{a:".repeat(depth) + leaf + "}".repeat(depth);

const HOSTILE = [
  { name: "5000 层数组", expr: nestedArrays(5000) },
  { name: "20000 层数组", expr: nestedArrays(20000) },
  { name: "5000 层对象", expr: nestedObjects(5000) },
  { name: "64 层 builder", expr: "array(".repeat(64) + "number()" + ")".repeat(64) },
];

describe("敌意深嵌套：诊断而非宿主栈", () => {
  it("四种形态都不抛错，保留 case 且只发截断的 nesting 诊断", () => {
    for (const { name, expr } of HOSTILE) {
      expect(() => parseCaseArgExpr(expr), name).not.toThrow();
      const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "deep" (${expr})
 */
function f(x) { return x; }`);
      const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"));
      expect(cases, name).toHaveLength(1);
      expect(
        diags.some((d) => d.code === "nudo:directive-syntax" && d.message.includes("nesting")),
        name,
      ).toBe(true);
      expect(diags[0]!.message.length, name).toBeLessThan(200);
    }
  });
});

describe("合法深度完整解析", () => {
  it("30 层 tuple 保留全部层数；真实混合结构零诊断", () => {
    const deep = extractWithDiags(`/**
 * @nudo:case "ok" (${nestedArrays(30)})
 */
function f(x) { return x; }`);
    const deepCases = deep.fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(deepCases).toHaveLength(1);
    let shape = deepCases[0]!.argsAbs[0]!.shape;
    let depth = 0;
    while (shape.k === "tuple") {
      depth++;
      shape = shape.elements[0]!.shape;
    }
    expect(depth).toBe(30);
    expect(shape.k).toBe("prim");
    expect(deep.diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);

    const mixed = extractWithDiags(`/**
 * @nudo:case "tree" ({ items: [ { v: [1, [2, [3]]] } ] })
 */
function f(x) { return x; }`);
    expect(mixed.fns.flatMap((f) => f.directives.filter((d) => d.kind === "case"))).toHaveLength(1);
    expect(mixed.diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });
});

describe("sinon 前缀剥离是迭代的", () => {
  it("30000 个 sinon. 前缀与单个前缀都保留 mock 且零语法诊断", () => {
    const exprs = ["sinon.".repeat(30000) + "stub()", "sinon.stub().returns(42)"];
    for (const expr of exprs) {
      const { fns, diags } = extractWithDiags(`/**
 * @nudo:mock m = ${expr}
 */
function f(x) { return x; }`);
      expect(fns.flatMap((f) => f.directives.filter((d) => d.kind === "mock"))).toHaveLength(1);
      expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
    }
  });
});
