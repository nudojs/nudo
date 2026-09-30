import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
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

type FsModule = typeof import("node:fs");

/** 允许测试在真实 fs 之上注入写/改名失败（ESM namespace 不可 spyOn） */
const fsControl = vi.hoisted(() => ({
  real: null as FsModule | null,
  writeFileSync: null as
    | null
    | ((p: Parameters<FsModule["writeFileSync"]>[0], data: Parameters<FsModule["writeFileSync"]>[1], opts?: Parameters<FsModule["writeFileSync"]>[2]) => void),
  renameSync: null as
    | null
    | ((oldPath: Parameters<FsModule["renameSync"]>[0], newPath: Parameters<FsModule["renameSync"]>[1]) => void),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<FsModule>();
  fsControl.real = actual;
  return {
    ...actual,
    writeFileSync: ((
      p: Parameters<FsModule["writeFileSync"]>[0],
      data: Parameters<FsModule["writeFileSync"]>[1],
      opts?: Parameters<FsModule["writeFileSync"]>[2],
    ) => {
      if (fsControl.writeFileSync) return fsControl.writeFileSync(p, data, opts);
      return actual.writeFileSync(p, data, opts);
    }) as FsModule["writeFileSync"],
    renameSync: ((
      oldPath: Parameters<FsModule["renameSync"]>[0],
      newPath: Parameters<FsModule["renameSync"]>[1],
    ) => {
      if (fsControl.renameSync) return fsControl.renameSync(oldPath, newPath);
      return actual.renameSync(oldPath, newPath);
    }) as FsModule["renameSync"],
  };
});

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

describe("B3 disk cache atomic write", () => {
  afterEach(() => {
    fsControl.writeFileSync = null;
    fsControl.renameSync = null;
  });

  const cachePath = (root: string, key: string) =>
    join(root, "check", key.slice(0, 2), `${key}.json`);

  it("interrupted write leaves no torn JSON at the cache path", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cache-atomic-"));
    try {
      const c = new DiskCache({ root, namespace: "check" });
      const key = checkCacheKey("/p/a.js", "export const x = 1;\n", { autoBind: true });
      const first = { ok: true, n: 1 };
      c.set(key, first);

      const target = cachePath(root, key);
      expect(JSON.parse(readFileSync(target, "utf8")).value).toEqual(first);

      // 模拟中断写：writeFileSync 只落一半字节后崩溃
      fsControl.writeFileSync = (p, data, opts) => {
        const text = String(data);
        fsControl.real!.writeFileSync(p, text.slice(0, Math.floor(text.length / 2)), opts as never);
        throw new Error("simulated crash mid-write");
      };

      // fail-open：不抛出
      expect(() => c.set(key, { ok: false, n: 2 })).not.toThrow();

      // 目标仍是完整 JSON（旧值），绝不能是半截
      const raw = readFileSync(target, "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
      expect(JSON.parse(raw).value).toEqual(first);

      // 不残留孤儿 tmp
      expect(readdirSync(dirname(target)).filter((f) => f.includes(".tmp-"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rename failure cleans tmp and keeps the previous entry intact", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cache-atomic-"));
    try {
      const c = new DiskCache({ root, namespace: "check" });
      const key = checkCacheKey("/p/a.js", "export const x = 2;\n", { autoBind: true });
      const first = { ok: true };
      c.set(key, first);
      const target = cachePath(root, key);

      fsControl.renameSync = () => {
        throw new Error("simulated rename failure");
      };

      expect(() => c.set(key, { ok: false })).not.toThrow();

      expect(JSON.parse(readFileSync(target, "utf8")).value).toEqual(first);
      expect(readdirSync(dirname(target)).filter((f) => f.includes(".tmp-"))).toEqual([]);
      expect(existsSync(target)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("successful set publishes atomically and leaves no tmp files", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cache-atomic-"));
    try {
      const c = new DiskCache({ root, namespace: "check" });
      const key = checkCacheKey("/p/a.js", "export const x = 3;\n", { autoBind: true });
      c.set(key, { v: 1 });
      c.set(key, { v: 2 });
      const target = cachePath(root, key);
      expect(JSON.parse(readFileSync(target, "utf8")).value).toEqual({ v: 2 });
      expect(readdirSync(dirname(target))).toEqual([`${key}.json`]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

describe("B3 path key portability (F-6 / FIX-D3)", () => {
  /** 两台不同 checkout 根：同逻辑布局 → 同 key；内容变 → miss */
  function makeCheckout(layout: "node_modules" | "monorepo" | "pnpm"): {
    root: string;
    projectDir: string;
    filePath: string;
    depPath: string;
  } {
    const root = mkdtempSync(join(tmpdir(), "nudo-checkout-"));
    const projectDir = join(root, "packages", "pkg");
    const filePath = join(projectDir, "src", "a.js");
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(filePath, "export const x = 1;\n");

    if (layout === "node_modules") {
      const depDir = join(root, "node_modules", "foo");
      mkdirSync(depDir, { recursive: true });
      const depPath = join(depDir, "lib.js");
      writeFileSync(depPath, "export const positive = 1;\n");
      return { root, projectDir, filePath, depPath };
    }
    if (layout === "pnpm") {
      const depDir = join(root, "node_modules", ".pnpm", "foo@1.0.0", "node_modules", "foo");
      mkdirSync(depDir, { recursive: true });
      const depPath = join(depDir, "lib.js");
      writeFileSync(depPath, "export const positive = 1;\n");
      return { root, projectDir, filePath, depPath };
    }
    // monorepo：树内 packages/pkg + 树外 shared/（hoisted 非 node_modules）
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    mkdirSync(join(root, "shared"), { recursive: true });
    const depPath = join(root, "shared", "util.js");
    writeFileSync(depPath, "export const positive = 1;\n");
    return { root, projectDir, filePath, depPath };
  }

  const keyFor = (
    c: { projectDir: string; filePath: string; depPath: string },
    depContent: string,
  ) =>
    checkCacheKey(c.filePath, "export const x = 1;\n", {
      autoBind: true,
      projectDir: c.projectDir,
      depContents: [{ path: c.depPath, content: depContent }],
    });

  it("node_modules dep: same key across different checkout roots", () => {
    const a = makeCheckout("node_modules");
    const b = makeCheckout("node_modules");
    try {
      expect(a.root).not.toBe(b.root);
      expect(keyFor(a, "export const positive = 1;\n")).toBe(
        keyFor(b, "export const positive = 1;\n"),
      );
    } finally {
      rmSync(a.root, { recursive: true, force: true });
      rmSync(b.root, { recursive: true, force: true });
    }
  });

  it("pnpm virtual-store dep: logical node_modules/<pkg> segment is portable", () => {
    const a = makeCheckout("pnpm");
    const b = makeCheckout("pnpm");
    try {
      expect(relativizePath(a.depPath, a.projectDir)).toBe("node_modules/foo/lib.js");
      expect(relativizePath(b.depPath, b.projectDir)).toBe("node_modules/foo/lib.js");
      expect(keyFor(a, "export const positive = 1;\n")).toBe(
        keyFor(b, "export const positive = 1;\n"),
      );
    } finally {
      rmSync(a.root, { recursive: true, force: true });
      rmSync(b.root, { recursive: true, force: true });
    }
  });

  it("monorepo out-of-tree dep: root-relative under workspace root is portable", () => {
    const a = makeCheckout("monorepo");
    const b = makeCheckout("monorepo");
    try {
      expect(relativizePath(a.depPath, a.projectDir)).toBe("shared/util.js");
      expect(relativizePath(b.depPath, b.projectDir)).toBe("shared/util.js");
      expect(keyFor(a, "export const positive = 1;\n")).toBe(
        keyFor(b, "export const positive = 1;\n"),
      );
    } finally {
      rmSync(a.root, { recursive: true, force: true });
      rmSync(b.root, { recursive: true, force: true });
    }
  });

  it("dep content change → key miss (even with portable path segment)", () => {
    const a = makeCheckout("node_modules");
    try {
      expect(keyFor(a, "export const positive = 1;\n")).not.toBe(
        keyFor(a, "export const positive = 2;\n"),
      );
    } finally {
      rmSync(a.root, { recursive: true, force: true });
    }
  });

  it("no projectDir: absolute path never enters the key in the clear", () => {
    const a = makeCheckout("node_modules");
    try {
      const abs = a.depPath.split(sep).join("/");
      const rel = relativizePath(a.depPath);
      expect(rel).toBe("node_modules/foo/lib.js");
      expect(rel).not.toBe(abs);
      expect(rel.startsWith("/")).toBe(false);

      // 无任何稳定逻辑根：仍禁止绝对路径明文进 key
      const orphan = join(a.root, "elsewhere", "unique-orphan-file.js");
      mkdirSync(join(a.root, "elsewhere"), { recursive: true });
      writeFileSync(orphan, "x\n");
      const orphanAbs = orphan.split(sep).join("/");
      const fallback = relativizePath(orphan);
      expect(fallback).not.toBe(orphanAbs);
      expect(fallback.startsWith("/")).toBe(false);
      expect(fallback).not.toContain(orphanAbs);
    } finally {
      rmSync(a.root, { recursive: true, force: true });
    }
  });
});
