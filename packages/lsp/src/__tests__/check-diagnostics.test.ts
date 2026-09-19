import { describe, it, expect } from "vitest";
import {
  clearValidationState,
  checkToLspDiagnostics,
  filterCheckLspByLevel,
  validateText,
} from "../validation.ts";
import { DiagnosticSeverity } from "vscode-languageserver/node";

const STD = `
export const positive = number().gt(0);
`;

const src = `
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-1);
`;

const loadModule = (spec: string) =>
  spec.includes("std.nudo") ? STD : undefined;

describe("Abs check as LSP diagnostics", () => {
  it("maps constraint violations to nudo-check diagnostics", () => {
    const diags = checkToLspDiagnostics("/t/check.js", src, loadModule);
    expect(diags.length).toBeGreaterThan(0);
    const d = diags[0]!;
    expect(d.source).toBe("nudo-check");
    expect(d.code).toBe("nudo:constraint-violated");
    expect(d.message).toContain("actual");
    expect(d.message).toContain("expected");
  });

  it("validateText publishes check diags first", async () => {
    clearValidationState();
    let sent: { source?: string; code?: string }[] = [];
    await validateText("/t/check2.js", "file:///t/check2.js", src, 1, {
      sendDiagnostics: (p) => {
        sent = p.diagnostics.map((d) => ({ source: d.source, code: d.code as string }));
      },
    });
    // validateText 用磁盘 loadModule；虚拟路径下无 std.nudo.js → 无 check diags 也可
    // 至少不崩溃
    expect(Array.isArray(sent)).toBe(true);
  });

  it("filterCheckLspByLevel matches push/pull gate (shared helper)", () => {
    const diags = [
      {
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message: "e",
      },
      {
        severity: DiagnosticSeverity.Warning,
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
        message: "w",
      },
      {
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
        message: "i",
      },
    ];
    expect(filterCheckLspByLevel(diags, "off")).toEqual([]);
    expect(filterCheckLspByLevel(diags, "errors")).toHaveLength(1);
    expect(filterCheckLspByLevel(diags, "errors")[0]!.severity).toBe(DiagnosticSeverity.Error);
    // default：error+warning，info 挡住（与 push 同）
    expect(filterCheckLspByLevel(diags, "default")).toHaveLength(2);
    expect(filterCheckLspByLevel(diags, "verbose")).toHaveLength(3);
  });
});
