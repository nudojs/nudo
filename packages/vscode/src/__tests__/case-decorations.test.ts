import { describe, it, expect } from "vitest";
import { computeCaseDecorationSpans } from "../case-decorations.ts";

const SRC = `\
/**
 * @nudo:case "a" (1)
 * @nudo:case "b" (2)
 */
export function pick(x) {
  return x;
}

/**
 * @nudo:case "c" (3)
 */
export const other = (y) => {
  return y;
};
`;

/** 0-based 行号速查（SRC）：a→1, b→2, pick→4..6, c→9, other→11..13 */
const state = (entries: Record<string, string>) =>
  new Map(
    Object.entries(entries).map(([fn, caseName]) => [fn, { caseIndex: 0, caseName }]),
  );

describe("computeCaseDecorationSpans（case 装饰数据，解析单源 @nudojs/parser）", () => {
  it("selected case highlights the whole function plus only that case's comment line", () => {
    const spans = computeCaseDecorationSpans(SRC, state({ pick: "b" }));
    expect(spans).toHaveLength(2);

    const fn = spans.find((s) => s.kind === "function")!;
    // export function pick(x) { … } 块：4..6（0-based），整行宽
    expect([fn.startLine, fn.startChar, fn.endLine]).toEqual([4, 0, 6]);
    expect(fn.endChar).toBe("}".length);

    const comment = spans.find((s) => s.kind === "case-comment")!;
    // ` * @nudo:case "b" (2)` 在 0-based 第 2 行，整行宽
    expect([comment.startLine, comment.startChar, comment.endLine]).toEqual([2, 0, 2]);
    expect(comment.endChar).toBe(" * @nudo:case \"b\" (2)".length);
  });

  it("arrow-function binding (`export const f = (y) => {}`) decorates its block", () => {
    const spans = computeCaseDecorationSpans(SRC, state({ other: "c" }));
    expect(spans).toHaveLength(2);
    const fn = spans.find((s) => s.kind === "function")!;
    expect(fn.startLine).toBe(11);
    expect(fn.endLine).toBe(13);
    const comment = spans.find((s) => s.kind === "case-comment")!;
    expect(comment.startLine).toBe(9);
  });

  it("no selection → no decorations", () => {
    expect(computeCaseDecorationSpans(SRC, new Map())).toEqual([]);
  });

  it("selection for a function without cases yields nothing", () => {
    expect(computeCaseDecorationSpans(SRC, state({ missing: "a" }))).toEqual([]);
  });

  it("case names that do not match still light the function block (comment line stays dark)", () => {
    const spans = computeCaseDecorationSpans(SRC, state({ pick: "zzz" }));
    expect(spans).toHaveLength(1);
    expect(spans[0]!.kind).toBe("function");
  });

  it("string content that merely looks like a case tag is not parsed as one", () => {
    // 旧正则实现会把字符串里的 @nudo:case 误当注释行、并给 quoted 挂上幽灵 case；
    // 单源 parser 不认字符串 → quoted 根本没有 case，无从装饰
    const src = `const s = "@nudo:case \\"fake\\" (1)";\nexport function quoted() {\n  return s;\n}\n`;
    expect(computeCaseDecorationSpans(src, state({ quoted: "fake" }))).toEqual([]);
  });

  it("syntax-broken buffer yields no decorations instead of throwing", () => {
    expect(computeCaseDecorationSpans("function broken( {", state({ broken: "x" }))).toEqual(
      [],
    );
  });
});
