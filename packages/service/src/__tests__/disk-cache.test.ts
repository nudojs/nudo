import { describe, it, expect, vi, afterEach } from "vitest";
import {
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import {
  DiskCache,
  checkCacheKey,
  extractNudoImportSpecs,
  contractCacheKey,
  sha256Hex,
  relativizePath,
  ANALYSIS_ABI,
} from "../disk-cache.ts";
import { diskCacheRoot, analysisConfig } from "../evaluator/config.ts";
import { tmpProject, withTmpProject } from "./tmp-project.ts";

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
  it("roundtrip / disabled fail-open / key 源与配置敏感 / sidecar 敏感 / hash 稳定", () => {
    withTmpProject("nudo-cache-", (root) => {
      const c = new DiskCache({ root, namespace: "check" });
      expect(c.enabled).toBe(true);
      const key = checkCacheKey("/p/a.js", "export const x = 1;\n", { autoBind: true });
      expect(c.get(key)).toBeUndefined();
      c.set(key, { ok: true, n: 1 });
      expect(c.get(key)).toEqual({ ok: true, n: 1 });
    });
    const off = new DiskCache({ root: undefined, namespace: "check" });
    expect(off.enabled).toBe(false);
    expect(off.get("x")).toBeUndefined();
    expect(() => off.set("x", 1)).not.toThrow();

    const a = checkCacheKey("/p/a.js", "a", { autoBind: true });
    expect(checkCacheKey("/p/a.js", "b", { autoBind: true })).not.toBe(a);
    expect(checkCacheKey("/p/a.js", "a", { autoBind: false })).not.toBe(a);
    const src = "export function getName(u){ return u.name; }\n";
    const base = checkCacheKey("/p/a.js", src, { autoBind: true, analysisCfg: { entryThrows: "error", ignoreThrows: "-" } });
    expect(checkCacheKey("/p/a.js", src, { autoBind: true, analysisCfg: { entryThrows: "off", ignoreThrows: "-" } })).not.toBe(base);
    expect(checkCacheKey("/p/a.js", src, { autoBind: true, analysisCfg: { entryThrows: "error", ignoreThrows: "TypeError" } })).not.toBe(base);
    expect(checkCacheKey("/p/a.js", src, { autoBind: true, analysisCfg: { entryThrows: "error", ignoreThrows: "" } })).not.toBe(checkCacheKey("/p/a.js", src, { autoBind: true, analysisCfg: { entryThrows: "error", ignoreThrows: "TypeError" } }));

    const addSrc = "export function add(a, b) { return a + b; }\n";
    const sideBase = checkCacheKey("/p/a.js", addSrc, { autoBind: true, projectDir: "/p", sidecarContent: "export const add = fn({ a: number() }, number());\n" });
    expect(checkCacheKey("/p/a.js", addSrc, { autoBind: true, projectDir: "/p", sidecarContent: "export const add = fn({ a: number().gt(0) }, number());\n" })).not.toBe(sideBase);
    expect(checkCacheKey("/p/a.js", addSrc, { autoBind: true, projectDir: "/p", sidecarContent: null })).not.toBe(sideBase);
    expect(sideBase).toHaveLength(64);
    expect(sha256Hex("x")).toHaveLength(64);
    expect(ANALYSIS_ABI).toMatch(/^nudo-check-cache-v\d+\+\d/);
    expect(relativizePath("/root/src/a.js", "/root")).toBe("src/a.js");
  });
});;

