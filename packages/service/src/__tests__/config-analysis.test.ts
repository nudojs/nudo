import { describe, it, expect } from "vitest";
import { analysisConfig, type NudoConfig } from "../evaluator/config.ts";

describe("analysisConfig", () => {
  it("defaults when config is null/undefined or lacks analysis", () => {
    for (const c of [undefined, null, {}, { interface: { autoBind: true } }]) {
      const a = analysisConfig(c);
      expect(a.mode).toBe("directives");
      expect(a.diagnostics).toBe("errors");
      expect(a.exclude).toContain("**/node_modules/**");
      expect(a.include.length).toBeGreaterThan(0);
    }
  });

  it("mode=all implies diagnostics default when diagnostics omitted", () => {
    const a = analysisConfig({ analysis: { mode: "all" } });
    expect(a.mode).toBe("all");
    expect(a.diagnostics).toBe("default");
  });

  it("mode=exports", () => {
    expect(analysisConfig({ analysis: { mode: "exports" } }).mode).toBe("exports");
  });

  it("invalid mode falls back to directives", () => {
    expect(analysisConfig({ analysis: { mode: "everything" } }).mode).toBe("directives");
  });

  it("reads include/exclude as string or array", () => {
    const a = analysisConfig({
      analysis: { include: "src/**/*.js", exclude: ["**/tmp/**"] },
    });
    expect(a.include).toEqual(["src/**/*.js"]);
    expect(a.exclude).toEqual(["**/tmp/**"]);
  });

  it("empty include/exclude arrays fall back to defaults", () => {
    const a = analysisConfig({ analysis: { include: [], exclude: [] } });
    expect(a.include.length).toBeGreaterThan(0);
    expect(a.exclude.length).toBeGreaterThan(0);
  });

  it("reads diagnostics level; invalid falls back", () => {
    expect(analysisConfig({ analysis: { diagnostics: "verbose" } }).diagnostics).toBe(
      "verbose",
    );
    expect(analysisConfig({ analysis: { diagnostics: "loud" } }).diagnostics).toBe(
      "errors",
    );
  });

  it("does not affect interfaceConfig", () => {
    const c: NudoConfig = { analysis: { mode: "all" }, interface: { autoBind: false } };
    expect(analysisConfig(c).mode).toBe("all");
  });
});
