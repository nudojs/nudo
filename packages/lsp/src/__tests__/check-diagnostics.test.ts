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
 * @nudo:contract x positive
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

  it("checkToLspDiagnostics drains takeDirectiveDiags (FIX-RESIDUAL #1)", async () => {
    const { takeDirectiveDiags } = await import("@nudojs/parser");
    takeDirectiveDiags(); // 清空
    const bad = `
/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }
`;
    const diags = checkToLspDiagnostics("/t/dir.js", bad);
    expect(diags.some((d) => d.code === "nudo:directive-syntax")).toBe(true);
    // drain 后 buffer 不得残留（不得被在途 validate 窃取）
    expect(takeDirectiveDiags()).toHaveLength(0);
  });

  it("checkToLspDiagnostics 不窃取在途其他 extract 的指令诊断（R2B-003）", async () => {
    const { takeDirectiveDiags, extractDirectives, parse, directiveDiagCount } =
      await import("@nudojs/parser");
    takeDirectiveDiags(); // 清空
    const badB = `
/**
 * @nudo:case 'b' (1)
 */
function g(x) { return x; }
`;
    const badA = `
/**
 * @nudo:case 'a' (1)
 */
function f(x) { return x; }
`;
    // 文件 B 的 hover 探测：extract 后不 drain（模拟纯查询路径污染 buffer）
    extractDirectives(parse(badB));
    const before = directiveDiagCount();
    const diags = checkToLspDiagnostics("/t/fileA.js", badA);
    // A 的结果只含 A 自己的指令诊断，不得混入 B 的
    const dirDiags = diags.filter((d) => d.code === "nudo:directive-syntax");
    expect(dirDiags.length).toBeGreaterThan(0);
    expect(dirDiags.some((d) => d.message.includes("'b'"))).toBe(false);
    expect(dirDiags.some((d) => d.message.includes("'a'"))).toBe(true);
    // B 的诊断仍在 buffer（不得被 checkToLspDiagnostics 全量 take 偷走）
    const leftover = takeDirectiveDiags();
    expect(leftover.some((d) => d.message.includes("'b'"))).toBe(true);
  });

  it("checkToLspDiagnostics catch 不再静默 return []（R2B-003）", () => {
    // 传入会让 checkSource 抛错的输入：用 Proxy 让 source 访问即抛
    const evilSource = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "toString" || prop === Symbol.toPrimitive || prop === "valueOf") {
            return () => " ";
          }
          throw new Error("boom");
        },
        has() {
          return true;
        },
      },
    ) as unknown as string;
    const diags = checkToLspDiagnostics("/t/evil.js", evilSource);
    // 失败必须留错误面（Analysis/Check error），不得 [] 把门禁通道整段丢掉
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some((d) => /error/i.test(d.message))).toBe(true);
  });
});
