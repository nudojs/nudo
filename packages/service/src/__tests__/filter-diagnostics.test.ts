import { describe, it, expect } from "vitest";
import { filterDiagnosticsByLevel } from "../analysis-scope.ts";

const sample = [
  { severity: "error", code: "nudo:constraint-violated", message: "e" },
  { severity: "warning", code: "nudo:unknown-recv", message: "noisy" },
  { severity: "warning", code: "nudo:other", message: "keep" },
  { severity: "info", code: "nudo:info", message: "i" },
];

describe("filterDiagnosticsByLevel (A3)", () => {
  it("verbose keeps all", () => {
    expect(filterDiagnosticsByLevel(sample, "verbose")).toHaveLength(4);
  });
  it("off keeps only errors", () => {
    const r = filterDiagnosticsByLevel(sample, "off");
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("error");
  });
  it("errors keeps only errors", () => {
    expect(filterDiagnosticsByLevel(sample, "errors")).toHaveLength(1);
  });
  it("default drops noisy warnings and info", () => {
    const r = filterDiagnosticsByLevel(sample, "default");
    expect(r.map((d) => d.code)).toEqual(["nudo:constraint-violated", "nudo:other"]);
  });
});
