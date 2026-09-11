import { describe, it, expect } from "vitest";
import { collectAbsInlays } from "../inlay.ts";

describe("collectAbsInlays", () => {
  it("shows param constraint and return Abs", () => {
    const src = `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
`;
    const inlays = collectAbsInlays(src);
    expect(inlays.length).toBeGreaterThan(0);
    const param = inlays.find((i) => i.kind === "parameter");
    expect(param).toBeDefined();
    expect(param!.label).toContain(">");
    const ret = inlays.find((i) => i.kind === "type");
    expect(ret).toBeDefined();
    expect(ret!.label).toContain(":");
  });

  it("shows scale return term", () => {
    const src = `function scale(x) { return x + 1; }\n`;
    const inlays = collectAbsInlays(src);
    const ret = inlays.find((i) => i.kind === "type");
    expect(ret).toBeDefined();
    expect(ret!.label).toContain("x + 1");
  });
});
