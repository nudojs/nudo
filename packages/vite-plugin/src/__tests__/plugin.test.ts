import { describe, it, expect, vi } from "vitest";
import nudoPlugin from "../index.ts";

describe("vite-plugin-nudo", () => {
  it("creates a plugin with correct name", () => {
    const plugin = nudoPlugin();
    expect(plugin.name).toBe("vite-plugin-nudo");
  });

  it("returns null for files without @nudo: directives", () => {
    const plugin = nudoPlugin();
    const result = plugin.transform.call({}, "const x = 1;", "/test/file.js");
    expect(result).toBeNull();
  });

  it("returns null for node_modules files", () => {
    const plugin = nudoPlugin();
    const result = plugin.transform.call({}, "const x = 1;", "/node_modules/pkg/file.js");
    expect(result).toBeNull();
  });

  it("analyzes files with @nudo: directives and reports warnings", () => {
    const plugin = nudoPlugin();
    const warnFn = vi.fn();
    const ctx = { warn: warnFn, error: vi.fn() };

    const source = `
/**
 * @nudo:case "negative" (-1)
 */
function safeSqrt(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return x;
}
`;
    const result = plugin.transform.call(ctx, source, "/test/throws.js");
    expect(result).toBeNull();
    expect(warnFn).toHaveBeenCalled();
  });

  it("respects custom include patterns", () => {
    const plugin = nudoPlugin({ include: ["**/*.typed.js"] });
    const result = plugin.transform.call({}, "const x = 1;", "/test/file.js");
    expect(result).toBeNull();
  });

  it("clears cache on buildStart", () => {
    const plugin = nudoPlugin();
    plugin.buildStart.call({});
    // No error means cache cleared successfully
  });

  it("reports summary on buildEnd", () => {
    const plugin = nudoPlugin();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    plugin.buildStart.call({});
    plugin.buildEnd.call({});
    consoleSpy.mockRestore();
  });

  it("errors when failOnError is true and diagnostics have errors", () => {
    const plugin = nudoPlugin({ failOnError: true });
    const errorFn = vi.fn();
    const warnFn = vi.fn();
    const ctx = { warn: warnFn, error: errorFn };

    const source = `
/**
 * @nudo:case "test" (T.number)
 * @nudo:returns (T.string)
 */
function identity(x) {
  return x;
}
`;
    plugin.transform.call(ctx, source, "/test/fail.js");
    expect(errorFn).toHaveBeenCalled();
  });
});
