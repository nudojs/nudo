/**
 * Bug 459 回归钉：同一条 `nudo:directive-syntax` 不得被发布两次。
 *
 * 改前：check 通道（checkToLspDiagnostics 显式 extract）与 eval 通道
 * （service drain）各抽一次同一条指令诊断；两通道渲染的**消息不同**
 * （check 通道多一段 " · Fix the directive syntax …" 提示），而两通道合并
 * 的去重键是 `code + message` → 键对不上 → 一次发布 2 条。
 *
 * 修法：提示文案只此一处定义（DIRECTIVE_SYNTAX_HINT），两通道同渲染 →
 * 去重键一致 → 只发布 1 条（与 CLI `nudo check` 同口径）。
 *
 * 负控制：合法文件不得凭空多出 directive-syntax；其它诊断码不受影响。
 */
import { describe, it, expect } from "vitest";
import { validateText, toLspDiagnostic, checkToLspDiagnostics } from "../validation.ts";
import type { LspDiagnostic } from "../validation.ts";
import { makeValidateDeps } from "./helpers.ts";
import { DIAG } from "@nudojs/core/internal";

const BAD_CASE = `/**
 * @nudo:case "a"
 */
export function f(x) {
  return x + 1;
}
`;

const GOOD_CASE = `/**
 * @nudo:case "a" (1)
 */
export function f(x) {
  return x + 1;
}
`;

function countCode(diags: LspDiagnostic[], code: string): number {
  return diags.filter((d) => d.code === code).length;
}

/** LSP 的 message 形如 string | MarkupContent（与仓内既有测试同口径）。 */
function msgText(m: string | { value: string }): string {
  return typeof m === "string" ? m : m.value;
}

describe("Bug 459 — nudo:directive-syntax 只发布一次", () => {
  it("validateText 发布面：同一条指令文法诊断只出现 1 次（改前：2 次）", async () => {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps = makeValidateDeps({ onPublish: (p) => published.push(p) });
    await validateText("/t/bad-case.js", "file:///t/bad-case.js", BAD_CASE, 1, deps, false, true);
    expect(published.length).toBeGreaterThan(0);
    const last = published[published.length - 1]!;
    expect(countCode(last.diagnostics, DIAG.directiveSyntax)).toBe(1);
  });

  it("check 通道与 eval 通道对同一条指令诊断渲染同一消息（去重键一致）", () => {
    // check 通道（显式 extract）
    const checkDiags = checkToLspDiagnostics("/t/bad-case.js", BAD_CASE);
    const checkSyntax = checkDiags.find((d) => d.code === DIAG.directiveSyntax);
    expect(checkSyntax).toBeDefined();
    // eval 通道拿到的是同一条指令诊断的**原始**消息（service 侧不带提示文案）
    const suffix = " · Fix the directive syntax (see docs/reference/diagnostics.md)";
    const checkMessage = msgText(checkSyntax!.message);
    const rawMessage = checkMessage.endsWith(suffix)
      ? checkMessage.slice(0, -suffix.length)
      : checkMessage;
    const evalDiag = toLspDiagnostic(
      {
        severity: "warning",
        code: DIAG.directiveSyntax,
        message: rawMessage,
        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
      },
      "file:///t/bad-case.js",
    );
    // 两通道消息必须逐字相同 → `code + message` 去重键命中 → 只发布 1 条
    expect(evalDiag.message).toBe(checkMessage);
  });

  it("负控制：合法指令文件不得出现 directive-syntax", async () => {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps = makeValidateDeps({ onPublish: (p) => published.push(p) });
    await validateText("/t/good-case.js", "file:///t/good-case.js", GOOD_CASE, 1, deps, false, true);
    const last = published[published.length - 1]!;
    expect(countCode(last.diagnostics, DIAG.directiveSyntax)).toBe(0);
  });

  it("负控制：非指令文法的诊断码不受影响（entry-may-throw 仍在）", async () => {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps = makeValidateDeps({ onPublish: (p) => published.push(p) });
    await validateText("/t/bad-case.js", "file:///t/bad-case.js", BAD_CASE, 1, deps, false, true);
    const last = published[published.length - 1]!;
    expect(countCode(last.diagnostics, DIAG.entryMayThrow)).toBe(1);
  });
});
