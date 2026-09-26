import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DiskCache,
  checkCacheKey,
  extractNudoImportSpecs,
  ifaceCacheKey,
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

  it("key flips on entryThrows / ignoreThrows (L2 config must not stale-cache)", () => {
    const src = "export function getName(u){ return u.name; }\n";
    const base = checkCacheKey("/p/a.js", src, {
      autoBind: true,
      analysisCfg: { entryThrows: "error", ignoreThrows: "-" },
    });
    const off = checkCacheKey("/p/a.js", src, {
      autoBind: true,
      analysisCfg: { entryThrows: "off", ignoreThrows: "-" },
    });
    const ignored = checkCacheKey("/p/a.js", src, {
      autoBind: true,
      analysisCfg: { entryThrows: "error", ignoreThrows: "TypeError" },
    });
    const emptyIgnore = checkCacheKey("/p/a.js", src, {
      autoBind: true,
      analysisCfg: { entryThrows: "error", ignoreThrows: "" },
    });
    expect(base).not.toBe(off);
    expect(base).not.toBe(ignored);
    expect(ignored).not.toBe(emptyIgnore);
  });

  it("checkCacheKey: sidecar content flips the key (CI must miss on contract change)", () => {
    const src = "export function add(a, b) { return a + b; }\n";
    const base = checkCacheKey("/p/a.js", src, {
      autoBind: true,
      projectDir: "/p",
      sidecarContent: "export const add = fn({ a: number() }, number());\n",
    });
    const changed = checkCacheKey("/p/a.js", src, {
      autoBind: true,
      projectDir: "/p",
      sidecarContent: "export const add = fn({ a: number().gt(0) }, number());\n",
    });
    const noSidecar = checkCacheKey("/p/a.js", src, {
      autoBind: true,
      projectDir: "/p",
      sidecarContent: null,
    });
    expect(base).not.toBe(changed);
    expect(base).not.toBe(noSidecar);
    expect(base).toHaveLength(64);
  });

  it("sha256 and relativizePath are stable", () => {
    expect(sha256Hex("x")).toHaveLength(64);
    expect(ANALYSIS_ABI).toMatch(/^nudo-check-cache-v\d+\+\d/);
    expect(relativizePath("/root/src/a.js", "/root")).toBe("src/a.js");
  });
});

describe("B3 Phase B iface table cache", () => {
  const src = "export function add(a, b) { return a + b; }\n";
  const sidecarA = "export const add = fn({ a: number() }, number());\n";
  const sidecarB = "export const add = fn({ a: number().gt(0) }, number());\n";

  it("ifaceCacheKey: source / sidecar / autoBind each flip the key", () => {
    const base = ifaceCacheKey("/p/a.js", src, {
      autoBind: true,
      projectDir: "/p",
      sidecarSource: sidecarA,
    });
    expect(base).toHaveLength(64);
    expect(
      ifaceCacheKey("/p/a.js", src + "\n", {
        autoBind: true,
        projectDir: "/p",
        sidecarSource: sidecarA,
      }),
    ).not.toBe(base);
    expect(
      ifaceCacheKey("/p/a.js", src, {
        autoBind: true,
        projectDir: "/p",
        sidecarSource: sidecarB,
      }),
    ).not.toBe(base);
    expect(
      ifaceCacheKey("/p/a.js", src, {
        autoBind: false,
        projectDir: "/p",
        sidecarSource: sidecarA,
      }),
    ).not.toBe(base);
  });

  it("ifaceCacheKey: no sidecar / autoBind=false share the sc0 segment", () => {
    const noSc = ifaceCacheKey("/p/a.js", src, { autoBind: false, projectDir: "/p" });
    const abFalse = ifaceCacheKey("/p/a.js", src, {
      autoBind: false,
      projectDir: "/p",
      sidecarSource: sidecarA,
    });
    // autoBind=false 时侧车内容不进键（不 ambient 加载，契约读不到侧车）
    expect(noSc).toBe(abFalse);
  });

  it("iface table round-trips through DiskCache namespace", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-iface-"));
    try {
      const disk = new DiskCache({ root, namespace: "iface" });
      const key = ifaceCacheKey("/p/a.js", src, { autoBind: true, projectDir: "/p" });
      expect(disk.get(key)).toBeUndefined();
      const table = {
        fns: {
          add: {
            fnName: "add",
            params: [
              {
                param: "a",
                constraint: { __nudoConstraint: true, prim: "number", preds: [] },
              },
            ],
            source: "handwritten" as const,
          },
          helper: null,
        },
      };
      disk.set(key, table);
      expect(disk.get(key)).toEqual(table);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  it("extractNudoImportSpecs parses named and namespace forms", () => {
    expect(
      extractNudoImportSpecs(
        `/// @nudo:import { positive } from "./std.nudo.js"\n/// @nudo:import * as helpers from "./h.nudo.js"\n`,
      ),
    ).toEqual(["./std.nudo.js", "./h.nudo.js"]);
  });

  it("checkCacheKey: @nudo:import dep content flips the key", () => {
    const src = `/// @nudo:import { positive } from "./std.nudo.js"\nexport function f(x){return x;}\n`;
    const a = checkCacheKey("/p/a.js", src, {
      autoBind: true,
      projectDir: "/p",
      depContents: [{ path: "/p/std.nudo.js", content: "export const positive = 1;\n" }],
    });
    const b = checkCacheKey("/p/a.js", src, {
      autoBind: true,
      projectDir: "/p",
      depContents: [{ path: "/p/std.nudo.js", content: "export const positive = 2;\n" }],
    });
    expect(a).not.toBe(b);
  });
});
