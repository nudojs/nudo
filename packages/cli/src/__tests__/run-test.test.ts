import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { buildTestReport, formatTestReport } from "../run-test.ts";

describe("nudo test — case as test", () => {
  it("passes when case expected matches", async () => {
    const source = `
      /**
       * @nudo:case "num" (1) => T.number
       */
      function id(x) { return x; }
    `;
    const result = analyzeFile("/t/pass.js", source);
    const report = buildTestReport("/t/pass.js", result);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
    expect(formatTestReport(report)).toContain("PASS");
  });

  it("fails when case expected does not match", async () => {
    const source = `
      /**
       * @nudo:case "wrong" (1) => T.string
       */
      function id(x) { return x; }
    `;
    const result = analyzeFile("/t/fail.js", source);
    const report = buildTestReport("/t/fail.js", result);
    expect(report.failed).toBe(1);
    expect(formatTestReport(report)).toContain("FAILED");
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
});
