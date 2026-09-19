import { describe, it, expect } from "vitest";
import { analysisConfig, DEFAULT_ANALYSIS_MODE } from "../evaluator/config.ts";

/** A8 golden default — prevents silent default-tightening without a changeset */
const GOLDEN_DEFAULT = {
  include: [],
  exclude: ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
  mode: "exports" as const,
  diagnostics: "default" as const,
  callSiteBudget: 3,
  evalMissingSlot: "off" as const,
};

describe("analysisConfig A1/A8 default", () => {
  it("defaults to exports when config is null/undefined", () => {
    for (const c of [undefined, null, {}]) {
      const a = analysisConfig(c);
      expect(a.mode).toBe("exports");
      expect(a.diagnostics).toBe("default");
    }
  });

  it("pins full AnalysisConfig golden for null / {} / undefined", () => {
    expect(DEFAULT_ANALYSIS_MODE).toBe("exports");
    for (const c of [undefined, null, {}]) {
      expect(analysisConfig(c)).toEqual(GOLDEN_DEFAULT);
    }
  });

  it("explicit directives keeps errors tier; evalMissingSlot stays off", () => {
    const a = analysisConfig({ analysis: { mode: "directives" } });
    expect(a.mode).toBe("directives");
    expect(a.diagnostics).toBe("errors");
    expect(a.evalMissingSlot).toBe("off");
  });

  it("invalid mode falls back to exports", () => {
    expect(analysisConfig({ analysis: { mode: "everything" } }).mode).toBe("exports");
  });

  it("evalMissingSlot warning is explicit opt-in only", () => {
    expect(analysisConfig({ analysis: { evalMissingSlot: "warning" } }).evalMissingSlot).toBe(
      "warning",
    );
    expect(analysisConfig({ analysis: { evalMissingSlot: "off" } }).evalMissingSlot).toBe("off");
  });

  it("empty exclude array falls back to safe default (node_modules stays excluded)", () => {
    const a = analysisConfig({ analysis: { exclude: [] } });
    expect(a.exclude).toEqual(GOLDEN_DEFAULT.exclude);
  });
});
