import { describe, it, expect } from "vitest";
import { handleNudoDepFileChanged, analysisCache, clearValidationState } from "../validation.ts";

describe("LSP project-config invalidation", () => {
  it("package.json change clears analysisCache and notifies host", async () => {
    clearValidationState();
    let configChanged = 0;
    const deps = {
      sendDiagnostics: () => {},
      isNudoUri: () => true,
      getActiveCases: () => new Map(),
      getOpenDocumentByPath: () => undefined,
      listOpenDocuments: () => [],
      onProjectConfigChanged: () => {
        configChanged++;
      },
    };
    analysisCache.set("/tmp/proj/a.js", {
      version: 1,
      result: { functions: [], diagnostics: [], bindings: new Map(), nodeAbsMap: new Map() } as never,
      sourceHash: "abc",
      cfgHash: "old",
    });
    await handleNudoDepFileChanged("/tmp/proj/package.json", deps);
    expect(configChanged).toBe(1);
    expect(analysisCache.has("/tmp/proj/a.js")).toBe(false);
  });
});
