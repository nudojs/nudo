/**
 * check 报告/JSON 映射纯函数。
 */
import { describe, it, expect } from "vitest";
import type { CheckIssue, CheckJson, CheckReport } from "@nudojs/core";
import {
  docsDiagnosticCodes,
  domainIssuesFromDiagnostics,
  dualEntryIssue,
  issueFromCachedJson,
  mergeCheckIssues,
  mergeJsonIssues,
  mockFromErrorIssues,
  reportFromCachedJson,
  signatureFromCachedJson,
  type DomainDiagnosticLike,
} from "../check-json-map.ts";

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

describe("issueFromCachedJson", () => {
  it("maps required fields", () => {
    const i = issueFromCachedJson({
      severity: "error",
      code: "nudo:constraint-violated",
      message: "boom",
    });
    expect(i).toEqual({
      severity: "error",
      code: "nudo:constraint-violated",
      message: "boom",
    });
  });

  it("carries optional fields when present", () => {
    const i = issueFromCachedJson({
      severity: "warning",
      code: "nudo:entry-may-throw",
      message: "m",
      fn: "f",
      line: 3,
      column: 4,
      actual: "string",
      expected: "number",
      suggestion: "fix",
    });
    expect(i.fn).toBe("f");
    expect(i.line).toBe(3);
    expect(i.column).toBe(4);
    expect(i.actual).toBe("string");
    expect(i.expected).toBe("number");
    expect(i.suggestion).toBe("fix");
  });

  it("omits absent optional keys", () => {
    const i = issueFromCachedJson({
      severity: "info",
      code: "nudo:dual-entry",
      message: "m",
    });
    expect("fn" in i).toBe(false);
    expect("line" in i).toBe(false);
  });
});

describe("signatureFromCachedJson", () => {
  it("rebuilds sig with any-shaped abs placeholder", () => {
    const s = signatureFromCachedJson({
      name: "f",
      params: ["x"],
      display: "f: (any) => number",
      detail: "detail",
      conf: "exact",
      abs: "(any) => number",
    });
    expect(s.name).toBe("f");
    expect(s.params).toEqual(["x"]);
    expect(s.conf).toBe("exact");
    expect(s.abs).toEqual({ shape: { k: "any" }, conf: "exact" });
    expect("paramTypes" in s).toBe(false);
    expect("throws" in s).toBe(false);
    expect("entry" in s).toBe(false);
  });

  it("includes paramTypes / throws / entry when set", () => {
    const s = signatureFromCachedJson({
      name: "g",
      params: ["a"],
      paramTypes: ["string"],
      display: "d",
      detail: "dt",
      conf: "widened",
      abs: "…",
      throws: "TypeError",
      entry: true,
    });
    expect(s.paramTypes).toEqual(["string"]);
    expect(s.throws).toBe("TypeError");
    expect(s.entry).toBe(true);
  });

  it("entry falsy is omitted", () => {
    const s = signatureFromCachedJson({
      name: "h",
      params: [],
      display: "d",
      detail: "dt",
      conf: "exact",
      abs: "…",
      entry: false,
    });
    expect("entry" in s).toBe(false);
  });
});

describe("reportFromCachedJson", () => {
  it("maps file/ok/issues/signatures/summary", () => {
    const cached: CheckJson = {
      version: 1,
      file: "x.js",
      ok: false,
      summary: { errors: 1, warnings: 0, infos: 0, functions: 1 },
      signatures: [
        {
          name: "f",
          params: [],
          display: "d",
          detail: "dt",
          conf: "exact",
          abs: "…",
        },
      ],
      issues: [
        { severity: "error", code: "c", message: "m" },
      ],
    };
    const r = reportFromCachedJson(cached);
    expect(r.file).toBe("x.js");
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(1);
    expect(r.signatures[0]!.name).toBe("f");
    expect(r.summary).toEqual({ errors: 1, warnings: 0, infos: 0, functions: 1 });
    expect(r.summary).not.toBe(cached.summary);
  });
});

