/**
 * Bug 980 —— `@nudo:mock<name> = …`（标签与名字之间**无空白**）⇒ **连宽松标签正则
 * 都不匹配** ⇒ 整条 mock **对扫描器完全不可见** ⇒ **零诊断** ⇒ **分析跑在真身上**
 * （`promise<unknown>` 而非 `promise<{ id: 1 }>`）⇒ **假绿**。
 *
 * 根因：三条 mock 正则都以 `\b` 收尾——`@nudo:mock` 后紧跟词字符时词边界不成立，
 * 宽松形态（用于诊断非法名形态）也看不见这条指令。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, type DirectiveDiag } from "../directives.ts";

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

describe("Bug 980: a glued @nudo:mock<name> tag must be visible to the scanner", () => {
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
