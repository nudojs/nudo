/**
 * Bug 460：nudo:mock-invalid 的严重度。
 *
 * 文档口径（packages/website/docs/reference/diagnostics.md#nudo-mock-invalid、
 * packages/website/docs/guides/check.md「nudo:mock-invalid | engine | warning」）
 * 是 **warning**：@nudo:mock 表达式解析失败 ⇒ 指令被忽略，mock 不生效。
 *
 * 修复前：service 面的 mock 种子通道（mockDirectivesToAbsSeeds 的 fromErrors）
 * 把它报成 error，而同一文件里的静态校验通道（validateMockDirectives）报
 * warning——同一 code 两条通道两种严重度，且与文档相反。
 *
 * 本测试锁住：
 *   ① mock 表达式解析失败 = warning（不再让 CI 门禁由红转绿地误报）
 *   ② 两条 mock-invalid 通道严重度一致
 *   ③ mock **文件**缺失/加载失败仍是 error（不引入假绿）
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analyzer.ts";

const MOCK_EXPR = `// @nudo:mock fs = foo(1)
export function useFs() { return 1; }
`;

const MOCK_MISSING_FILE = `// @nudo:mock fs from "./definitely-missing-mock-file.js"
export function useFs() { return 1; }
`;

describe("Bug 460 — nudo:mock-invalid severity", () => {
  it("mock expression parse failure is a warning, not an error", () => {
    const r = analyzeFile("/t/b460/mock-expr.js", MOCK_EXPR);
    const diags = r.diagnostics.filter((d) => d.code === "nudo:mock-invalid");
    expect(diags.length).toBeGreaterThan(0);
    for (const d of diags) {
      expect(d.severity).toBe("warning");
    }
  });

  it("both mock-invalid channels (static validation + mock seed) agree", () => {
    const r = analyzeFile("/t/b460/mock-expr-agree.js", MOCK_EXPR);
    const sevs = new Set(
      r.diagnostics.filter((d) => d.code === "nudo:mock-invalid").map((d) => d.severity),
    );
    expect([...sevs]).toEqual(["warning"]);
  });

  it("missing mock file stays an error (no fake green)", () => {
    const r = analyzeFile("/t/b460/mock-missing.js", MOCK_MISSING_FILE);
    const errs = r.diagnostics.filter((d) => d.severity === "error");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((d) => d.code === "nudo:module-missing")).toBe(true);
  });
});
