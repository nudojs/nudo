import { describe, it, expect, beforeEach } from "vitest";
import {
  checkSource,
  resetCheckSourceMemo,
  evictCheckSourceMemoForPaths,
  resetGeneralizeMemo,
  pTrue,
} from "../index.ts";
import { STD_NUDO_SRC, withStdImport } from "./nudo-constraints.ts";

const SRC = `
function add(a, b) {
  return a + b;
}
function needsPositive(x) {
  /** @nudo:contract x positive */
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
    expect(b.ok).toBe(a.ok);
    expect(b.signatures.map((s) => s.name)).toEqual(a.signatures.map((s) => s.name));
    expect(b.issues.map((i) => i.code)).toEqual(a.issues.map((i) => i.code));
    expect(b.summary).toEqual(a.summary);
  });

  it("evictCheckSourceMemoForPaths drops dependents of that dep", () => {
    const loadModule = () => "export const positive = number().gt(0);\n";
    const opts = { loadModule, fromFile: "/t/a.js" };
    const src = `
/// @nudo:import { positive } from "./shapes.nudo.js"
function needsPositive(x) {
  /** @nudo:contract x positive */
  return x + 1;
}
`;
    checkSource("/t/a.js", src, pTrue, opts);
    checkSource("/t/b.js", SRC, pTrue, {});
    const n = evictCheckSourceMemoForPaths(["/t/shapes.nudo.js"]);
    expect(n).toBeGreaterThan(0);
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

  it("reports constraint violation for const-assigned literal call", () => {
    const loadModule = (spec: string) =>
      spec.includes("std") ? STD_NUDO_SRC : undefined;
    const src = `${withStdImport(`
/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const bad = needsPositive(-1);
`)}`;
    const r = checkSource("/t/scan.js", src, pTrue, { loadModule, fromFile: "/t/scan.js" });
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("reports constraint violation for if-condition literal call", () => {
    const loadModule = (spec: string) =>
      spec.includes("std") ? STD_NUDO_SRC : undefined;
    const src = `${withStdImport(`
/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
if (needsPositive(-1)) {}
`)}`;
    const r = checkSource("/t/scan-if.js", src, pTrue, { loadModule, fromFile: "/t/scan-if.js" });
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });
});
