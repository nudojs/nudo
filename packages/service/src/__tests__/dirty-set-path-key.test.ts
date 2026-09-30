import { describe, it, expect } from "vitest";
import { computeDirtySet, topoSortDirty, stablePathKey, stablePathKeyGraph } from "../analyzer.ts";

/**
 * FIX-RESIDUAL-3 项 2：CLI/watch 对 buildModuleGraph 边（fs 原生形态）做
 * computeDirtySet 时必须走 stablePathKey 归一——同一 Windows 文件的
 * `c:\a.js` 边与 `c:/a.js` 查询跨形态命中，否则脏传播漏边。
 * 测试在 POSIX 上跑；stablePathKey 自身统一盘符形态，无需真 Windows。
 */
describe("computeDirtySet cross-form dirty propagation (FIX-RESIDUAL-3 item 2)", () => {
  it("normalizes fs-native edge keys so cacheKey-form queries hit", () => {
    // buildModuleGraph 的 `to` 边是 resolveModuleFile 的 fs 原生形态（c:\...），
    // 查询可能是 knownFiles 的 cacheKey 形态（c:/...）。
    const raw = new Map<string, Set<string>>([
      ["c:\\proj\\dep.js", new Set(["c:/proj/parent.js"])],
    ]);
    const dirty = computeDirtySet(raw, stablePathKey("file:///c:/proj/dep.js"));
    expect(new Set(dirty)).toEqual(new Set(["c:/proj/dep.js", "c:/proj/parent.js"]));
  });

  it("hits when the changed file is passed in a different form than the edge key", () => {
    const raw = new Map<string, Set<string>>([
      ["c:\\proj\\dep.js", new Set(["c:/proj/parent.js"])],
    ]);
    // 同一查询以 /c:/ 形态给出（uriToFilePath 形态）
    const dirty = computeDirtySet(raw, stablePathKey("/c:/proj/dep.js"));
    expect(new Set(dirty)).toEqual(new Set(["c:/proj/dep.js", "c:/proj/parent.js"]));
  });

  it("hits when the changed file is C:\\ form and the edge key is c:/ form", () => {
    const raw = new Map<string, Set<string>>([
      ["c:/proj/dep.js", new Set(["c:\\proj\\parent.js"])],
    ]);
    const dirty = computeDirtySet(raw, "C:\\proj\\dep.js");
    expect(new Set(dirty)).toEqual(new Set(["c:/proj/dep.js", "c:/proj/parent.js"]));
  });

  it("is a no-op on clean POSIX absolute paths (stablePathKey is identity)", () => {
    const raw = new Map<string, Set<string>>([["/test/dep.js", new Set(["/test/parent.js"])]]);
    const dirty = computeDirtySet(raw, "/test/dep.js");
    expect(dirty).toEqual(["/test/dep.js", "/test/parent.js"]);
  });

  it("returns stablePathKey-form nodes (seed + dependents)", () => {
    const raw = new Map<string, Set<string>>([
      ["c:\\proj\\dep.js", new Set(["file:///c:/proj/parent.js"])],
    ]);
    const seed = stablePathKey("/c:/proj/dep.js");
    const dirty = computeDirtySet(raw, seed);
    expect(seed).toBe("c:/proj/dep.js");
    for (const d of dirty) expect(d).toBe(stablePathKey(d));
    expect(dirty).toContain("c:/proj/parent.js");
  });

  it("merges duplicate keys that only differ by path form", () => {
    const raw = new Map<string, Set<string>>([
      ["c:/proj/dep.js", new Set(["c:/proj/a.js"])],
      ["c:\\proj\\dep.js", new Set(["c:/proj/b.js"])],
    ]);
    const g = stablePathKeyGraph(raw);
    expect(g.size).toBe(1);
    const dirty = computeDirtySet(raw, "c:/proj/dep.js");
    expect(new Set(dirty)).toEqual(new Set(["c:/proj/dep.js", "c:/proj/a.js", "c:/proj/b.js"]));
  });
});

describe("topoSortDirty cross-form ordering (FIX-RESIDUAL-3 item 2)", () => {
  it("orders dependencies-first across mixed path forms", () => {
    const imports = new Map<string, Set<string>>([
      ["c:\\proj\\parent.js", new Set(["c:/proj/dep.js"])],
      ["c:/proj/dep.js", new Set<string>()],
    ]);
    const dirty = ["c:/proj/parent.js", "c:/proj/dep.js"];
    const ordered = topoSortDirty(imports, dirty);
    expect(ordered.indexOf("c:/proj/dep.js")).toBeLessThan(ordered.indexOf("c:/proj/parent.js"));
  });

  it("keeps the caller's dirty spelling in the output", () => {
    const imports = new Map<string, Set<string>>([
      ["c:\\proj\\parent.js", new Set(["c:\\proj\\dep.js"])],
      ["c:\\proj\\dep.js", new Set<string>()],
    ]);
    const dirty = ["c:\\proj\\parent.js", "c:\\proj\\dep.js"];
    const ordered = topoSortDirty(imports, dirty);
    expect(ordered).toEqual(["c:\\proj\\dep.js", "c:\\proj\\parent.js"]);
  });
});
