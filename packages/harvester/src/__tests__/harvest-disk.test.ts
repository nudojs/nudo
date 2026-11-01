/**
 * T8：HarvestJson 签名投影 round-trip + L2 磁盘层。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abs, num, str, relationFn, formatShape, strLit, numLit, boolLit, litValue } from "@nudojs/core";
import {
  absToHarvestSig,
  harvestSigToAbs,
  serializeHarvestJson,
  materializeHarvestJson,
  harvestCacheKey,
} from "../harvest-json.ts";
import {
  writeHarvestDisk,
  readHarvestDisk,
  dtsClosureHash,
  dtsClosureHashDetailed,
  harvestPackageWithDisk,
} from "../harvest-disk.ts";

// 异常上抛回归的可控注入 seam：默认透传原实现
const harvestThrowRef = vi.hoisted(() => ({ current: null as Error | null }));
vi.mock("../harvest-package.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../harvest-package.ts")>();
  return {
    ...orig,
    harvestPackage: ((...args: Parameters<typeof orig.harvestPackage>) => {
      if (harvestThrowRef.current) throw harvestThrowRef.current;
      return orig.harvestPackage(...args);
    }) as typeof orig.harvestPackage,
  };
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
  delete process.env.NUDO_DEPS_CACHE_DIR;
});

describe("HarvestJson round-trip", () => {
  it("prim / fn / obj shapes survive signature projection", () => {
    const fnAbs = relationFn([num()], str());
    const objAbs = abs(
      {
        k: "obj",
        slots: {
          id: { value: num() },
          name: { value: str(), optional: true },
          cb: { value: fnAbs },
        },
      },
      undefined,
      undefined,
      "path",
    );
    const sig = absToHarvestSig(objAbs);
    const back = harvestSigToAbs(sig);
    expect(back.shape.k).toBe("obj");
    const slots = (back.shape as { slots: Record<string, { value: { shape: { k: string } } }> })
      .slots;
    expect(slots.id!.value.shape.k).toBe("prim");
    expect(slots.cb!.value.shape.k).toBe("fn");
    expect(back.conf).toBe("mock");
    // 展示面仍可读
    expect(formatShape(back)).toContain("id");
  });

  it("literal Abs survive signature projection", () => {
    for (const lit of [strLit("GET"), numLit(404), boolLit(true)]) {
      const back = harvestSigToAbs(absToHarvestSig(lit));
      expect(back.term?.op).toBe("lit");
      const orig = litValue(lit);
      const round = litValue(back);
      expect(orig.ok && round.ok && round.value).toBe(orig.ok && orig.value);
    }
  });

  it("null vs undefined vs unknown stay distinguishable", () => {
    const nullAbs = abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
    const undefAbs = abs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact");
    const unknownAbs = abs({ k: "unknown" }, undefined, undefined, "exact");

    const nullBack = harvestSigToAbs(absToHarvestSig(nullAbs));
    expect(nullBack.term?.op).toBe("lit");
    expect(litValue(nullBack)).toEqual({ ok: true, value: null });

    const undefBack = harvestSigToAbs(absToHarvestSig(undefAbs));
    expect(undefBack.term?.op).toBe("lit");
    expect(litValue(undefBack)).toEqual({ ok: true, value: undefined });

    const unknownBack = harvestSigToAbs(absToHarvestSig(unknownAbs));
    expect(unknownBack.term?.op).toBeUndefined();
  });

  it("literal round-trips through JSON serialization", () => {
    const env = {
      globals: {
        GET: strLit("GET"),
        notFound: numLit(404),
        flag: boolLit(false),
        nothing: abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact"),
        missing: abs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact"),
      },
      modules: {},
      stats: { files: 0, symbols: 5, skipped: 0 },
    };
    const json = serializeHarvestJson("test", env, { dtsHash: "h", maxFiles: 1 });
    // JSON 序列化 → 反序列化 → materialize
    const parsed = JSON.parse(JSON.stringify(json));
    const back = materializeHarvestJson(parsed);
    expect(back).not.toBeNull();
    const g = back!.globals;
    expect(g.GET!.term?.op).toBe("lit");
    expect(litValue(g.GET!)).toEqual({ ok: true, value: "GET" });
    expect(litValue(g.notFound!)).toEqual({ ok: true, value: 404 });
    expect(litValue(g.flag!)).toEqual({ ok: true, value: false });
    expect(litValue(g.nothing!)).toEqual({ ok: true, value: null });
    expect(g.missing!.term?.op).toBe("lit");
    expect(litValue(g.missing!)).toEqual({ ok: true, value: undefined });
  });

  it("serialize + materialize keeps module table", () => {
    const env = {
      globals: { console: num() },
      modules: {
        "path": {
          join: relationFn([str(), str()], str()),
          sep: str(),
        },
      },
      stats: { files: 1, symbols: 2, skipped: 0 },
    };
    const json = serializeHarvestJson("path", env, {
      dtsHash: "abc",
      maxFiles: 8,
      pkgVersion: "1.0.0",
    });
    expect(json.v).toBe(1);
    expect(json.modules.path!.join!.k).toBe("fn");
    const back = materializeHarvestJson(json);
    expect(back).not.toBeNull();
    expect(back!.modules.path!.join!.shape.k).toBe("fn");
    expect(back!.modules.path!.sep!.shape.k).toBe("prim");
  });

  it("corrupt json materializes to null", () => {
    expect(materializeHarvestJson(null)).toBeNull();
    expect(materializeHarvestJson({ v: 99 })).toBeNull();
    expect(materializeHarvestJson({ v: 1, modules: 1 })).toBeNull();
  });
});

describe("L2 harvest disk layer", () => {
  it("key flips with dtsHash / version / maxFiles", () => {
    const a = harvestCacheKey("path", { dtsHash: "h1", maxFiles: 8, pkgVersion: "1.0.0" });
    const b = harvestCacheKey("path", { dtsHash: "h2", maxFiles: 8, pkgVersion: "1.0.0" });
    const c = harvestCacheKey("path", { dtsHash: "h1", maxFiles: 8, pkgVersion: "2.0.0" });
    const d = harvestCacheKey("path", { dtsHash: "h1", maxFiles: 12, pkgVersion: "1.0.0" });
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it("write + read HarvestJson from deps cache root", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-deps-cache-"));
    dirs.push(root);
    process.env.NUDO_DEPS_CACHE_DIR = root;
    const key = harvestCacheKey("path", { dtsHash: "x", maxFiles: 8 });
    const json = serializeHarvestJson(
      "path",
      { globals: {}, modules: { path: { join: relationFn([str()], str()) } }, stats: { files: 1, symbols: 1, skipped: 0 } },
      { dtsHash: "x", maxFiles: 8 },
    );
    writeHarvestDisk(root, key, json);
    const hit = readHarvestDisk(root, key);
    expect(hit).toBeDefined();
    expect(hit!.modules.path!.join!.k).toBe("fn");

    const env = materializeHarvestJson(readHarvestDisk(root, key));
    expect(env).not.toBeNull();
    expect(env!.modules.path!.join!.shape.k).toBe("fn");
  });

  it("dtsClosureHash covers every file content", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-dts-hash-"));
    dirs.push(dir);
    const f1 = join(dir, "a.d.ts");
    const f2 = join(dir, "b.d.ts");
    writeFileSync(f1, "export declare const a: number;");
    writeFileSync(f2, "export declare const b: string;");
    const h1 = dtsClosureHash([f1, f2]);
    const h2 = dtsClosureHash([f2, f1]);
    expect(h1).toBe(h2); // 顺序无关
    writeFileSync(f2, "export declare const b: number;");
    const h3 = dtsClosureHash([f1, f2]);
    expect(h3).not.toBe(h1);
  });

  it("dtsClosureHashDetailed: ENOENT 仍是合法 miss，读错误不折 miss（fail-closed）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-dts-hash-err-"));
    dirs.push(dir);
    const f1 = join(dir, "a.d.ts");
    writeFileSync(f1, "export declare const a: number;");
    const gone = join(dir, "gone.d.ts");
    // 目录当 .d.ts 读 → EISDIR（非 ENOENT 读错误；比 chmod 000 稳——root 下也失败不了）
    const eisdir = join(dir, "sub.d.ts");
    mkdirSync(eisdir);

    // ENOENT = 合法缺席：无 readError 信号
    const miss = dtsClosureHashDetailed([f1, gone]);
    expect(miss.readError).toBe(false);

    // 非 ENOENT 读错误：readError 上浮，且哨兵进哈希（与 miss 不同键——
    // 否则「读不了」被指纹伪装成「不存在」，磁盘层会按 miss 键复用陈旧缓存）
    const bad = dtsClosureHashDetailed([f1, eisdir]);
    expect(bad.readError).toBe(true);
    expect(bad.hash).not.toBe(miss.hash);
    // 同输入指纹稳定
    expect(dtsClosureHashDetailed([f1, eisdir]).hash).toBe(bad.hash);
  });

  it("harvestPackageWithDisk: 读错误的包磁盘层不读不写（宁冷勿陈旧）", () => {
    const proj = mkdtempSync(join(tmpdir(), "nudo-proj-"));
    dirs.push(proj);
    const cache = mkdtempSync(join(tmpdir(), "nudo-deps-fc-"));
    dirs.push(cache);
    process.env.NUDO_DEPS_CACHE_DIR = cache;
    const diskFiles = (): number => readdirSync(cache).length;

    // fixture：types 入口指向一个目录（EISDIR）⇒ dtsClosureHashDetailed readError
    const badPkg = join(proj, "node_modules", "pkg-eisdir");
    mkdirSync(badPkg, { recursive: true });
    writeFileSync(
      join(badPkg, "package.json"),
      JSON.stringify({ name: "pkg-eisdir", version: "1.0.0", types: "x.d.ts" }),
    );
    mkdirSync(join(badPkg, "x.d.ts")); // 入口是目录：读 = EISDIR

    const h = harvestPackageWithDisk("pkg-eisdir", proj);
    // 仍走进程内 fresh harvest（空 env 是诚实结果：harvestDts 也读不了 ⇒ skipped）
    expect(h).not.toBeNull();
    expect(h!.env.stats.skipped).toBeGreaterThan(0);
    // 磁盘层零写入（旧口径会把读错误折 miss 后照常写盘）
    expect(diskFiles()).toBe(0);

    // 正向对照：可读的包照常写盘（证明上面的跳过是 readError 条件性的）
    const okPkg = join(proj, "node_modules", "pkg-ok");
    mkdirSync(okPkg, { recursive: true });
    writeFileSync(
      join(okPkg, "package.json"),
      JSON.stringify({ name: "pkg-ok", version: "1.0.0", types: "index.d.ts" }),
    );
    writeFileSync(join(okPkg, "index.d.ts"), "export declare function ok(): number;\n");
    const h2 = harvestPackageWithDisk("pkg-ok", proj);
    expect(h2).not.toBeNull();
    expect(diskFiles()).toBe(1);
  });

  it("harvestPackageWithDisk: harvest 抛异常向上传播（不折成可缓存的 null）", () => {
    const proj = mkdtempSync(join(tmpdir(), "nudo-proj-"));
    dirs.push(proj);
    const okPkg = join(proj, "node_modules", "pkg-ok");
    mkdirSync(okPkg, { recursive: true });
    writeFileSync(
      join(okPkg, "package.json"),
      JSON.stringify({ name: "pkg-ok", version: "1.0.0", types: "index.d.ts" }),
    );
    writeFileSync(join(okPkg, "index.d.ts"), "export declare function ok(): number;\n");
    // 注入瞬态故障：异常必须穿出（旧口径 catch→null 被 harvestPackageCached
    // 当确定 miss 钉死进程缓存）；不写盘
    harvestThrowRef.current = new Error("transient EIO");
    try {
      expect(() => harvestPackageWithDisk("pkg-ok", proj)).toThrow("transient EIO");
    } finally {
      harvestThrowRef.current = null;
    }
  });
});