describe("docsDiagnosticCodes", () => {
  it("empty → []", () => {
    expect(docsDiagnosticCodes([])).toEqual([]);
  });

  it("keeps nudo codes, drops others and dedups", () => {
    expect(
      docsDiagnosticCodes([
        { code: "nudo:entry-may-throw" },
        { code: "nudo:entry-may-throw" },
        { code: "other:code" },
        { code: undefined },
        { code: "nudo:dual-entry" },
      ]),
    ).toEqual(["nudo:entry-may-throw", "nudo:dual-entry"]);
  });

  it("accepts nudo word/hyphen/colon pattern", () => {
    expect(docsDiagnosticCodes([{ code: "nudo-foo-bar" }])).toEqual(["nudo-foo-bar"]);
    expect(docsDiagnosticCodes([{ code: "nudoX" }])).toEqual(["nudoX"]);
  });
});

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

  it("empty → []", () => {
    expect(mockFromErrorIssues([])).toEqual([]);
  });
});

describe("domainIssuesFromDiagnostics", () => {
  const base: DomainDiagnosticLike = {
    code: "nudo:interface-domain-exceeds",
    severity: "error",
    message: "exceeds",
    range: { start: { line: 2, column: 5 } },
    data: { actual: "string", expected: "number" },
    suggestions: ["relax"],
  };

  it("maps domain-exceeds diagnostics", () => {
    const issues = domainIssuesFromDiagnostics([base]);
    expect(issues).toEqual([
      {
        severity: "error",
        code: "nudo:interface-domain-exceeds",
        message: "exceeds",
        line: 2,
        column: 5,
        actual: "string",
        expected: "number",
        suggestion: "relax",
      },
    ]);
  });

  it("non-error severity becomes warning", () => {
    const issues = domainIssuesFromDiagnostics([{ ...base, severity: "info" }]);
    expect(issues[0]!.severity).toBe("warning");
  });

  it("filters other codes", () => {
    expect(
      domainIssuesFromDiagnostics([{ ...base, code: "nudo:other" }]),
    ).toEqual([]);
  });

  it("non-string actual/expected become undefined; missing suggestions", () => {
    const issues = domainIssuesFromDiagnostics([
      { ...base, data: { actual: 1, expected: null }, suggestions: undefined },
    ]);
    expect(issues[0]!.actual).toBeUndefined();
    expect(issues[0]!.expected).toBeUndefined();
    expect(issues[0]!.suggestion).toBeUndefined();
    expect("actual" in issues[0]!).toBe(true);
  });

  it("missing data → undefined actual/expected", () => {
    const issues = domainIssuesFromDiagnostics([
      { ...base, data: undefined },
    ]);
    expect(issues[0]!.actual).toBeUndefined();
    expect(issues[0]!.expected).toBeUndefined();
  });
});

describe("dualEntryIssue", () => {
  it("info issue with loc", () => {
    expect(
      dualEntryIssue({ message: "m", line: 1, column: 2, suggestion: "s" }),
    ).toEqual({
      severity: "info",
      code: "nudo:dual-entry",
      message: "m",
      line: 1,
      column: 2,
      suggestion: "s",
    });
  });

  it("keeps undefined loc keys present", () => {
    const i = dualEntryIssue({ message: "m" });
    expect("line" in i).toBe(true);
    expect(i.line).toBeUndefined();
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

describe("mergeJsonIssues", () => {
  const json: CheckJson = {
    version: 1,
    file: "a.js",
    ok: true,
    summary: { errors: 0, warnings: 1, infos: 0, functions: 1 },
    signatures: [],
    issues: [],
  };

  it("appends and bumps summary", () => {
    const out = mergeJsonIssues(json, [
      {
        severity: "info",
        code: "nudo:dual-entry",
        message: "m",
        line: 1,
        column: 2,
        suggestion: "s",
      },
    ]);
    expect(out.issues).toHaveLength(1);
    expect(out.summary.infos).toBe(1);
    expect(out.summary.warnings).toBe(1);
    expect(out.ok).toBe(true);
  });

  it("does not flip ok on error issues", () => {
    const out = mergeJsonIssues(json, [
      { severity: "error", code: "c", message: "m" },
    ]);
    expect(out.ok).toBe(true);
    expect(out.summary.errors).toBe(1);
  });
});
