/**
 * Bug 845 —— `@nudo:mock` 的**载荷为空**（`@nudo:mock fetch =` / `@nudo:mock g from`）
 * ⇒ 指令**静默蒸发**、零诊断 ⇒ mock 丢失 ⇒ 分析退化成 unknown / 假红。
 *
 * 根因：宽松标签正则（`@nudo:mock\b[ \t]*([^\n]*)`）看得到标签，但两条严格文法
 * （inline `= <expr>` / from `from "<path>"`）都不命中 ⇒ 既不建 mock 也不告警。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import {
  extractDirectives,
  type DirectiveDiag,
} from "../directives.ts";

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

const EMPTY_INLINE = `/**
 * @nudo:mock fetch =
 */
export function f(a) {
  return fetch(a);
}
`;

const EMPTY_FROM = `/**
 * @nudo:mock g from
 */
export function f(a) {
  return g(a);
}
`;

describe("Bug 845: an empty @nudo:mock payload must not evaporate silently", () => {
  it("`@nudo:mock fetch =` → nudo:directive-syntax (empty payload)", () => {
    const diags = fnDiags(EMPTY_INLINE);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("empty or invalid payload");
  });

  it("`@nudo:mock g from` → nudo:directive-syntax (missing path)", () => {
    const diags = fnDiags(EMPTY_FROM);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("empty or invalid payload");
  });

  it("no mock directive is produced for the empty payload", () => {
    expect(mockDirectives(EMPTY_INLINE)).toEqual([]);
    expect(mockDirectives(EMPTY_FROM)).toEqual([]);
  });

  it("valid payload forms stay silent", () => {
    const inline = `/**
 * @nudo:mock fetch = (u) => ({ ok: true })
 */
export function f(u) {
  return fetch(u);
}
`;
    const from = `/**
 * @nudo:mock g from "./g.js"
 */
export function f(u) {
  return g(u);
}
`;
    expect(fnDiags(inline)).toEqual([]);
    expect(fnDiags(from)).toEqual([]);
    expect(mockDirectives(inline)).toHaveLength(1);
    expect(mockDirectives(from)).toHaveLength(1);
  });
});
