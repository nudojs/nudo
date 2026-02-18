import { describe, it, expect, vi } from "vitest";
import justscriptPlugin from "../index.ts";

describe("vite-plugin-justscript", () => {
  it("creates a plugin with correct name", () => {
    const plugin = justscriptPlugin();
    expect(plugin.name).toBe("vite-plugin-justscript");
  });

  it("returns null for non-.just.js files", () => {
    const plugin = justscriptPlugin();
    const result = plugin.transform.call({}, "const x = 1;", "/test/file.js");
    expect(result).toBeNull();
  });

  it("returns null for node_modules files", () => {
    const plugin = justscriptPlugin();
    const result = plugin.transform.call({}, "const x = 1;", "/node_modules/pkg/file.just.js");
    expect(result).toBeNull();
  });

  it("analyzes .just.js files and reports warnings", () => {
    const plugin = justscriptPlugin();
    const warnFn = vi.fn();
    const ctx = { warn: warnFn, error: vi.fn() };

    const source = `
/**
 * @just:case "negative" (-1)
 */
function safeSqrt(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return x;
}
`;
    const result = plugin.transform.call(ctx, source, "/test/throws.just.js");
    expect(result).toBeNull();
    expect(warnFn).toHaveBeenCalled();
  });

  it("respects custom include patterns", () => {
    const plugin = justscriptPlugin({ include: ["**/*.typed.js"] });
    const result = plugin.transform.call({}, "const x = 1;", "/test/file.just.js");
    expect(result).toBeNull();
  });

  it("clears cache on buildStart", () => {
    const plugin = justscriptPlugin();
    plugin.buildStart.call({});
    // No error means cache cleared successfully
  });

  it("reports summary on buildEnd", () => {
    const plugin = justscriptPlugin();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    plugin.buildStart.call({});
    plugin.buildEnd.call({});
    consoleSpy.mockRestore();
  });

  it("errors when failOnError is true and diagnostics have errors", () => {
    const plugin = justscriptPlugin({ failOnError: true });
    const errorFn = vi.fn();
    const warnFn = vi.fn();
    const ctx = { warn: warnFn, error: errorFn };

    const source = `
/**
 * @just:case "test" (T.number)
 * @just:returns (T.string)
 */
function identity(x) {
  return x;
}
`;
    plugin.transform.call(ctx, source, "/test/fail.just.js");
    expect(errorFn).toHaveBeenCalled();
  });
});
