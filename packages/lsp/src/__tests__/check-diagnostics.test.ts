import { describe, it, expect } from "vitest";
import { clearValidationState, checkToLspDiagnostics, validateText } from "../validation.ts";

describe("Abs check as LSP diagnostics", () => {
  it("maps constraint violations to nudo-check diagnostics", () => {
    const src = `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-1);
`;
    const diags = checkToLspDiagnostics("/t/check.js", src);
    expect(diags.length).toBeGreaterThan(0);
    const d = diags[0]!;
    expect(d.source).toBe("nudo-check");
    expect(d.code).toBe("nudo:constraint-violated");
    expect(d.message).toContain("actual");
    expect(d.message).toContain("expected");
  });

  it("validateText publishes check diags first", async () => {
    clearValidationState();
    const src = `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-1);
`;
    let sent: { source?: string; code?: string }[] = [];
    await validateText("/t/check2.js", "file:///t/check2.js", src, 1, {
      sendDiagnostics: (p) => {
        sent = p.diagnostics.map((d) => ({ source: d.source, code: d.code as string }));
      },
    });
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]!.source).toBe("nudo-check");
  });
});
