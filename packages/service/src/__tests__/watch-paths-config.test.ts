/**
 * LSP/CLI 共用 watch 门禁：package.json / 正式侧车必须命中；draft 不命中。
 */
import { describe, it, expect } from "vitest";
import { isSidecarPath, isProjectConfigPath, isWatchRelevantPath } from "../watch-paths.ts";

describe("watch-path gates for LSP invalidation", () => {
  it("formal sidecar hits; draft does not", () => {
    expect(isSidecarPath("/p/a.nudo.js")).toBe(true);
    expect(isSidecarPath("/p/a.nudo.draft.js")).toBe(false);
  });

  it("package.json / nudo config hit project-config gate", () => {
    expect(isProjectConfigPath("/p/package.json")).toBe(true);
    expect(isProjectConfigPath("/p/nudo.json")).toBe(true);
    expect(isProjectConfigPath("/p/src/a.js")).toBe(false);
  });

  it("isWatchRelevantPath covers targets + sidecar + config", () => {
    expect(isWatchRelevantPath("/p/src/a.js")).toBe(true);
    expect(isWatchRelevantPath("/p/a.nudo.ts")).toBe(true);
    expect(isWatchRelevantPath("/p/package.json")).toBe(true);
  });
});
