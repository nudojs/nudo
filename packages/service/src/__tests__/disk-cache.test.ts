import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DiskCache,
  checkCacheKey,
  sha256Hex,
  relativizePath,
  ANALYSIS_ABI,
} from "../disk-cache.ts";
import { diskCacheRoot, analysisConfig } from "../evaluator/config.ts";

describe("B3 disk cache store", () => {
  it("round-trips JSON values when enabled", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cache-"));
    try {
      const c = new DiskCache({ root, namespace: "check" });
      expect(c.enabled).toBe(true);
      const key = checkCacheKey("/p/a.js", "export const x = 1;\n", { autoBind: true });
      expect(c.get(key)).toBeUndefined();
      c.set(key, { ok: true, n: 1 });
      expect(c.get(key)).toEqual({ ok: true, n: 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is disabled without root and fails open", () => {
    const c = new DiskCache({ root: undefined, namespace: "check" });
    expect(c.enabled).toBe(false);
    expect(c.get("x")).toBeUndefined();
    expect(() => c.set("x", 1)).not.toThrow();
  });

  it("key changes with source and autoBind", () => {
    const a = checkCacheKey("/p/a.js", "a", { autoBind: true });
    const b = checkCacheKey("/p/a.js", "b", { autoBind: true });
    const c = checkCacheKey("/p/a.js", "a", { autoBind: false });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("sha256 and relativizePath are stable", () => {
    expect(sha256Hex("x")).toHaveLength(64);
    expect(ANALYSIS_ABI).toContain("v1");
    expect(relativizePath("/root/src/a.js", "/root")).toBe("src/a.js");
  });
});

describe("B3/B4 config", () => {
  it("diskCacheRoot: true → .nudo/cache under project", () => {
    const prev = process.env.NUDO_CACHE_DIR;
    delete process.env.NUDO_CACHE_DIR;
    try {
      expect(diskCacheRoot({ cache: true }, "/proj")).toBe(join("/proj", ".nudo/cache"));
      expect(diskCacheRoot({ cache: false }, "/proj")).toBeUndefined();
      expect(diskCacheRoot({}, "/proj")).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.NUDO_CACHE_DIR = prev;
    }
  });

  it("callSiteBudget defaults to 3 and clamps", () => {
    expect(analysisConfig(null).callSiteBudget).toBe(3);
    expect(analysisConfig({ analysis: { callSiteBudget: 10 } }).callSiteBudget).toBe(10);
    expect(analysisConfig({ analysis: { callSiteBudget: 0 } }).callSiteBudget).toBe(3);
    expect(analysisConfig({ analysis: { callSiteBudget: 999 } }).callSiteBudget).toBe(64);
  });
});
