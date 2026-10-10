import { describe, it, expect } from "vitest";
import {
  parseAnalysisMode,
  parseInlayParams,
  toInitializationOptions,
  toNudoSettings,
  toDidChangeConfigurationParams,
  type NudoAnalysisMode,
} from "../extension-config.ts";

/** workspace.getConfiguration("nudo") 的替身：值表 → get(section) 读取面。 */
const configOf = (
  mode?: NudoAnalysisMode | "unset-invalid" | number,
  inlayParams?: boolean | "unset-invalid" | number,
) => ({
  get: <T = unknown>(section: string): T | undefined =>
    section === "analysis.mode"
      ? (mode as T | undefined)
      : section === "inlayHints.parameters"
        ? (inlayParams as T | undefined)
        : undefined,
});

describe("parseAnalysisMode", () => {
  it("accepts the three declared modes", () => {
    expect(parseAnalysisMode("exports")).toBe("exports");
    expect(parseAnalysisMode("directives")).toBe("directives");
    expect(parseAnalysisMode("all")).toBe("all");
  });

  it("rejects anything else (unset / typo / wrong type)", () => {
    expect(parseAnalysisMode(undefined)).toBeUndefined();
    expect(parseAnalysisMode("everything")).toBeUndefined();
    expect(parseAnalysisMode(42)).toBeUndefined();
    expect(parseAnalysisMode(null)).toBeUndefined();
  });
});

describe("toInitializationOptions（配置→initializationOptions 映射）", () => {
  it("forwards a valid mode under analysis", () => {
    expect(toInitializationOptions(configOf("directives"))).toEqual({
      analysis: { mode: "directives" },
    });
  });

  it("omits analysis entirely when the setting is unset", () => {
    expect(toInitializationOptions(configOf(undefined))).toEqual({});
  });

  it("omits analysis on invalid values instead of forwarding garbage", () => {
    expect(toInitializationOptions(configOf("unset-invalid"))).toEqual({});
    expect(toInitializationOptions(configOf(7))).toEqual({});
  });
});

describe("parseInlayParams", () => {
  it("accepts booleans only", () => {
    expect(parseInlayParams(true)).toBe(true);
    expect(parseInlayParams(false)).toBe(false);
    expect(parseInlayParams(undefined)).toBeUndefined();
    expect(parseInlayParams("true")).toBeUndefined();
    expect(parseInlayParams(1)).toBeUndefined();
    expect(parseInlayParams(null)).toBeUndefined();
  });
});

describe("toNudoSettings / toInitializationOptions（inlayHints.parameters 转发）", () => {
  it("forwards a boolean under inlayHints", () => {
    expect(toInitializationOptions(configOf(undefined, true))).toEqual({
      inlayHints: { parameters: true },
    });
    expect(toInitializationOptions(configOf(undefined, false))).toEqual({
      inlayHints: { parameters: false },
    });
  });

  it("omits inlayHints when the setting is unset", () => {
    expect(toInitializationOptions(configOf(undefined, undefined))).toEqual({});
  });

  it("omits inlayHints on invalid values instead of forwarding garbage", () => {
    expect(toInitializationOptions(configOf(undefined, "unset-invalid"))).toEqual(
      {},
    );
    expect(toInitializationOptions(configOf(undefined, 7))).toEqual({});
  });

  it("carries analysis and inlayHints together", () => {
    expect(toNudoSettings(configOf("all", true))).toEqual({
      analysis: { mode: "all" },
      inlayHints: { parameters: true },
    });
  });
});

describe("toDidChangeConfigurationParams（inlayHints.parameters 推送）", () => {
  it("nests inlayHints under settings.nudo", () => {
    expect(toDidChangeConfigurationParams(configOf(undefined, true))).toEqual({
      settings: { nudo: { inlayHints: { parameters: true } } },
    });
  });

  it("clears the inlayHints section when the setting is cleared", () => {
    expect(toDidChangeConfigurationParams(configOf(undefined, undefined))).toEqual(
      { settings: { nudo: {} } },
    );
  });
});

describe("toDidChangeConfigurationParams（设置变更推送载荷）", () => {
  it("nests the same shape under settings.nudo", () => {
    expect(toDidChangeConfigurationParams(configOf("all"))).toEqual({
      settings: { nudo: { analysis: { mode: "all" } } },
    });
  });

  it("carries an empty nudo section when the setting was cleared", () => {
    expect(toDidChangeConfigurationParams(configOf(undefined))).toEqual({
      settings: { nudo: {} },
    });
  });

  it("shares shape with initializationOptions (settings.nudo ≡ initializationOptions)", () => {
    const cfg = configOf("exports");
    expect(toDidChangeConfigurationParams(cfg).settings.nudo).toEqual(
      toNudoSettings(cfg),
    );
    expect(toDidChangeConfigurationParams(cfg).settings.nudo).toEqual(
      toInitializationOptions(cfg),
    );
  });
});
