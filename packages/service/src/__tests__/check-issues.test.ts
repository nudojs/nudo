/**
 * check 补充诊断通道的 helper 单测（`mergeCheckIssues` / `mockFromErrorIssues`）。
 *
 * 由来：这两个 helper 原在 CLI 侧 `packages/nudojs/src/check-json-map.ts` 有
 * 一份**私有副本**与私有单测（`packages/nudojs/src/__tests__/check-json-map.test.ts`）；
 * 两份实现在「重复声明 / 导出名缺失」两族的 suggestion 上**漂移**
 * （CLI 通用句 vs service 按错误种类细分的具体句）⇒ CLI 副本已删除、调用方
 * 直接 import service 的这份 ⇒ 单测随实现迁移，期望取 **service 行为**。
 */
import { describe, it, expect } from "vitest";
import type { CheckIssue, CheckReport } from "@nudojs/core";
import { mergeCheckIssues, mockFromErrorIssues } from "../check-issues.ts";

const emptySummary = { errors: 0, warnings: 0, infos: 0, functions: 2 };

function reportOf(issues: CheckIssue[], ok = true): CheckReport {
  return {
    file: "a.js",
    issues,
    ok,
    signatures: [],
    summary: { ...emptySummary },
  };
}

describe("mockFromErrorIssues", () => {
  it("maps each error with suggestion", () => {
    const issues = mockFromErrorIssues([
      { name: "m", fromPath: "./x.js", message: "missing" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.code).toBe("nudo:module-missing");
    expect(issues[0]!.message).toBe("missing");
    expect(issues[0]!.suggestion).toBe(
      'Create the mock file or fix the path in @nudo:mock m from "./x.js"',
    );
  });

  it("duplicate @nudo:mock-module ⇒ 具体句（只保留一条声明）", () => {
    const issues = mockFromErrorIssues([
      {
        name: "fs",
        fromPath: "./m.js",
        message:
          'Duplicate @nudo:mock-module directive for "./m.js" — first at line 1, again at line 3',
        code: "nudo:mock-invalid",
      },
    ]);
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.code).toBe("nudo:mock-invalid");
    expect(issues[0]!.suggestion).toBe(
      "Remove the duplicate @nudo:mock-module declaration — keep only one directive per module specifier",
    );
  });

  it("缺导出名 ⇒ 具体句（点名缺失的导出）", () => {
    const issues = mockFromErrorIssues([
      {
        name: "fs",
        fromPath: "./m.js",
        message: 'Mock module "./m.js" does not export "readFile"',
        code: "nudo:module-missing",
      },
    ]);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.suggestion).toBe(
      'Add "readFile" to the mock file "./m.js", or drop it from the @nudo:mock-module directive',
    );
  });

  it("表达式解析失败 ⇒ 通用表达式句", () => {
    const issues = mockFromErrorIssues([
      {
        name: "fs",
        fromPath: "./m.js",
        message: "Unsupported @nudo:mock expression: ...",
        code: "nudo:mock-invalid",
      },
    ]);
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.suggestion).toBe(
      "Fix the @nudo:mock expression (constraint builders, literals, or arrow functions)",
    );
  });

  it("empty → []", () => {
    expect(mockFromErrorIssues([])).toEqual([]);
  });
});

describe("mergeCheckIssues", () => {
  it("appends and bumps summary by severity", () => {
    const r = mergeCheckIssues(reportOf([]), [
      { severity: "error", code: "a", message: "1" },
      { severity: "warning", code: "b", message: "2" },
      { severity: "info", code: "c", message: "3" },
    ]);
    expect(r.issues).toHaveLength(3);
    expect(r.summary.errors).toBe(1);
    expect(r.summary.warnings).toBe(1);
    expect(r.summary.infos).toBe(1);
    expect(r.summary.functions).toBe(2);
    expect(r.ok).toBe(false);
  });

  it("info-only keeps ok", () => {
    const r = mergeCheckIssues(reportOf([], true), [
      { severity: "info", code: "c", message: "3" },
    ]);
    expect(r.ok).toBe(true);
  });

  it("error flips ok even if previously ok", () => {
    expect(mergeCheckIssues(reportOf([], true), [
      { severity: "error", code: "a", message: "1" },
    ]).ok).toBe(false);
  });

  it("already-failed stays failed", () => {
    expect(mergeCheckIssues(reportOf([], false), [
      { severity: "warning", code: "a", message: "1" },
    ]).ok).toBe(false);
  });

  it("empty issues is identity on counts", () => {
    const r = mergeCheckIssues(reportOf([{ severity: "error", code: "a", message: "1" }], false), []);
    expect(r.summary.errors).toBe(0);
    expect(r.ok).toBe(false);
  });
});
