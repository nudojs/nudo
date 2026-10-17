import type { Comment, Node } from "@babel/types";
import { CONSTRAINT_EXPR_RE } from "@nudojs/core";
import { DIAG } from "@nudojs/core/internal";
import { absUnknown, parseAbsExprDiag } from "./case-arg.ts";
import {
  emitDirectiveDiag,
  runWithDirectiveDiags,
  type ExtractDirectivesOpts,
} from "./diag.ts";
import type { InlineDirective } from "./types.ts";

/**
 * S4-006：行内指令行前缀剥离——镜像 core cleanDirectiveLine（块注释 `* ` 续行 /
 * 行注释 `///` 残留的单个 `/`）。此前 `^\s*@nudo:as` 对 JSDoc 块整体匹配，
 * `*` 前缀挡在标签前导致整条静默丢失。
 */
function stripInlineCommentPrefix(line: string, kind: "line" | "block"): string {
  const s = kind === "block" ? line.replace(/^\s*\*\s?/, "") : line.replace(/^\//, "");
  return s.trim();
}

const AS_LINE_REGEX = /^@nudo:as[ \t]+(.+)$/;
const REPLACE_LINE_REGEX = /^@nudo:replace[ \t]+(.+)$/;
const AS_BARE_RE = /^@nudo:as[ \t]*$/;
const REPLACE_BARE_RE = /^@nudo:replace[ \t]*$/;

/**
 * S4-006 同族：尾注释探测改字符串感知——`lit("a /* b")` 里的 `//` / `/*`
 * 不再误判为尾注释（与 scanWithStrings 同口径：`\` 不是转义）。
 * 返回尾注释起点下标；无 → -1。
 */
function findTrailingCommentStart(expr: string): number {
  let inString: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!;
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if ((ch === " " || ch === "\t") && /^[ \t]+(?:\/\/|\/\*)/.test(expr.slice(i))) {
      return i;
    }
  }
  return -1;
}

/**
 * 行内指令（@nudo:as / @nudo:replace）抽取，源为节点的 leadingComments。
 * 诊断通道与 extractDirectives 同形：传 opts.diags 落调用方数组（单次调用
 * 内同文案去重，语句级调用各自独立去重）；不传则落外层
 * runWithDirectiveDiags 域（无则丢弃，纯查询形态）。
 */
export function extractInlineDirectives(
  node: Node,
  opts?: ExtractDirectivesOpts,
): InlineDirective[] {
  const comments = (node as any).leadingComments as Comment[] | undefined;
  if (!comments) return [];
  // 不传 diags：不自成去重域——落外层 runWithDirectiveDiags 域（无则丢弃）
  if (!opts?.diags) return collectInlineDirectivesFromComments(comments);
  // 显式通道：runWithDirectiveDiags 换入/还原 sink（仅在本次调用内生效，
  // finally 恢复，异常不泄漏——状态本体住 diag.ts 单一模块）
  return runWithDirectiveDiags(opts.diags, () => collectInlineDirectivesFromComments(comments));
}

function collectInlineDirectivesFromComments(comments: readonly Comment[]): InlineDirective[] {
  const results: InlineDirective[] = [];
  for (const comment of comments) {
    // CommentLine（`//`）与 CommentBlock（`/* */`）都认（F-3 #10）
    if (comment.type !== "CommentLine" && comment.type !== "CommentBlock") continue;
    // S4-006：先剥 `* ` / `///` 前缀再逐行扫——多行块注释里的指令此前
    // 只取首个匹配且对 JSDoc 星号续行整体失明；一个块内多条指令各自生效
    const kind = comment.type === "CommentLine" ? "line" : "block";
    for (const rawLine of comment.value.split("\n")) {
      const line = stripInlineCommentPrefix(rawLine, kind);

      const asMatch = line.match(AS_LINE_REGEX);
      if (asMatch) {
        const rawExpr = asMatch[1].trim();
        // 尾注释残留（F-3 #9）：类型表达式后跟 `//` 或 `/*` → 不静默吞成 unknown
        const trailingIdx = findTrailingCommentStart(rawExpr);
        if (trailingIdx !== -1) {
          const typePart = rawExpr.slice(0, trailingIdx).trim();
          emitDirectiveDiag({
            code: DIAG.directiveSyntax,
            message: `Trailing comment in @nudo:as type expression: '${rawExpr}' (remove the comment; the type must be a clean expression)`,
          });
          results.push({ kind: "as", typeAbs: typePart ? parseAbsExprDiag(typePart, "@nudo:as") : absUnknown() });
          continue;
        }
        results.push({ kind: "as", typeAbs: parseAbsExprDiag(rawExpr, "@nudo:as") });
        continue;
      }
      if (AS_BARE_RE.test(line)) {
        // 空载荷不再静默：`@nudo:as` 单独成行发显式诊断
        emitDirectiveDiag({
          code: DIAG.directiveSyntax,
          message: `@nudo:as requires a type expression (e.g. @nudo:as number())`,
        });
        continue;
      }

      const replaceMatch = line.match(REPLACE_LINE_REGEX);
      if (replaceMatch) {
        const raw = replaceMatch[1].trim();
        const sepIdx = findReplaceSeparator(raw);
        if (sepIdx !== -1) {
          const targetSource = raw.slice(0, sepIdx).trim();
          const typeExprStr = raw.slice(sepIdx + 1).trim();
          results.push({
            kind: "replace",
            targetSource,
            typeAbs: parseAbsExprDiag(typeExprStr, "@nudo:replace"),
          });
        } else {
          emitDirectiveDiag({
            code: DIAG.directiveSyntax,
            message: `Malformed @nudo:replace: cannot separate target from type (expected @nudo:replace <target> <typeExpr>) — got: ${raw.slice(0, 60)}`,
          });
        }
        continue;
      }
      if (REPLACE_BARE_RE.test(line)) {
        emitDirectiveDiag({
          code: DIAG.directiveSyntax,
          message: `@nudo:replace requires a target and type expression (expected @nudo:replace <target> <typeExpr>)`,
        });
      }
    }
  }
  return results;
}

function findReplaceSeparator(raw: string): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      // 原样 slice：`\` 不是转义
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
    if (ch === " " && depth === 0) {
      const rest = raw.slice(i + 1).trimStart();
      // type side: constraint builders / concrete literals / structure / never
      if (
        CONSTRAINT_EXPR_RE.test(rest) ||
        rest.startsWith("{") ||
        rest.startsWith("[") ||
        rest.startsWith('"') ||
        rest.startsWith("'") ||
        rest === "true" ||
        rest === "false" ||
        rest === "null" ||
        rest === "undefined" ||
        rest === "unknown" ||
        rest === "any" ||
        rest === "never" ||
        /^-?\d+(\.\d+)?$/.test(rest) ||
        rest.includes("=>") ||
        /^function\s*[\w$]*\s*\(/.test(rest)
      ) {
        return i;
      }
    }
  }
  return -1;
}
