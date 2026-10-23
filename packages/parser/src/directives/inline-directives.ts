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

const REPLACE_LINE_REGEX = /^@nudo:replace[ \t]+(.+)$/;
const REPLACE_BARE_RE = /^@nudo:replace[ \t]*$/;
/**
 * `@nudo:replace` 标签名被延长（`@nudo:replaceFoo`）——**粘连**形态。
 *
 * Bug 1032：粘连形态既不匹配严格正则、也不匹配宽松正则 ⇒ 整条行内指令对扫描器
 * **完全不可见** ⇒ **零诊断**地蒸发。没有第二条 `@nudo:replace*` 指令 ⇒ 一律
 * 是**畸形**的 `@nudo:replace`（可显式诊断）。
 */
const REPLACE_GLUED_RE = /^@nudo:replace[A-Za-z0-9_$]/;

/**
 * `@nudo:as` 标签（行内指令）。标签后**分隔空白可有可无**：
 * - `@nudo:as string()`    空白分隔（历史形态）
 * - `@nudo:as(string())`   括号紧贴（无分隔空白；Bug 842）
 * - `@nudo:as`             无载荷（发显式诊断，不再静默）
 *
 * 标签后紧跟**标识符字符** ⇒ 标签名被延长（`@nudo:assume` / `@nudo:ascii`）
 * ⇒ 不是 `@nudo:as` 指令（此前靠「标签后必须有空白」侥幸避开 `@nudo:assume`
 * 误命中——放开空白后必须显式守这条边界）。
 */
const AS_TAG = "@nudo:as";

/**
 * `@nudo:as` 载荷切分：载荷文本（空串 ⇒ 无载荷）；不是 `@nudo:as` 指令 ⇒ null。
 *
 * ⚠ Bug 1032（parser 面）**未改**这里：标签名被延长（`@nudo:asXYZ`）⇒ 不是
 * `@nudo:as` 指令、且**零诊断**——这是族 28（Bug 842）**已合入并钉死**的行为
 * （`packages/parser/src/__tests__/parser-bug-842-as-payload-separator.test.ts`
 * 的「tag boundary」用例断言 `@nudo:asXYZ` / `@nudo:ascii` 零诊断）⇒ 本片
 * 不推翻它（**越界发现**，见交付报告）。`@nudo:replace` 侧无此约束，已修。
 */
function asPayloadOf(line: string): string | null {
  if (!line.startsWith(AS_TAG)) return null;
  const rest = line.slice(AS_TAG.length);
  const next = rest[0];
  if (next !== undefined && /[A-Za-z0-9_$]/.test(next)) return null; // 标签名被延长
  return rest.trim();
}

/**
 * `@nudo:as` 载荷的**外层括号**剥离：`(string())` ≡ `string()`。
 * 约束文法的预筛正则锚定构建器名（core 的 CONSTRAINT_EXPR_RE：
 * `^(number|string|…)`）——括号包裹的等价写法会被判「不认识」⇒ 类型覆盖
 * 静默不生效（假绿，Bug 842）。只剥**配平**的外层括号（首 `(` 与末 `)` 配对）。
 */
function unwrapOuterParens(s: string): string {
  let cur = s.trim();
  while (cur.length >= 2 && cur.startsWith("(") && cur.endsWith(")") && outerParensWrapAll(cur)) {
    cur = cur.slice(1, -1).trim();
  }
  return cur;
}

/** 首个 `(` 是否与末个 `)` 配对（字符串感知——`lit("(")` 不算） */
function outerParensWrapAll(s: string): boolean {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      depth--;
      if (depth === 0) return i === s.length - 1;
    }
  }
  return false;
}

/**
 * S4-006 同族：尾注释探测改字符串感知——`lit("a /* b")` 里的 `//` / `/*`
 * 不再误判为尾注释（与 scanWithStrings 同口径：`\` 不是转义）。
 *
 * Bug 843：此前**要求注释前有空白**——`string()// why` 的注释被并进表达式
 * ⇒ 合法类型被判「unsafe」并降级为 unknown。现在按**词法边界**判定：
 * 表达式结束处的 `//` / `/*` 即尾注释（标识符 / `)` 结尾也算），只排除
 * 「整除」形态（左操作数是数值字面量且 `//` 后紧跟数字）。
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
    if (ch === "/" && (expr[i + 1] === "/" || expr[i + 1] === "*")) {
      if (!looksLikeDivision(expr, i)) return i;
      continue;
    }
    if ((ch === " " || ch === "\t") && /^[ \t]+(?:\/\/|\/\*)/.test(expr.slice(i))) {
      return i;
    }
  }
  return -1;
}

/**
 * `//` 是**整除**而非尾注释：左侧（跳过空白）是数值字面量的尾字符、且 `//`
 * 之后紧跟数字。`1//2` ⇒ 整除（不当注释切走）；`1// why` ⇒ 注释。
 */
