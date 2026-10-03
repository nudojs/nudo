import { parse, extractDirectivesQuiet } from "@nudojs/parser";

/**
 * 选中 case 的高亮纯数据（0-based 行/列；extension 侧薄映射成 vscode.Range）。
 *
 * 解析主体单源 `@nudojs/parser`（与服务端 selectCase / getCasesForFile 同一
 * `@nudo:case` 文法）——不再维护扩展侧第二套正则解析。
 */
export type CaseDecorationSpan = {
  kind: "function" | "case-comment";
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
};

export type CaseSelectionState = Map<string, { caseIndex: number; caseName: string }>;

export function computeCaseDecorationSpans(
  source: string,
  fileState: CaseSelectionState,
): CaseDecorationSpan[] {
  let functions: ReturnType<typeof extractDirectivesQuiet>;
  try {
    functions = extractDirectivesQuiet(parse(source));
  } catch {
    // 语法错误的 buffer：不亮（旧实现同样静默跳过）
    return [];
  }
  const lines = source.split("\n");
  const last = lines.length - 1;
  const clamp = (line: number): number => Math.min(Math.max(line, 0), Math.max(last, 0));
  const spans: CaseDecorationSpan[] = [];
  for (const fn of functions) {
    const state = fileState.get(fn.name);
    if (!state) continue;
    const loc = (fn.node as { loc?: { start?: { line?: number }; end?: { line?: number } } })
      .loc;
    if (!loc?.start?.line || !loc?.end?.line) continue;
    const startLine = clamp(loc.start.line - 1);
    const endLine = clamp(loc.end.line - 1);
    spans.push({
      kind: "function",
      startLine,
      startChar: 0,
      endLine,
      endChar: (lines[endLine] ?? "").length,
    });
    for (const d of fn.directives) {
      if (d.kind !== "case" || d.name !== state.caseName) continue;
      if (d.commentLine === undefined) continue;
      const line = clamp(d.commentLine - 1);
      spans.push({
        kind: "case-comment",
        startLine: line,
        startChar: 0,
        endLine: line,
        endChar: (lines[line] ?? "").length,
      });
    }
  }
  return spans;
}
