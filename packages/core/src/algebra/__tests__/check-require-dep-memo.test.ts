import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, resetCheckSourceMemo, pTrue } from "../index.ts";
import { STD_NUDO_SRC } from "./nudo-constraints.ts";

beforeEach(() => {
  resetCheckSourceMemo();
});

describe("check memo covers regular require deps", () => {
  it("misses when require target refine changes (parent source unchanged)", () => {
    let dep = `
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
module.exports = { needsPositive };
`;
    const loadModule = (spec: string) => {
      if (spec.includes("std.nudo")) return STD_NUDO_SRC;
      return dep;
    };
    const opts = { loadModule, fromFile: "/t/a.js" };
    const src = `
const { needsPositive } = require("./v.js");
needsPositive(-1);
`;
    const r1 = checkSource("/t/a.js", src, pTrue, opts);
    expect(r1.ok).toBe(false);
    expect(r1.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);

    dep = `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
module.exports = { needsPositive };
`;
    const r2 = checkSource("/t/a.js", src, pTrue, opts);
    expect(r2.ok).toBe(true);
  });
});
