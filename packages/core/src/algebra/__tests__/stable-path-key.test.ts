import { describe, it, expect, beforeEach } from "vitest";
import {
  checkSource,
  evictCheckSourceMemoForPaths,
  evictGeneralizeMemoForPaths,
  generalizeFromAst,
  getGeneralizeMemoSize,
  pTrue,
  resetCheckSourceMemo,
  resetGeneralizeMemo,
} from "../index.ts";
import { stablePathKey, stablePathKeyGraph } from "../sidecar-path.ts";

/**
 * FIX-RESIDUAL-3 项 1：core L0 memo 逐出键与 LSP cacheKey 对齐。
 * 同一 Windows 文件的 uri / 盘符形态（`file:///c:/x`、`/c:/x`、`c:\x`、
 * `c:/x`、`C:/x`）必须互相命中，否则 Windows 上定向逐出 miss。
 * 测试在 POSIX 上跑；stablePathKey 自身统一盘符形态，无需真 Windows。
 */
const DRIVE_FORMS = [
  "c:/proj/shapes.nudo.js",
  "c:\\proj\\shapes.nudo.js",
  "/c:/proj/shapes.nudo.js",
  "file:///c:/proj/shapes.nudo.js",
  "C:/proj/shapes.nudo.js",
];

describe("stablePathKey (Windows drive-form unification)", () => {
  it("collapses all drive forms to c:/…", () => {
    for (const form of DRIVE_FORMS) {
      expect(stablePathKey(form), form).toBe("c:/proj/shapes.nudo.js");
    }
  });

  it("is identity on clean POSIX absolute paths", () => {
    expect(stablePathKey("/test/a.js")).toBe("/test/a.js");
  });

  it("is idempotent", () => {
    for (const form of DRIVE_FORMS) {
      const k = stablePathKey(form);
      expect(stablePathKey(k)).toBe(k);
    }
    expect(stablePathKey(stablePathKey("/test/a.js"))).toBe("/test/a.js");
  });

  it("decodes percent-escapes in file:// URIs", () => {
    expect(stablePathKey("file:///c:/my%20dir/a.js")).toBe("c:/my dir/a.js");
  });

  it("keeps distinct files distinct", () => {
    expect(stablePathKey("file:///c:/proj/a.js")).not.toBe(stablePathKey("file:///c:/proj/b.js"));
    expect(stablePathKey("file:///c:/proj/a.js")).not.toBe(stablePathKey("file:///d:/proj/a.js"));
  });

  it("stablePathKeyGraph merges keys that only differ by path form", () => {
    const raw = new Map<string, Set<string>>([
      ["c:/proj/dep.js", new Set(["c:/proj/a.js"])],
      ["c:\\proj\\dep.js", new Set(["c:/proj/b.js"])],
    ]);
    const g = stablePathKeyGraph(raw);
    expect(g.size).toBe(1);
    expect(g.get("c:/proj/dep.js")).toEqual(new Set(["c:/proj/a.js", "c:/proj/b.js"]));
  });
});

describe("L0 memo eviction hits across path forms (FIX-RESIDUAL-3 item 1)", () => {
  const SRC_REFINE = `
/// @nudo:import { positive } from "./shapes.nudo.js"
function needsPositive(x) {
  /** @nudo:contract x positive */
  return x + 1;
}
`;
  const loadModule = () => "export const positive = number().gt(0);\n";

  beforeEach(() => {
    resetGeneralizeMemo();
    resetCheckSourceMemo();
  });

  it("evictGeneralizeMemoForPaths hits when indexed under c:\\ form and evicted under any drive form", () => {
    for (const form of DRIVE_FORMS) {
      resetGeneralizeMemo();
      const refine = { loadModule, fromFile: "c:\\proj\\a.js" };
      const g = generalizeFromAst("needsPositive", SRC_REFINE, { refine });
      expect(g, form).toBeDefined();
      expect(getGeneralizeMemoSize(), form).toBeGreaterThan(0);
      const n = evictGeneralizeMemoForPaths([form]);
      expect(n, form).toBeGreaterThan(0);
      const g2 = generalizeFromAst("needsPositive", SRC_REFINE, { refine });
      expect(g2, form).not.toBe(g);
    }
  });

  it("evictGeneralizeMemoForPaths hits when fromFile is /c:/ form and evict is c:/ form", () => {
    const refine = { loadModule, fromFile: "/c:/proj/a.js" };
    const g1 = generalizeFromAst("needsPositive", SRC_REFINE, { refine });
    expect(g1).toBeDefined();
    expect(evictGeneralizeMemoForPaths(["c:/proj/shapes.nudo.js"])).toBeGreaterThan(0);
    const g2 = generalizeFromAst("needsPositive", SRC_REFINE, { refine });
    expect(g2).not.toBe(g1);
  });

  it("evictGeneralizeMemoForPaths hits when fromFile is file:// form and evict is c:\\ form", () => {
    const refine = { loadModule, fromFile: "file:///c:/proj/a.js" };
    const g1 = generalizeFromAst("needsPositive", SRC_REFINE, { refine });
    expect(g1).toBeDefined();
    expect(evictGeneralizeMemoForPaths(["c:\\proj\\shapes.nudo.js"])).toBeGreaterThan(0);
    const g2 = generalizeFromAst("needsPositive", SRC_REFINE, { refine });
    expect(g2).not.toBe(g1);
  });

  it("evictCheckSourceMemoForPaths hits across drive forms", () => {
    for (const form of DRIVE_FORMS) {
      resetCheckSourceMemo();
      const opts = { loadModule, fromFile: "c:\\proj\\a.js" };
      checkSource("c:\\proj\\a.js", SRC_REFINE, pTrue, opts);
      expect(evictCheckSourceMemoForPaths([form]), form).toBeGreaterThan(0);
    }
  });

  it("evictCheckSourceMemoForPaths hits when fromFile is /c:/ and evict is c:/", () => {
    const opts = { loadModule, fromFile: "/c:/proj/a.js" };
    checkSource("/c:/proj/a.js", SRC_REFINE, pTrue, opts);
    expect(evictCheckSourceMemoForPaths(["c:/proj/shapes.nudo.js"])).toBeGreaterThan(0);
  });

  it("evict is a no-op for unknown paths (no false positives)", () => {
    resetGeneralizeMemo();
    generalizeFromAst("add", "function add(a,b){return a+b;}");
    expect(evictGeneralizeMemoForPaths(["/nope/missing.nudo.js"])).toBe(0);
    expect(getGeneralizeMemoSize()).toBeGreaterThan(0);
  });
});
