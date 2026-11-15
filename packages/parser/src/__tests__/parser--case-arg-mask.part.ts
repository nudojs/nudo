/**
 * Bug 846 —— **畸形**的 `@nudo:case` 不登记**参数区间掩码** ⇒ case 参数里的
 * `@nudo:mock` / `@nudo:skip` **泄漏**成真指令 ⇒ 假红 / d.ts 丢方法。
 *
 * 根因（core `directive-scan.ts` 的 `scanCaseArgSpans`）：只登记**合法** case 形态
 * （双引号名 + 同行实参括号）的区间；畸形形态（单引号名 / 空名 / 缺括号…）的实参
 * 区间没被遮罩 ⇒ 实参里的标签被当成真指令扫描。
 *
 * 掩码落在 core（core-bug-846 同族钉），本钉钉**产品面**（parser 抽取面）：畸形
 * case 的实参里不再产出 mock 指令，且「畸形 case 名」诊断仍在。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, type DirectiveDiag } from "../directives.ts";

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

describe("Bug 846: directives inside a malformed @nudo:case must not leak", () => {
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
