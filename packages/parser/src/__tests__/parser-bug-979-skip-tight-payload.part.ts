/**
 * Bug 979 —— `@nudo:skip=> <expr>`（标签与载荷之间**无空白**）⇒ **载荷被静默丢弃**、
 * 零诊断 ⇒ 声明的返回类型**没生效** ⇒ 签名从 `f() => number` 退化成 `f() => any`
 * ⇒ **any 泄漏到产物面** + **假绿**。
 *
 * 根因：`SKIP_REGEX` 把「分隔空白」写进必需结构（`\b(?:[ \t]+(\S[^\n]*))?`）——
 * 粘连写法整条载荷匹配不到。
 */
import { describe, it, expect } from "vitest";
import { formatShape } from "@nudojs/core";
import { parse } from "../parse.ts";
import { extractDirectives, type DirectiveDiag } from "../directives.ts";

function fnDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return diags;
}

function skipReturns(src: string): string | undefined {
  const fns = extractDirectives(parse(src), { diags: [] });
  for (const fn of fns) {
    for (const d of fn.directives) {
      if (d.kind === "skip") return d.returns === undefined ? undefined : formatShape(d.returns);
    }
  }
  return undefined;
}

const TIGHT = `/**
 * @nudo:skip=> number()
 */
export function f() {
  return "hello";
}
`;

const SPACED = `/**
 * @nudo:skip => number()
 */
export function f() {
  return "hello";
}
`;

describe("Bug 979: @nudo:skip=> <expr> (no space) must not drop the payload", () => {
  it("tight form yields the declared return type", () => {
    expect(skipReturns(TIGHT)).toBe("number");
  });

  it("tight form equals the spaced form", () => {
    expect(skipReturns(TIGHT)).toBe(skipReturns(SPACED));
  });

  it("no diagnostic is emitted for the tight form", () => {
    expect(fnDiags(TIGHT)).toEqual([]);
  });

  it("bare @nudo:skip still declares nothing", () => {
    const bare = `/**
 * @nudo:skip
 */
export function f() {
  return 1;
}
`;
    expect(skipReturns(bare)).toBeUndefined();
    expect(fnDiags(bare)).toEqual([]);
  });

  it("@nudo:skipped is still not a skip directive", () => {
    const src = `/**
 * @nudo:skipped
 */
export function f() {
  return 1;
}
`;
    expect(skipReturns(src)).toBeUndefined();
    expect(fnDiags(src)).toEqual([]);
  });
});
