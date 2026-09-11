import { describe, it, expect } from "vitest";
import { checkTool } from "../agent-tools.ts";

const STD = `
export const positive = number().gt(0);
export const delay = number().gt(0);
`;

const src = `
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-1);
`;

const loadModule = (spec: string) =>
  spec.includes("std.nudo") ? STD : undefined;

describe("nudo.check agent tool", () => {
  it("returns CheckJson v1 in json format", () => {
    const r = checkTool(
      { file: "/t/a.js", source: src, format: "json", loadModule },
      { readFile: () => src },
    );
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed.version).toBe(1);
    expect(parsed.ok).toBe(false);
    expect(parsed.issues.some((i: { code: string }) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("text format includes actual/expected", () => {
    const r = checkTool(
      { file: "/t/a.js", source: src, loadModule },
      { readFile: () => src },
    );
    const text = r.content[0].text;
    expect(text).toContain("FAILED");
    expect(text).toContain("actual");
    expect(text).toContain("expected");
    expect(text).toContain('"version": 1');
  });
});