describe("B3 disk cache atomic write", () => {
  afterEach(() => { fsControl.writeFileSync = null; fsControl.renameSync = null; });
  const cachePath = (root: string, key: string) => join(root, "check", key.slice(0, 2), `${key}.json`);
  it("中断写/rename 失败保留旧完整 JSON 且无 tmp；成功写原子发布", () => {
    withTmpProject("nudo-cache-atomic-", (root) => {
      const c = new DiskCache({ root, namespace: "check" });
      const key = checkCacheKey("/p/a.js", "export const x = 1;\n", { autoBind: true });
      const first = { ok: true, n: 1 };
      c.set(key, first);
      const target = cachePath(root, key);
      expect(JSON.parse(readFileSync(target, "utf8")).value).toEqual(first);
      fsControl.writeFileSync = (p, data, opts) => {
        const text = String(data);
        fsControl.real!.writeFileSync(p, text.slice(0, Math.floor(text.length / 2)), opts as never);
        throw new Error("simulated crash mid-write");
      };
      expect(() => c.set(key, { ok: false, n: 2 })).not.toThrow();
      expect(() => JSON.parse(readFileSync(target, "utf8"))).not.toThrow();
      expect(JSON.parse(readFileSync(target, "utf8")).value).toEqual(first);
      expect(readdirSync(dirname(target)).filter((f) => f.includes(".tmp-"))).toEqual([]);
      fsControl.writeFileSync = null;
      fsControl.renameSync = () => { throw new Error("simulated rename failure"); };
      expect(() => c.set(key, { ok: false })).not.toThrow();
      expect(JSON.parse(readFileSync(target, "utf8")).value).toEqual(first);
      expect(readdirSync(dirname(target)).filter((f) => f.includes(".tmp-"))).toEqual([]);
      fsControl.renameSync = null;
      c.set(key, { v: 1 });
      c.set(key, { v: 2 });
      expect(JSON.parse(readFileSync(target, "utf8")).value).toEqual({ v: 2 });
      expect(readdirSync(dirname(target))).toEqual([`${key}.json`]);
    });
  });
});;

describe("B3 Phase B contract table cache", () => {
  it("contract key 源/sidecar/autoBind 敏感；无 sidecar 与 autoBind=false 同段；表 roundtrip", () => {
    const src = "export function add(a, b) { return a + b; }\n";
    const sidecarA = "export const add = fn({ a: number() }, number());\n";
    const sidecarB = "export const add = fn({ a: number().gt(0) }, number());\n";
    const base = contractCacheKey("/p/a.js", src, { autoBind: true, projectDir: "/p", sidecarSource: sidecarA });
    expect(base).toHaveLength(64);
    expect(contractCacheKey("/p/a.js", src + "\n", { autoBind: true, projectDir: "/p", sidecarSource: sidecarA })).not.toBe(base);
    expect(contractCacheKey("/p/a.js", src, { autoBind: true, projectDir: "/p", sidecarSource: sidecarB })).not.toBe(base);
    expect(contractCacheKey("/p/a.js", src, { autoBind: false, projectDir: "/p", sidecarSource: sidecarA })).not.toBe(base);
    expect(contractCacheKey("/p/a.js", src, { autoBind: false, projectDir: "/p" })).toBe(contractCacheKey("/p/a.js", src, { autoBind: false, projectDir: "/p", sidecarSource: sidecarA }));
    withTmpProject("nudo-contract-", (root) => {
      const disk = new DiskCache({ root, namespace: "contract" });
      const key = contractCacheKey("/p/a.js", src, { autoBind: true, projectDir: "/p" });
      expect(disk.get(key)).toBeUndefined();
      const table = { fns: { add: { fnName: "add", params: [{ param: "a", constraint: { __nudoConstraint: true, prim: "number", preds: [] } }], source: "handwritten" as const }, helper: null } };
      disk.set(key, table);
      expect(disk.get(key)).toEqual(table);
    });
  });
});;

describe("B3/B4 config", () => {
  it("diskCacheRoot / callSiteBudget / import specs / dep content key", () => {
    const prev = process.env.NUDO_CACHE_DIR;
    delete process.env.NUDO_CACHE_DIR;
    try {
      expect(diskCacheRoot({ cache: true }, "/proj")).toBe(join("/proj", ".nudo/cache"));
      expect(diskCacheRoot({ cache: false }, "/proj")).toBeUndefined();
      expect(diskCacheRoot({}, "/proj")).toBeUndefined();
    } finally { if (prev !== undefined) process.env.NUDO_CACHE_DIR = prev; }
    expect(analysisConfig(null).callSiteBudget).toBe(3);
    expect(analysisConfig({ analysis: { callSiteBudget: 10 } }).callSiteBudget).toBe(10);
    expect(analysisConfig({ analysis: { callSiteBudget: 0 } }).callSiteBudget).toBe(3);
    expect(analysisConfig({ analysis: { callSiteBudget: 999 } }).callSiteBudget).toBe(64);
    expect(extractNudoImportSpecs('/// @nudo:import { positive } from "./std.nudo.js"\n/// @nudo:import * as helpers from "./h.nudo.js"\n')).toEqual(["./std.nudo.js", "./h.nudo.js"]);
    const src = '/// @nudo:import { positive } from "./std.nudo.js"\nexport function f(x){return x;}\n';
    const a = checkCacheKey("/p/a.js", src, { autoBind: true, projectDir: "/p", depContents: [{ path: "/p/std.nudo.js", content: "export const positive = 1;\n" }] });
    const b = checkCacheKey("/p/a.js", src, { autoBind: true, projectDir: "/p", depContents: [{ path: "/p/std.nudo.js", content: "export const positive = 2;\n" }] });
    expect(a).not.toBe(b);
  });
});;

