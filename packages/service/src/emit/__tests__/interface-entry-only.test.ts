import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";

describe("nudo:interface-entry-only", () => {
  it("fires info on export with no contract and no call-site domain", () => {
    const src = `
export function lonely(x) {
  return x;
}
`;
    const r = analyzeFile("/tmp/entry-only.js", src);
    const d = r.diagnostics.find((x) => x.code === "nudo:interface-entry-only");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("info");
    expect(d!.message).toContain("lonely");
  });

  it("does not fire when there is a call-site domain", () => {
    const src = `
export function id(x) { return x; }
id(5);
`;
    const r = analyzeFile("/tmp/entry-has-domain.js", src);
    const d = r.diagnostics.find((x) => x.code === "nudo:interface-entry-only");
    expect(d).toBeUndefined();
  });

  it("does not fire for non-export helpers", () => {
    const src = `
function helper(x) { return x; }
export function use(x) { return helper(x); }
use(1);
`;
    const r = analyzeFile("/tmp/entry-helper.js", src);
    const msgs = r.diagnostics
      .filter((x) => x.code === "nudo:interface-entry-only")
      .map((x) => x.message);
    expect(msgs.every((m) => !m.includes("helper"))).toBe(true);
  });
});
