import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { buildTestReport, formatTestReport } from "../run-test.ts";

describe("nudo test — case as test", () => {
  it("passes when case expected matches", async () => {
    const source = `
      /**
       * @nudo:case "num" (1) => number()
       */
      function id(x) { return x; }
    `;
    const result = analyzeFile("/t/pass.js", source);
    const report = buildTestReport("/t/pass.js", result);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
    const text = formatTestReport(report);
    expect(text).toContain("assertions");
    expect(text).toContain("1 passed");
  });

  it("fails when case expected does not match", async () => {
    const source = `
      /**
       * @nudo:case "wrong" (1) => string()
       */
      function id(x) { return x; }
    `;
    const result = analyzeFile("/t/fail.js", source);
    const report = buildTestReport("/t/fail.js", result);
    expect(report.failed).toBe(1);
    const text = formatTestReport(report);
    expect(text).toContain("[FAIL]");
    expect(text).toContain("1 failed");
  });

  it("reports unchecked when no expected type", async () => {
    const source = `
      /**
       * @nudo:case "free" (1)
       */
      function id(x) { return x; }
    `;
    const result = analyzeFile("/t/free.js", source);
    const report = buildTestReport("/t/free.js", result);
    expect(report.unchecked).toBe(1);
    expect(report.failed).toBe(0);
  });

  it("prints synthetic entry@/call@ cases by default (observation)", async () => {
    const source = `
      function id(x) { return x; }
      id(1);
    `;
    const result = analyzeFile("/t/obs.js", source);
    const report = buildTestReport("/t/obs.js", result);
    const text = formatTestReport(report);
    expect(text).toContain("call@");
  });
});
