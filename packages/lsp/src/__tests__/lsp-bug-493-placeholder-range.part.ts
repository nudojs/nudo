/**
 * Bug 493 回归钉：service 侧的**占位 range**（无源码锚点）换算到 LSP 后
 * 必须是合法位置（`Position.line` 是 uinteger，≥ 0），不得落成 -1。
 *
 * 改前：toLspDiagnostic 无条件 `line - 1`，而 service 对「无锚点」的诊断
 * 发 `range: {start:{line:0,column:0}}`（占位，不是「第 0 行」）→ -1。
 * 受影响：`nudo:module-missing` / `nudo:mock-invalid` 等 error 级诊断。
 *
 * 行号基（自读代码确认，与报告描述不同）：service 的 Diagnostic.range 行号
 * 是 **1 基源码行**（Babel `node.loc`；CLI 报告与 check-json-map 直接印它），
 * `line: 0` 是「无锚点」占位。LSP 侧 1 基 → 0 基仍要减 1，但必须钳位 ≥ 0。
 *
 * 负控制：真实 1 基行号仍按原口径换算（不得整体偏移）。
 */
import { describe, it, expect } from "vitest";
import { validateText, toLspDiagnostic } from "../validation.ts";
import type { LspDiagnostic } from "../validation.ts";
import { makeValidateDeps } from "./helpers.ts";
import { DIAG } from "@nudojs/core/internal";

const MOCK_MISSING = `/**
 * @nudo:mock dep from "./nope.js"
 */
export function f(x) {
  return dep(x);
}
`;

describe("Bug 493 — 占位 range 换算后落合法位置（line ≥ 0）", () => {
  it("toLspDiagnostic：占位 range（line 0）→ line 0（改前：-1）", () => {
    const d = toLspDiagnostic(
      {
        severity: "error",
        code: DIAG.moduleMissing,
        message: "Mock file not found for 'dep'",
        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
      },
      "file:///t/d-mock.js",
    );
    expect(d.range.start.line).toBe(0);
    expect(d.range.start.character).toBe(0);
    expect(d.range.end.line).toBe(0);
  });

  it("toLspDiagnostic：真实 1 基行号仍按 1 基 → 0 基换算（负控制）", () => {
    const d = toLspDiagnostic(
      {
        severity: "error",
        code: DIAG.entryMayThrow,
        message: "may throw",
        range: { start: { line: 3, column: 7 }, end: { line: 3, column: 8 } },
      },
      "file:///t/a.js",
    );
    expect(d.range.start.line).toBe(2);
    expect(d.range.start.character).toBe(7);
  });

  it("发布面：nudo:module-missing 落合法位置（改前：line -1）", async () => {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps = makeValidateDeps({ onPublish: (p) => published.push(p) });
    await validateText("/t/d-mock.js", "file:///t/d-mock.js", MOCK_MISSING, 1, deps, false, true);
    const last = published[published.length - 1]!;
    const missing = last.diagnostics.find((d) => d.code === DIAG.moduleMissing);
    expect(missing).toBeDefined();
    expect(missing!.range.start.line).toBeGreaterThanOrEqual(0);
    expect(missing!.range.start.character).toBeGreaterThanOrEqual(0);
  });

  it("发布面：所有诊断的 range 位置都合法（负控制：不得有 line < 0）", async () => {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps = makeValidateDeps({ onPublish: (p) => published.push(p) });
    await validateText("/t/d-mock.js", "file:///t/d-mock.js", MOCK_MISSING, 1, deps, false, true);
    const last = published[published.length - 1]!;
    for (const d of last.diagnostics) {
      expect(d.range.start.line, String(d.code)).toBeGreaterThanOrEqual(0);
      expect(d.range.start.character, String(d.code)).toBeGreaterThanOrEqual(0);
      expect(d.range.end.line, String(d.code)).toBeGreaterThanOrEqual(0);
      expect(d.range.end.character, String(d.code)).toBeGreaterThanOrEqual(0);
    }
  });
});
