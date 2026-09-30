import { describe, it, expect, beforeEach } from "vitest";
import {
  analysisCache,
  cacheKey,
  clearValidationState,
  forgetValidatedFile,
  getCachedOrAnalyze,
  handleNudoDepFileChanged,
  knownFiles,
  nudoDepParents,
  registerNudoImportDeps,
  uriToFilePath,
  validateText,
  type ValidateTextDeps,
} from "../validation.ts";

/**
 * R2-2: analysisCache / knownFiles / nudoDepParents keys must be identical for
 * every path shape of the same file — especially Windows `file:///c:/...` URIs
 * (`/c:/x`) vs fs-resolved drive paths (`c:\x` / `c:/x`). These tests run on
 * POSIX; cacheKey unifies the drive form itself so no real Windows is needed.
 */
describe("cacheKey (R2-2 path-key unification)", () => {
  it("unifies all Windows drive forms of the same file", () => {
    const expected = "c:/proj/a.js";
    expect(cacheKey("file:///c:/proj/a.js")).toBe(expected);
    expect(cacheKey("/c:/proj/a.js")).toBe(expected);
    expect(cacheKey("c:/proj/a.js")).toBe(expected);
    expect(cacheKey("c:\\proj\\a.js")).toBe(expected);
  });

  it("unifies URI and raw-path forms for POSIX paths", () => {
    expect(cacheKey("file:///test/a.js")).toBe(cacheKey("/test/a.js"));
    expect(cacheKey("/test/a.js")).toBe("/test/a.js");
  });

  it("percent-decodes file URIs before unifying", () => {
    expect(cacheKey("file:///c:/my%20dir/a.js")).toBe("c:/my dir/a.js");
  });

  it("is idempotent", () => {
    for (const p of [
      "file:///c:/proj/a.js",
      "/c:/proj/a.js",
      "c:\\proj\\a.js",
      "/test/a.js",
      "file:///test/a.js",
    ]) {
      const k = cacheKey(p);
      expect(cacheKey(k)).toBe(k);
    }
  });

  it("keeps distinct files distinct", () => {
    expect(cacheKey("file:///c:/proj/a.js")).not.toBe(cacheKey("file:///c:/proj/b.js"));
    expect(cacheKey("file:///c:/proj/a.js")).not.toBe(cacheKey("file:///d:/proj/a.js"));
  });
});

describe("session maps keyed by cacheKey (R2-2 forget/evict)", () => {
  beforeEach(() => {
    clearValidationState();
  });

  it("forgetValidatedFile with URI form evicts an entry stored under the path form", async () => {
    const src = '// @nudo:case "n" (1)\nfunction f(x) { return x; }\n';
    // write under the raw uriToFilePath shape (`/c:/...`)
    await validateText("/c:/proj/gone.js", "file:///c:/proj/gone.js", src, 1, {
      sendDiagnostics: () => {},
    });
    const key = cacheKey("/c:/proj/gone.js");
    expect(knownFiles.has(key)).toBe(true);
    expect(analysisCache.has(key)).toBe(true);

    // delete via the URI form — pre-fix this missed because keys differed
    forgetValidatedFile("file:///c:/proj/gone.js");

    expect(knownFiles.has(key)).toBe(false);
    expect(analysisCache.has(key)).toBe(false);
    expect(knownFiles.size).toBe(0);
    expect(analysisCache.size).toBe(0);
  });

  it("forgetValidatedFile with a drive-slash path evicts a URI-written entry", async () => {
    const src = '// @nudo:case "n" (1)\nfunction f(x) { return x; }\n';
    await validateText("/c:/proj/gone.js", "file:///c:/proj/gone.js", src, 1, {
      sendDiagnostics: () => {},
    });

    forgetValidatedFile("c:\\proj\\gone.js");

    expect(knownFiles.has(cacheKey("/c:/proj/gone.js"))).toBe(false);
    expect(analysisCache.has(cacheKey("/c:/proj/gone.js"))).toBe(false);
  });

  it("getCachedOrAnalyze hits the same entry across path shapes", () => {
    const src = '// @nudo:case "n" (1)\nfunction f(x) { return x; }\n';
    const a = getCachedOrAnalyze("/c:/proj/a.js", src, 1);
    const b = getCachedOrAnalyze("c:/proj/a.js", src, 1);
    const c = getCachedOrAnalyze("file:///c:/proj/a.js", src, 1);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(analysisCache.size).toBe(1);
  });

  it("registerNudoImportDeps stores nudoDepParents under cacheKey; lookups across forms hit", () => {
    registerNudoImportDeps(
      "/c:/proj/a.js",
      '/// @nudo:import { positive } from "./shapes.nudo.js"\nfunction f(x){return x;}\n',
    );
    expect(nudoDepParents.get("c:/proj/shapes.nudo.js")).toContain("c:/proj/a.js");
    // URI form of the dep also hits
    expect(nudoDepParents.get(cacheKey("file:///c:/proj/shapes.nudo.js"))).toContain(
      "c:/proj/a.js",
    );
  });

  it("handleNudoDepFileChanged finds the open parent across path shapes", async () => {
    const parentSrc =
      '/// @nudo:import { positive } from "./shapes.nudo.js"\nfunction needsPositive(x) { return x; }\n';
    // production passes uriToFilePath forms (paths, not URIs) into registerNudoImportDeps
    registerNudoImportDeps("/c:/proj/a.js", parentSrc);

    let revalidated = 0;
    const openDocs = new Map([
      [
        cacheKey("file:///c:/proj/a.js"),
        {
          uri: "file:///c:/proj/a.js",
          version: 2,
          getText: () => parentSrc,
        },
      ],
    ]);
    const deps: ValidateTextDeps = {
      sendDiagnostics: () => {},
      getOpenDocumentByPath: (p) => {
        const hit = openDocs.get(cacheKey(p));
        if (hit) revalidated++;
        return hit;
      },
    };

    // dep change delivered as a drive-slash path — must still find the URI-shaped open doc
    await handleNudoDepFileChanged("c:\\proj\\shapes.nudo.js", deps);
    expect(revalidated).toBeGreaterThan(0);
  });

  it("POSIX paths behave as before (cacheKey is identity for clean absolute paths)", async () => {
    const src = '// @nudo:case "n" (1)\nfunction f(x) { return x; }\n';
    await validateText("/test/a.js", "file:///test/a.js", src, 1, {
      sendDiagnostics: () => {},
    });
    expect(knownFiles.has("/test/a.js")).toBe(true);
    expect(analysisCache.get("/test/a.js")?.version).toBe(1);
    forgetValidatedFile("/test/a.js");
    expect(knownFiles.has("/test/a.js")).toBe(false);
    expect(analysisCache.has("/test/a.js")).toBe(false);
  });
});
