import { describe, it, expect } from "vitest";
import { analysisConfig } from "../evaluator/config.ts";

describe("analysisConfig A1 default", () => {
  it("defaults to exports when config is null/undefined", () => {
    for (const c of [undefined, null, {}]) {
      const a = analysisConfig(c);
      expect(a.mode).toBe("exports");
      expect(a.diagnostics).toBe("default");
    }
  });

  it("explicit directives keeps errors tier", () => {
    const a = analysisConfig({ analysis: { mode: "directives" } });
    expect(a.mode).toBe("directives");
    expect(a.diagnostics).toBe("errors");
  });

  it("invalid mode falls back to exports", () => {
    expect(analysisConfig({ analysis: { mode: "everything" } }).mode).toBe("exports");
  });
});
