/**
 * Bug 978 —— `@nudo:case"c1" (1, 2)`（标签与名字之间**无空白**）⇒ 抽取侧（严格
 * `[ \t]+`）**不匹配** + 诊断侧（宽松 `[ \t]*`）**判合法** ⇒ 整条 case **静默
 * 蒸发** ⇒ `nudo test` 一个 case 都不跑、**零诊断**（假绿）。
 *
 * 改后：诊断面按**抽取侧的真实文法**判定 ⇒ 粘连写法命中
 * `nudo:directive-syntax`（口径与族 28 的 Bug 980 `@nudo:mock` 粘连写法一致）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, type DirectiveDiag } from "../directives.ts";

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

describe("Bug 978: a glued @nudo:case\"name\" tag must be visible to the scanner", () => {
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
