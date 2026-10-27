/**
 * BUG-080 残留（LSP IDE 编辑器面）：`@nudo:as` 挂在**不支持的承载语句**上
 * （表达式语句 / 函数声明 …）⇒ service 面发一条显式 `nudo:directive-syntax`
 * （warning；见 packages/service/src/eval-injection.ts 的 `asOverrideApplies`
 * 分支——适用形态只有 VariableDeclaration / ReturnStatement /
 * ExportNamedDeclaration-with-declaration）。
 *
 * 该诊断在 service 面发出后，LSP 编辑器面**确实**发布（`validation.ts` 的
 * `getCachedCheckDiags` / `collectCheckSupplementIssues` → `checkIssueToLspDiagnostic`，
 * warning 级、`source: "nudo-check"`）；只有 `buildLspInjection()`（hover / 补全的
 * 注入表装配，不是诊断面）采集内联指令时不带 diags 汇。本文件的作用是**钉住**
 * 「IDE 面看得见」，而不是修一个不可见的缺口——BUG-080 的 changeset 曾把它写成
 * 「新诊断在 IDE 面不可见」，本回归用于证伪那句话说法的持续有效性。
 *
 * 本文件钉住 IDE 面（编辑器诊断）**确实**看得见这条诊断：
 * - check 通道（`checkToLspDiagnostics` → `collectCheckSupplementIssues` →
 *   `collectEvalReplacements(source, { diags })`）⇒ 码 / 档 / 来源都对；
 * - push 通道（`validateText` → `sendDiagnostics`）⇒ 诊断随发布上屏；
 * - 负控制：适用形态（变量声明 / return）⇒ 零 `nudo:directive-syntax`。
 *
 * service 面的同一条事实已由
 * packages/service/src/__tests__/service-bug-080-as-shape-guard.test.ts 钉住；
 * 本文件只补 IDE 面。
 */
import { describe, it, expect } from "vitest";
import {
  checkToLspDiagnostics,
  clearValidationState,
  validateText,
  type LspDiagnostic,
} from "../validation.ts";
import { makeValidateDeps } from "./helpers.ts";
import { DIAG } from "@nudojs/core/internal";
import { DiagnosticSeverity } from "vscode-languageserver/node";

/** 非法载体 ①：表达式语句（`@nudo:as` 只作用于变量声明的 init / return 的值）。 */
const INVALID_EXPR_STMT = `export function f(x) {
  // @nudo:as number()
  x;
  return 1;
}
`;

/** 非法载体 ②：函数声明（export 包装的声明体不是变量声明）。 */
const INVALID_FN_DECL = `// @nudo:as number()
export function f() { return 1; }
`;

/** 合法载体 ①：变量声明（覆盖生效 ⇒ 零诊断）。 */
const VALID_VAR_DECL = `export function f(x) {
  // @nudo:as number()
  const y = x;
  return y;
}
`;

/** 合法载体 ②：return 语句（覆盖生效 ⇒ 零诊断）。 */
const VALID_RETURN = `export function f(x) {
  // @nudo:as number()
  return x;
}
`;

/** LSP 3.18 Diagnostic.message 为 string | MarkupContent；本产品始终写纯字符串。 */
function msgText(m: string | { value: string }): string {
  return typeof m === "string" ? m : m.value;
}

function syntaxDiags(diags: LspDiagnostic[]): LspDiagnostic[] {
  return diags.filter((d) => d.code === DIAG.directiveSyntax);
}

/** 跑一次 push 通道（validateText），返回本次发布的诊断集。 */
async function publishDiagnostics(
  filePath: string,
  source: string,
): Promise<LspDiagnostic[]> {
  const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
  const deps = makeValidateDeps({ onPublish: (p) => published.push(p) });
  await validateText(filePath, `file://${filePath}`, source, 1, deps, false, true);
  expect(published.length).toBeGreaterThan(0);
  return published[published.length - 1]!.diagnostics;
}

describe("BUG-080 残留 — @nudo:as 载体不支持的诊断在 IDE 编辑器面可见", () => {
  it("check 通道：表达式语句载体 ⇒ 一条 nudo:directive-syntax（warning，非硬错）", () => {
    const diags = checkToLspDiagnostics("/t/as-expr.js", INVALID_EXPR_STMT);
    const syntax = syntaxDiags(diags);
    expect(syntax).toHaveLength(1);
    expect(syntax[0]!.severity).toBe(DiagnosticSeverity.Warning);
    expect(syntax[0]!.source).toBe("nudo-check");
    // 文案点名「这条指令没生效」（service 侧原文 + check 通道的修复提示）
    const message = msgText(syntax[0]!.message);
    expect(message).toContain("@nudo:as");
    expect(message).toContain("the directive has no effect");
    // range 必须落在文档内（LSP Position 是 uinteger）
    expect(syntax[0]!.range.start.line).toBeGreaterThanOrEqual(0);
    expect(syntax[0]!.range.end.character).toBeGreaterThanOrEqual(
      syntax[0]!.range.start.character,
    );
  });

  it("check 通道：函数声明载体同样可见（同码同档）", () => {
    const diags = checkToLspDiagnostics("/t/as-fn.js", INVALID_FN_DECL);
    const syntax = syntaxDiags(diags);
    expect(syntax).toHaveLength(1);
    expect(syntax[0]!.severity).toBe(DiagnosticSeverity.Warning);
    expect(syntax[0]!.source).toBe("nudo-check");
    expect(msgText(syntax[0]!.message)).toContain("@nudo:as");
  });

  it("IDE push 面：该诊断随 publishDiagnostics 上屏（不只在 service/CLI 面）", async () => {
    clearValidationState();
    const published = await publishDiagnostics("/t/as-push.js", INVALID_EXPR_STMT);
    const syntax = syntaxDiags(published);
    expect(syntax).toHaveLength(1);
    expect(syntax[0]!.severity).toBe(DiagnosticSeverity.Warning);
    expect(syntax[0]!.source).toBe("nudo-check");
  });

  it("负控制：合法载体（变量声明 / return）⇒ 零 nudo:directive-syntax", () => {
    expect(syntaxDiags(checkToLspDiagnostics("/t/as-var.js", VALID_VAR_DECL))).toHaveLength(0);
    expect(syntaxDiags(checkToLspDiagnostics("/t/as-ret.js", VALID_RETURN))).toHaveLength(0);
  });

  it("负控制：合法载体在 push 面同样零 nudo:directive-syntax", async () => {
    clearValidationState();
    const published = await publishDiagnostics("/t/as-var-push.js", VALID_VAR_DECL);
    expect(syntaxDiags(published)).toHaveLength(0);
  });
});
