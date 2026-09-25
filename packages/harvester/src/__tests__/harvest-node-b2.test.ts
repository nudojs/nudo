/**
 * B2：@types/node harvest 磁盘缓存 + harvest 失败降级手写 env。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  harvestNodeTypes,
  clearNodeHarvestCache,
  handwrittenNodeEnv,
  getNodeHarvestCacheSize,
} from "../harvest-node.ts";
import { depsCacheRoot } from "../harvest-disk.ts";

describe("B2 harvest node disk + degrade", () => {
  let cacheDir: string;
  let prevCache: string | undefined;

  beforeEach(() => {
    clearNodeHarvestCache();
    cacheDir = mkdtempSync(join(tmpdir(), "nudo-b2-cache-"));
    prevCache = process.env.NUDO_DEPS_CACHE_DIR;
    process.env.NUDO_DEPS_CACHE_DIR = cacheDir;
  });

  afterEach(() => {
    clearNodeHarvestCache();
    if (prevCache === undefined) delete process.env.NUDO_DEPS_CACHE_DIR;
    else process.env.NUDO_DEPS_CACHE_DIR = prevCache;
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("handwrittenNodeEnv provides node face (degrade source)", () => {
    const env = handwrittenNodeEnv();
    expect(env).not.toBeNull();
    expect(Object.keys(env!.modules).length + Object.keys(env!.globals).length).toBeGreaterThan(0);
  });

  it("missing @types/node degrades to handwritten env", () => {
    const missDir = mkdtempSync(join(tmpdir(), "nudo-b2-miss-"));
    try {
      const r = harvestNodeTypes(missDir);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.degraded).toBe(true);
        expect(r.root).toBe("@nudojs/env");
      }
    } finally {
      rmSync(missDir, { recursive: true, force: true });
    }
  });

  it("success path writes disk cache and second call hits cached", () => {
    // monorepo root has @types/node via workspace
    const monorepoRoot = process.cwd();
    const r1 = harvestNodeTypes(monorepoRoot);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.degraded).toBeFalsy();

    // disk layer should have written under cacheDir
    const hasDisk = existsSync(cacheDir);
    expect(hasDisk).toBe(true);

    clearNodeHarvestCache();
    expect(getNodeHarvestCacheSize()).toBe(0);
    const r2 = harvestNodeTypes(monorepoRoot);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.cached).toBe(true);
      // disk hit is harvest content, not handwritten degrade
      expect(r2.degraded).toBeFalsy();
    }
  });

  it("depsCacheRoot honors NUDO_DEPS_CACHE_DIR", () => {
    expect(depsCacheRoot()).toBe(cacheDir);
    process.env.NUDO_DEPS_CACHE_DIR = "off";
    expect(depsCacheRoot()).toBeUndefined();
    process.env.NUDO_DEPS_CACHE_DIR = cacheDir;
  });

  it("empty dts tree degrades to handwritten", () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), "nudo-b2-nodts-"));
    try {
      // resolvePackageRoot needs a package.json-shaped root with no .d.ts
      mkdirSync(join(fakeRoot, "node_modules", "@types", "node"), { recursive: true });
      writeFileSync(
        join(fakeRoot, "node_modules", "@types", "node", "package.json"),
        JSON.stringify({ name: "@types/node", version: "0.0.0" }),
      );
      // no .d.ts files
      const r = harvestNodeTypes(fakeRoot);
      // either not-found (resolve failed) or no-dts — both must degrade
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.degraded).toBe(true);
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });
});
