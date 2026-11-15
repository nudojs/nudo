/**
 * Bug 905 —— VS Code 扩展的 case 高亮装饰在 **CRLF 源文件**上把 `endChar`
 * 推到**行可见长度之外 1 列**。
 *
 * 根因（`packages/vscode/src/case-decorations.ts` 的 `computeCaseDecorationSpans`）：
 * 行切分用 `source.split("\n")` ⇒ 每行末尾的 `\r` 留在行内容里 ⇒ 行长被多算 1；
 * 而 VS Code / LSP 的 `Position.character` 语义是**行可见长度**（行终止符
 * 不属于该行）⇒ `endChar` 越界 1 列（函数档与 case-comment 档**同时**中招）。
 *
 * 原生 oracle：`vscode.Position(line, character)` 的 `character` = 该行**可见
 * 长度**（行终止符不属于该行）⇒ 装饰区间的 `endChar` 必须 ≤ 该行可见长度，
 * 且覆盖整行时恰等于该长度。
 */
import { describe, it, expect } from "vitest";
import { computeCaseDecorationSpans } from "../case-decorations.ts";

const SRC = `\
/**
 * @nudo:case "test" (42)
 */
function double(x) {
  return x * 2;
}
`;

/** 选中 double 的 "test" case ⇒ 函数档 + case-comment 档各一条。 */
const state = new Map([["double", { caseIndex: 0, caseName: "test" }]]);

/** 夹具的 EOL 变体（LF / CRLF / 老 Mac 的 lone-CR）。 */
const EOLS = [
  { label: "LF", eol: "\n" },
  { label: "CRLF", eol: "\r\n" },
] as const;

/** 行可见长度 = 行终止符不属于该行 ⇒ 切行后该行的字符数。 */
const visibleLines = (src: string): string[] => src.split(/\r\n|\r|\n/);

describe("Bug 905 VS Code 扩展：case 装饰 endChar 必须是行可见长度", () => {
  for (const { label, eol } of EOLS) {
    it(`${label} 源文件上函数档与 case-comment 档的 endChar 都等于该行可见长度`, () => {
      const src = SRC.replace(/\n/g, eol);
      const lines = visibleLines(src);
      const spans = computeCaseDecorationSpans(src, state);
      expect(spans).toHaveLength(2);

      const fn = spans.find((s) => s.kind === "function")!;
      // 函数体末行（`}`）的可见长度 —— CRLF 下旧实现多算了一个 `\r`
      expect(fn.endChar).toBe(lines[fn.endLine]!.length);
      expect(fn.endChar).toBe(1);

      const comment = spans.find((s) => s.kind === "case-comment")!;
      // ` * @nudo:case "test" (42)` 所在行的可见长度
      expect(comment.endChar).toBe(lines[comment.endLine]!.length);
      expect(comment.endChar).toBe(' * @nudo:case "test" (42)'.length);
    });

    it(`${label} 源文件上没有任何 span 的 endChar 越过行可见长度`, () => {
      const src = SRC.replace(/\n/g, eol);
      const lines = visibleLines(src);
      for (const span of computeCaseDecorationSpans(src, state)) {
        expect(span.endChar).toBeLessThanOrEqual(lines[span.endLine]!.length);
      }
    });
  }

  it("CRLF 与 LF 的 span 几何完全一致（只有 EOL 不同）", () => {
    const lf = computeCaseDecorationSpans(SRC, state);
    const crlf = computeCaseDecorationSpans(SRC.replace(/\n/g, "\r\n"), state);
    expect(crlf).toEqual(lf);
  });

  it("行号不受行尾影响（切行口径与 Babel 的 loc 行号仍对齐）", () => {
    const lf = computeCaseDecorationSpans(SRC, state);
    const crlf = computeCaseDecorationSpans(SRC.replace(/\n/g, "\r\n"), state);
    expect(crlf.map((s) => [s.startLine, s.endLine])).toEqual(
      lf.map((s) => [s.startLine, s.endLine]),
    );
  });
});
