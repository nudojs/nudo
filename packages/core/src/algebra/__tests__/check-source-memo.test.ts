import { describe, it, expect, beforeEach } from "vitest";
import {
  checkSource,
  resetCheckSourceMemo,
  getCheckSourceMemoSize,
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

  it("same loadModule identity hits memo (wrapper must not defeat key)", () => {
    const loadModule = () => undefined;
    const opts = { loadModule, fromFile: "/t/a.js" };
    checkSource("/t/a.js", SRC, pTrue, opts);
    const size1 = getCheckSourceMemoSize();
    checkSource("/t/a.js", SRC, pTrue, opts);
    checkSource("/t/a.js", SRC, pTrue, opts);
    expect(size1).toBe(1);
    expect(getCheckSourceMemoSize()).toBe(1);
  });

  it("hits when only trailing non-nudo comments change even with loadModule", () => {
    const loadModule = () => undefined;
    const opts = { loadModule, fromFile: "/t/a.js" };
    checkSource("/t/a.js", SRC, pTrue, opts);
    checkSource("/t/a.js", SRC + "\n// touch\n", pTrue, opts);
    expect(getCheckSourceMemoSize()).toBe(1);
  });

  it("reports constraint violation for const-assigned literal call", () => {
    const loadModule = (spec: string) =>
      spec.includes("std") ? STD_NUDO_SRC : undefined;
    const src = `${withStdImport(`
/**
 * @nudo:refine x positive
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
 * @nudo:refine x positive
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

  it("fingerprints transitive require deps (grandchild change misses)", () => {
    const files: Record<string, string> = {
      "/t/w.js": "module.exports = { n: 1 };\n",
      "/t/v.js": 'const w = require("./w.js");\nmodule.exports = { fromW: w.n };\n',
    };
    const loadModule = (spec: string, fromFile: string) => {
      if (spec === "./w.js") return files["/t/w.js"];
      if (spec === "./v.js") return files["/t/v.js"];
      if (spec === "./w.js" && fromFile.endsWith("v.js")) return files["/t/w.js"];
      return undefined;
    };
    // resolve relative to the dep file when nested
    const load = (spec: string, fromFile: string) => {
      if (fromFile === "/t/a.js" && spec === "./v.js") return files["/t/v.js"];
      if (fromFile === "/t/v.js" && spec === "./w.js") return files["/t/w.js"];
      return loadModule(spec, fromFile);
    };
    const opts = { loadModule: load, fromFile: "/t/a.js" };
    const src = `
const v = require("./v.js");
function id(x) { return x; }
id(v.fromW);
`;
    checkSource("/t/a.js", src, pTrue, opts);
    expect(getCheckSourceMemoSize()).toBe(1);
    // grandchild content change, parent + child sources unchanged
    files["/t/w.js"] = "module.exports = { n: 2 };\n";
    checkSource("/t/a.js", src, pTrue, opts);
    expect(getCheckSourceMemoSize()).toBe(2);
  });
});