describe("B3 path key portability (F-6 / FIX-D3)", () => {
  const makeCheckout = (layout: "node_modules" | "monorepo" | "pnpm") => {
    const root = tmpProject("nudo-checkout-");
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
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    mkdirSync(join(root, "shared"), { recursive: true });
    const depPath = join(root, "shared", "util.js");
    writeFileSync(depPath, "export const positive = 1;\n");
    return { root, projectDir, filePath, depPath };
  };
  const keyFor = (c: { projectDir: string; filePath: string; depPath: string }, depContent: string) => checkCacheKey(c.filePath, "export const x = 1;\n", { autoBind: true, projectDir: c.projectDir, depContents: [{ path: c.depPath, content: depContent }] });
  it("布局可移植 / 入口键带项目身份 / 内容 miss / 绝对路径不明文 / pnpm store / orphan 内容寻址", () => {
    for (const layout of ["node_modules", "pnpm", "monorepo"] as const) {
      const a = makeCheckout(layout);
      const b = makeCheckout(layout);
      try {
        const expected = layout === "monorepo" ? "shared/util.js" : "node_modules/foo/lib.js";
        expect(relativizePath(a.depPath, a.projectDir), layout).toBe(expected);
        expect(relativizePath(b.depPath, b.projectDir), layout).toBe(expected);
        expect(keyFor(a, "export const positive = 1;\n"), layout).not.toBe(keyFor(b, "export const positive = 1;\n"));
      } finally { rmSync(a.root, { recursive: true, force: true }); rmSync(b.root, { recursive: true, force: true }); }
    }
    const a = makeCheckout("node_modules");
    try {
      expect(keyFor(a, "export const positive = 1;\n")).not.toBe(keyFor(a, "export const positive = 2;\n"));
      expect(relativizePath(a.depPath, undefined)).toBe("node_modules/foo/lib.js");
      const orphan = join(a.root, "elsewhere", "unique-orphan-file.js");
      mkdirSync(join(a.root, "elsewhere"), { recursive: true });
      writeFileSync(orphan, "x\n");
      const fallback = relativizePath(orphan);
      expect(fallback.startsWith("/")).toBe(false);
      expect(fallback).not.toContain(orphan.split(sep).join("/"));
    } finally { rmSync(a.root, { recursive: true, force: true }); }
    const hash = "a".repeat(62);
    expect(relativizePath(`/Users/alice/Library/pnpm/store/v3/files/aa/${hash}`)).toBe(`pnpm-store:aa${hash}`);
    expect(relativizePath(`/home/ci/.local/share/pnpm/store/v3/files/aa/${hash}`)).toBe(`pnpm-store:aa${hash}`);
    const h2 = "b".repeat(64);
    expect(relativizePath(`/Users/alice/.pnpm-store/v10/files/${h2}`)).toBe(`pnpm-store:${h2}`);
    const content = "export const positive = 1;\n";
    const ka = checkCacheKey("/p/a.js", "export const x = 1;\n", { autoBind: true, projectDir: "/p", depContents: [{ path: "/Users/alice/store/orphan.js", content }] });
    const kb = checkCacheKey("/p/a.js", "export const x = 1;\n", { autoBind: true, projectDir: "/p", depContents: [{ path: "/home/ci/store/orphan.js", content }] });
    expect(ka).toBe(kb);
    expect(checkCacheKey("/p/a.js", "export const x = 1;\n", { autoBind: true, projectDir: "/p", depContents: [{ path: "/Users/alice/store/orphan.js", content: content + "//x\n" }] })).not.toBe(ka);
  });
});;
