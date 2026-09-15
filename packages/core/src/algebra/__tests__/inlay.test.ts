import { describe, it, expect } from "vitest";
import { collectAbsInlays } from "../inlay.ts";

describe("collectAbsInlays", () => {
  it("does not invent param where from if (control flow ≠ contract)", () => {
    const src = `
function double(x) {
  if (x > 3) return x;
  return x * 2;
}
`;
    const inlays = collectAbsInlays(src);
    expect(inlays.find((i) => i.kind === "parameter")).toBeUndefined();
    const ret = inlays.find((i) => i.kind === "type");
    expect(ret).toBeDefined();
  });

  it("shows scale return term with param name", () => {
    const src = `function scale(x) { return x + 1; }\n`;
    const inlays = collectAbsInlays(src);
    const ret = inlays.find((i) => i.kind === "type");
    expect(ret).toBeDefined();
    expect(ret!.label).toContain("x + 1");
  });

  it("double: return paths as x | x * 2", () => {
    const src = `
function double(x) {
  if (x > 3) return x;
  return x * 2;
}
`;
    const inlays = collectAbsInlays(src);
    const ret = inlays.find((i) => i.kind === "type");
    expect(ret).toBeDefined();
    expect(ret!.label).toContain("x | x * 2");
  });
});
