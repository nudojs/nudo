import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analyzer.ts";

describe("Diagnostic error codes and suggestions", () => {
  it("should include code for unreachable diagnostics", () => {
    const source = `
// @nudo:case "test" (1)
function fn(x) {
  return x;
  return x + 1;
}
`;
    const result = analyzeFile("test.js", source);
    const unreachable = result.diagnostics.find(d => d.message.includes("unreachable"));
    expect(unreachable).toBeDefined();
    expect(unreachable!.code).toBe("nudo-unreachable");
  });

  it("should include suggestions for unreachable diagnostics", () => {
    const source = `
// @nudo:case "test" (1)
function fn(x) {
  return x;
  return x + 1;
}
`;
    const result = analyzeFile("test.js", source);
    const unreachable = result.diagnostics.find(d => d.message.includes("unreachable"));
    expect(unreachable!.suggestions).toBeDefined();
    expect(unreachable!.suggestions!.length).toBeGreaterThan(0);
  });

  it("should include code for assertion-failed diagnostics", () => {
    const source = `
/** @nudo:case "test" (1)
 *  @nudo:returns (T.string)
 */
function fn(x) {
  return x;
}
`;
    const result = analyzeFile("test.js", source);
    const assertion = result.diagnostics.find(d => d.message.includes("assertion"));
    expect(assertion).toBeDefined();
    expect(assertion!.code).toBe("nudo-assertion-failed");
  });

  it("should include suggestions for assertion-failed diagnostics", () => {
    const source = `
/** @nudo:case "test" (1)
 *  @nudo:returns (T.string)
 */
function fn(x) {
  return x;
}
`;
    const result = analyzeFile("test.js", source);
    const assertion = result.diagnostics.find(d => d.message.includes("assertion"));
    expect(assertion!.suggestions).toBeDefined();
    expect(assertion!.suggestions!.length).toBeGreaterThan(0);
  });

  it("should generate nudo:builtin-unknown for uncovered APIs", () => {
    const source = `
// @nudo:case "test" ()
function fn() {
  return WeakRef;
}
`;
    const result = analyzeFile("test.js", source);
    const builtin = result.diagnostics.find(d => d.code === "nudo:builtin-unknown");
    expect(builtin).toBeDefined();
    expect(builtin!.suggestions).toBeDefined();
    expect(builtin!.suggestions![0]).toContain("@nudo:mock");
  });
});
