import { describe, it, expect } from "vitest";
import { transpile, formatAbs, litValue } from "@nudojs/core";
import { tryBPathCall } from "@nudojs/service";

describe("B-path $fork continue-path free-write join", () => {
  it("transpile marks continue flags only for non-exit arms", () => {
    const src = `
function f(flag) {
  let x = 0;
  if (flag) { x = 1; return 2; }
  return x;
}
`;
    const out = transpile(src);
    expect(out).toContain("$isForkExit");
    expect(out).toContain("let __cont = true");
    expect(out).toContain("if ($isForkExit(e)) __cont = false");
  });

  it("literal-false path returns base x=0 (not polluted by true-arm write)", () => {
    const src = `
function pick(flag) {
  let x = 0;
  if (flag) {
    x = 1;
    return 2;
  }
  return x;
}
export { pick };
`;
    const r = tryBPathCall(src, "/tmp/bpath-early-ret-lit.js", "pick", [
      { shape: { k: "prim", type: "boolean" }, term: { op: "lit", value: false }, conf: "exact" } as never,
    ]);
    expect(r).toBeTruthy();
    expect(litValue(r!)).toBe(0);
  });

  it("literal-false still returns 2 when both arms write then return", () => {
    const src = `
function both(flag) {
  let x = 0;
  if (flag) { x = 1; return 2; }
  else { x = 3; return 4; }
}
export { both };
`;
    const r = tryBPathCall(src, "/tmp/bpath-both-ret.js", "both", [
      { shape: { k: "prim", type: "boolean" }, term: { op: "lit", value: false }, conf: "exact" } as never,
    ]);
    expect(r).toBeTruthy();
    expect(litValue(r!)).toBe(4);
  });
});
