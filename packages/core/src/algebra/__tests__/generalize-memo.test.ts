import { describe, it, expect, beforeEach } from "vitest";
import {
  generalizeFromAst,
  resetGeneralizeMemo,
  formatAbs,
  checkSource,
  pTrue,
} from "../index.ts";

const SRC = `
function add(a, b) {
  return a + b;
}
`;

beforeEach(() => {
  resetGeneralizeMemo();
});

describe("generalizeFromAst L0 memo", () => {
  it("returns the same PolyFn instance for identical (source, name) queries", () => {
    const a = generalizeFromAst("add", SRC);
    const b = generalizeFromAst("add", SRC);
    expect(a).toBeDefined();
    expect(b).toBe(a);
  });

  it("misses when source content changes", () => {
    const a = generalizeFromAst("add", SRC);
    const b = generalizeFromAst("add", SRC + "\n// touch\n");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(b).not.toBe(a);
  });

  it("misses for a different function name", () => {
    const src = `
function add(a, b) { return a + b; }
function sub(a, b) { return a - b; }
`;
    const a = generalizeFromAst("add", src);
    const b = generalizeFromAst("sub", src);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(b).not.toBe(a);
  });

  it("caches undefined for missing functions", () => {
    expect(generalizeFromAst("nope", SRC)).toBeUndefined();
    expect(generalizeFromAst("nope", SRC)).toBeUndefined();
  });

  it("misses when label changes", () => {
    const a = generalizeFromAst("add", SRC, { label: "A" });
    const b = generalizeFromAst("add", SRC, { label: "B" });
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(b).not.toBe(a);
  });

  it("misses when refine loadModule identity changes", () => {
    const load1 = () => undefined;
    const load2 = () => undefined;
    const a = generalizeFromAst("add", SRC, { refine: { loadModule: load1, fromFile: "/t.js" } });
    const b = generalizeFromAst("add", SRC, { refine: { loadModule: load2, fromFile: "/t.js" } });
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(b).not.toBe(a);
  });

  it("hit is consistent with checkSource signatures", () => {
    const g1 = generalizeFromAst("add", SRC);
    const g2 = generalizeFromAst("add", SRC);
    expect(formatAbs(g1!.symbolic)).toBe(formatAbs(g2!.symbolic));
    const report = checkSource("t.js", SRC, pTrue, {});
    expect(report.signatures.map((s) => s.name)).toContain("add");
  });
});
