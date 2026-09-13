import { describe, it, expect, beforeEach } from "vitest";
import {
  checkSource,
  resetCheckSourceMemo,
  getCheckSourceMemoSize,
  evictCheckSourceMemoForPaths,
  resetGeneralizeMemo,
  pTrue,
} from "../index.ts";

const SRC = `
function add(a, b) {
  return a + b;
}
function needsPositive(x) {
  /** @nudo:refine x positive */
  return x + 1;
}
`;

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
});

describe("checkSource whole-file memo", () => {
  it("hit returns equivalent report for same source", () => {
    const a = checkSource("/t/a.js", SRC, pTrue, {});
    const b = checkSource("/t/a.js", SRC, pTrue, {});
    expect(getCheckSourceMemoSize()).toBe(1);
    expect(b.ok).toBe(a.ok);
    expect(b.signatures.map((s) => s.name)).toEqual(a.signatures.map((s) => s.name));
    expect(b.issues.map((i) => i.code)).toEqual(a.issues.map((i) => i.code));
    expect(b.summary).toEqual(a.summary);
  });

  it("hits when only trailing non-nudo comments change", () => {
    checkSource("/t/a.js", SRC, pTrue, {});
    checkSource("/t/a.js", SRC + "\n// touch\n", pTrue, {});
    expect(getCheckSourceMemoSize()).toBe(1);
  });

  it("misses when source body changes", () => {
    checkSource("/t/a.js", SRC, pTrue, {});
    checkSource("/t/a.js", SRC + "\nconst zzz = 1;\n", pTrue, {});
    expect(getCheckSourceMemoSize()).toBe(2);
  });

  it("misses when filePath changes", () => {
    checkSource("/t/a.js", SRC, pTrue, {});
    checkSource("/t/b.js", SRC, pTrue, {});
    expect(getCheckSourceMemoSize()).toBe(2);
  });

  it("misses when loadModule identity changes", () => {
    const l1 = () => undefined;
    const l2 = () => undefined;
    checkSource("/t/a.js", SRC, pTrue, { loadModule: l1, fromFile: "/t/a.js" });
    checkSource("/t/a.js", SRC, pTrue, { loadModule: l2, fromFile: "/t/a.js" });
    expect(getCheckSourceMemoSize()).toBe(2);
  });

  it("misses when dep content changes", () => {
    let dep = "export const positive = number().gt(0);\n";
    const loadModule = () => dep;
    const opts = { loadModule, fromFile: "/t/a.js" };
    const src = `
/// @nudo:import { positive } from "./shapes.nudo.js"
function needsPositive(x) {
  /** @nudo:refine x positive */
  return x + 1;
}
`;
    checkSource("/t/a.js", src, pTrue, opts);
    dep = "export const positive = number().ge(0);\n";
    checkSource("/t/a.js", src, pTrue, opts);
    expect(getCheckSourceMemoSize()).toBe(2);
  });

  it("evictCheckSourceMemoForPaths drops dependents of that dep", () => {
    const loadModule = () => "export const positive = number().gt(0);\n";
    const opts = { loadModule, fromFile: "/t/a.js" };
    const src = `
/// @nudo:import { positive } from "./shapes.nudo.js"
function needsPositive(x) {
  /** @nudo:refine x positive */
  return x + 1;
}
`;
    checkSource("/t/a.js", src, pTrue, opts);
    checkSource("/t/b.js", SRC, pTrue, {});
    const before = getCheckSourceMemoSize();
    const n = evictCheckSourceMemoForPaths(["/t/shapes.nudo.js"]);
    expect(n).toBeGreaterThan(0);
    expect(getCheckSourceMemoSize()).toBeLessThan(before);
    // 无关文件仍在
    expect(getCheckSourceMemoSize()).toBe(1);
  });

  it("reset drops all entries", () => {
    checkSource("/t/a.js", SRC, pTrue, {});
    expect(getCheckSourceMemoSize()).toBeGreaterThan(0);
    resetCheckSourceMemo();
    expect(getCheckSourceMemoSize()).toBe(0);
  });

  it("mutating returned issues does not corrupt cache", () => {
    const a = checkSource("/t/a.js", SRC, pTrue, {});
    a.issues.push({
      severity: "error",
      code: "x",
      message: "mutated",
    });
    a.signatures.length = 0;
    const b = checkSource("/t/a.js", SRC, pTrue, {});
    expect(b.issues.some((i) => i.message === "mutated")).toBe(false);
    expect(b.signatures.length).toBeGreaterThan(0);
  });
});
