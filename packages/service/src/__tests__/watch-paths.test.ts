import { describe, it, expect } from "vitest";
import {
  isSidecarPath,
  isProjectConfigPath,
  isWatchRelevantPath,
  ambientSourcesOfSidecar,
} from "../watch-paths.ts";
import { isNudoTargetPath } from "../target-path.ts";

describe("watch path gates", () => {
  it("accepts analysis targets", () => {
    expect(isWatchRelevantPath("/a/lib.js")).toBe(true);
    expect(isWatchRelevantPath("/a/lib.ts")).toBe(true);
    expect(isWatchRelevantPath("/a/lib.mjs")).toBe(true);
  });

  it("accepts formal sidecars but not drafts or typed non-targets", () => {
    expect(isSidecarPath("/a/lib.nudo.js")).toBe(true);
    expect(isSidecarPath("/a/lib.nudo.ts")).toBe(true);
    expect(isSidecarPath("/a/lib.nudo.mjs")).toBe(true);
    expect(isSidecarPath("/a/lib.nudo.draft.js")).toBe(false);
    expect(isSidecarPath("/a/lib.d.ts")).toBe(false);
    expect(isNudoTargetPath("/a/lib.nudo.js")).toBe(false);
    expect(isWatchRelevantPath("/a/lib.nudo.js")).toBe(true);
    expect(isWatchRelevantPath("/a/lib.nudo.draft.js")).toBe(false);
  });

  it("accepts project config basenames", () => {
    expect(isProjectConfigPath("/a/package.json")).toBe(true);
    expect(isProjectConfigPath("/a/nudo.json")).toBe(true);
    expect(isProjectConfigPath("/a/nudo.config.ts")).toBe(true);
    expect(isProjectConfigPath("/a/.nudorc")).toBe(true);
    expect(isProjectConfigPath("/a/other.json")).toBe(false);
    expect(isWatchRelevantPath("/a/package.json")).toBe(true);
  });

  it("maps ambient sidecar back to candidate sources", () => {
    expect(ambientSourcesOfSidecar("/a/lib.nudo.js")).toEqual(["/a/lib.js", "/a/lib.mjs"]);
    expect(ambientSourcesOfSidecar("/a/lib.nudo.ts")).toEqual(["/a/lib.ts", "/a/lib.mts"]);
    expect(ambientSourcesOfSidecar("/a/lib.nudo.draft.js")).toEqual([]);
  });

  it("maps .nudo.mjs sidecar back to candidate sources (BUG-011 watch invalidation)", () => {
    // watch 增量：isSidecarPath 接受 lib.nudo.mjs → runIncremental 用
    // ambientSourcesOfSidecar 反查 ambient 源；漏配则 lib.js/lib.mjs 永不脏
    expect(isSidecarPath("/a/lib.nudo.mjs")).toBe(true);
    expect(ambientSourcesOfSidecar("/a/lib.nudo.mjs")).toEqual(["/a/lib.js", "/a/lib.mjs"]);
    expect(ambientSourcesOfSidecar("/a/lib.nudo.draft.mjs")).toEqual([]);
  });

  it("every suffix accepted by isSidecarPath yields ambient sources; others agree on []", () => {
    for (const s of ["lib.nudo.js", "lib.nudo.mjs", "lib.nudo.ts"] as const) {
      expect(isSidecarPath(`/a/${s}`)).toBe(true);
      expect(ambientSourcesOfSidecar(`/a/${s}`).length).toBeGreaterThan(0);
    }
    // 约定外后缀两谓词一致拒绝（.nudo.mts 不是正式侧车）
    expect(isSidecarPath("/a/lib.nudo.mts")).toBe(false);
    expect(ambientSourcesOfSidecar("/a/lib.nudo.mts")).toEqual([]);
  });
});
