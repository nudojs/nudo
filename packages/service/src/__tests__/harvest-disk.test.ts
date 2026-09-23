/**
 * T8：HarvestJson 签名投影 round-trip + L2 磁盘层。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abs, num, str, relationFn, formatShape } from "@nudojs/core";
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
  loadHarvestEnvFromDisk,
} from "../harvest-disk.ts";

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

    const env = loadHarvestEnvFromDisk("path", { dtsHash: "x", maxFiles: 8 });
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
});
