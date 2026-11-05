/**
 * Bug 918 —— `=> expected` 在「`=>` 后为空」时被**静默丢弃** ⇒ 该 case 判
 * `[unchecked]` ⇒ 断言**不执法**、`nudo test` **exit 0**、**屏幕上零诊断**
 * （完全静默的假绿）。
 *
 * 改后：期望**写了却抽不出** ⇒ 发 `nudo:directive-syntax`（不再静默吞错）；
 * 期望值在**下一行**时照旧被抽出（核心抽取层负责）。
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

describe("Bug 918: `=>` with a missing expected expression must not be silent", () => {
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
