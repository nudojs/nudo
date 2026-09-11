import { describe, it, expect } from "vitest";
import { checkSource, formatCheckReport } from "../index.ts";

describe("nudo check gate", () => {
  it("literal call violating constraint is error", () => {
    // needsPositive 要求 x>0；调用 -1 应报错
    const src = `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const r = needsPositive(-1);
`;
    const report = checkSource("t.js", src);
    expect(report.ok).toBe(false);
    const err = report.issues.find((i) => i.severity === "error");
    expect(err).toBeDefined();
    expect(err!.code).toBe("nudo:constraint-violated");
  });

  it("valid literal call is ok", () => {
    const src = `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const r = needsPositive(5);
`;
    const report = checkSource("t.js", src);
    expect(report.ok).toBe(true);
    expect(report.signatures.some((f) => f.name === "needsPositive")).toBe(true);
  });

  it("reports intensional signatures", () => {
    const src = `
function add(a, b) { return a + b; }
function scale(x) { return add(x, 1); }
`;
    const report = checkSource("t.js", src);
    const scale = report.signatures.find((f) => f.name === "scale");
    expect(scale!.display).toContain("A1");
  });

  it("formatCheckReport is Nudo-native (signatures + issues)", () => {
    const bad = checkSource("t.js", `function f(x){ if (x>0) return x; return 0; }\nf(-1);\n`);
    const text = formatCheckReport(bad);
    expect(text).toContain("FAILED");
    expect(text).toContain("signatures");
    expect(text).toContain("actual:");
    expect(text).toContain("expected:");
  });
});