function looksLikeDivision(expr: string, slashIdx: number): boolean {
  let left = slashIdx - 1;
  while (left >= 0 && (expr[left] === " " || expr[left] === "\t")) left--;
  const ch = left >= 0 ? expr[left]! : "";
  if (ch !== "." && !/^[0-9]$/.test(ch)) return false;
  return /^[0-9.]/.test(expr.slice(slashIdx + 2));
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
    const rawLines = comment.value.split("\n");
    for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
      const rawLine = rawLines[lineIdx]!;
      const line = stripInlineCommentPrefix(rawLine, kind);
      // Bug 848：诊断身份含**位置**——同文件两处逐字相同的畸形指令不得塌缩成
      // 一条。位置取该指令行在源码中的行/列（列 best-effort：注释前缀
      // `//` / `/*` / ` * ` 之后的指令文本起点）。
      const at = commentSite(comment, rawLine, lineIdx, line);

      const asPayload = asPayloadOf(line);
      if (asPayload !== null) {
        if (asPayload === "") {
          // 空载荷不再静默：`@nudo:as` 单独成行发显式诊断
          emitDirectiveDiag({
            code: DIAG.directiveSyntax,
            message: `@nudo:as requires a type expression (e.g. @nudo:as number())`,
            at,
          });
          continue;
        }
        // 尾注释残留（F-3 #9 / Bug 843）：类型表达式后跟 `//` 或 `/*` → 不静默吞成 unknown
        const trailingIdx = findTrailingCommentStart(asPayload);
        if (trailingIdx !== -1) {
          const typePart = asPayload.slice(0, trailingIdx).trim();
          emitDirectiveDiag({
            code: DIAG.directiveSyntax,
            message: `Trailing comment in @nudo:as type expression: '${asPayload}' (remove the comment; the type must be a clean expression)`,
            at,
          });
          results.push({
            kind: "as",
            typeAbs: typePart ? parseAbsExprDiag(unwrapOuterParens(typePart), "@nudo:as") : absUnknown(),
          });
          continue;
        }
        results.push({ kind: "as", typeAbs: parseAbsExprDiag(unwrapOuterParens(asPayload), "@nudo:as") });
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
            at,
          });
        }
        continue;
      }
      if (REPLACE_BARE_RE.test(line)) {
        emitDirectiveDiag({
          code: DIAG.directiveSyntax,
          message: `@nudo:replace requires a target and type expression (expected @nudo:replace <target> <typeExpr>)`,
          at,
        });
        continue;
      }
      if (REPLACE_GLUED_RE.test(line)) {
        // Bug 1032：粘连形态（`@nudo:replaceFoo`）此前**零诊断**地蒸发 ⇒ 显式诊断
        emitDirectiveDiag({
          code: DIAG.directiveSyntax,
          message: `Malformed @nudo:replace directive '${line.slice(0, 60)}' (expected a space after the tag: @nudo:replace <target> <typeExpr>)`,
          at,
        });
        continue;
      }
    }
  }
  return results;
}

/**
 * 指令行在源码中的**位置**（行 1-based / 列 0-based）——Bug 848 的诊断身份位。
 *
 * 注释的 `loc` 给出注释起点的行列；注释值的第 i 行对应源码的第 `start.line + i`
 * 行（列基准：首行 = 注释起点列 + 2（`//` / `/*`），续行 = 0）。列偏移取指令
 * 文本在**原始行**里的起点（跳过 `* ` / `///` 等注释前缀）。
 * 无 `loc`（纯查询 / 非 Babel 注释）⇒ undefined ⇒ 退回旧身份（无位置）。
 */
function commentSite(
  comment: Comment,
  rawLine: string,
  lineIdx: number,
  stripped: string,
): { line: number; column: number } | undefined {
  const locStart = comment.loc?.start;
  if (!locStart) return undefined;
  const base = lineIdx === 0 ? locStart.column + 2 : 0;
  const inLine = stripped.length > 0 ? rawLine.indexOf(stripped) : 0;
  return {
    line: locStart.line + lineIdx,
    column: base + (inLine < 0 ? 0 : inLine),
  };
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
