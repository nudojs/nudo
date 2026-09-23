/**
 * L2 harvest 磁盘层（design-persistent-cache）：HarvestJson 跨会话复用。
 * 布局：`~/.cache/nudo/deps/`（或 NUDO_DEPS_CACHE_DIR）。
 * 键：harvestCacheKey(pkg, version, knobs, dtsClosureHash)。
 * fail-open：读写失败 → 回落进程内 harvest（L0）。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { HarvestedEnv } from "@nudojs/harvester";
import { harvestPackage, type PackageHarvest } from "./harvest-package.ts";
import {
  harvestCacheKey,
  materializeHarvestJson,
  serializeHarvestJson,
  type HarvestJson,
} from "./harvest-json.ts";

/** 依赖包层缓存根（跨项目）；off/0 关闭 */
export function depsCacheRoot(): string | undefined {
  const env = process.env.NUDO_DEPS_CACHE_DIR;
  if (env === "off" || env === "0") return undefined;
  if (env && env.length > 0) return env;
  try {
    return join(homedir(), ".cache", "nudo", "deps");
  } catch {
    return undefined;
  }
}

function readPkgVersion(root: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      version?: string;
    };
    return raw.version;
  } catch {
    return undefined;
  }
}

/** dts 闭包内容哈希（覆盖每个实际读到的文件，不只入口） */
export function dtsClosureHash(files: string[]): string {
  const h = createHash("sha256");
  for (const f of [...files].sort()) {
    h.update(f.replace(/\\/g, "/"));
    try {
      h.update(readFileSync(f));
    } catch {
      h.update("miss");
    }
  }
  return h.digest("hex");
}

function diskPath(root: string, key: string): string {
  return join(root, key.slice(0, 2), `${key}.json`);
}

export function readHarvestDisk(root: string, key: string): HarvestJson | undefined {
  try {
    const p = diskPath(root, key);
    if (!existsSync(p)) return undefined;
    const parsed = JSON.parse(readFileSync(p, "utf8")) as { abi?: string; value?: HarvestJson };
    if (parsed?.abi !== "nudo-harvest-disk-v1") return undefined;
    return parsed.value;
  } catch {
    return undefined;
  }
}

export function writeHarvestDisk(root: string, key: string, value: HarvestJson): void {
  try {
    const p = diskPath(root, key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ abi: "nudo-harvest-disk-v1", value }), "utf8");
  } catch {
    // fail-open
  }
}

/**
 * L2 + L0：磁盘 HarvestJson → 进程内 PackageHarvest。
 * miss / 损坏 → 重新 harvest 并写盘（若磁盘层开启）。
 */
export function harvestPackageWithDisk(
  pkg: string,
  fromDir: string,
  maxFiles = 8,
): PackageHarvest | null {
  const root = depsCacheRoot();
  // 先解析包根（要 version + dts 列表做键）
  let h: PackageHarvest | null = null;
  try {
    const raw = harvestPackage(pkg, fromDir, maxFiles);
    if (!("error" in raw)) h = raw;
  } catch {
    h = null;
  }
  if (!h) return null;

  const key = harvestCacheKey(pkg, {
    dtsHash: dtsClosureHash(h.dtsFiles),
    maxFiles,
    pkgVersion: readPkgVersion(h.root),
  });

  if (!root) return h;

  const hit = readHarvestDisk(root, key);
  if (hit) {
    const env = materializeHarvestJson(hit);
    if (env) {
      return { pkg, root: h.root, dtsFiles: h.dtsFiles, env };
    }
  }

  writeHarvestDisk(
    root,
    key,
    serializeHarvestJson(pkg, h.env, {
      dtsHash: dtsClosureHash(h.dtsFiles),
      maxFiles,
      pkgVersion: readPkgVersion(h.root),
    }),
  );
  return h;
}

/** 从磁盘 materialize（不跑 harvestDts）；键需调用方自算 */
export function loadHarvestEnvFromDisk(
  pkg: string,
  meta: { dtsHash: string; maxFiles: number; pkgVersion?: string },
): HarvestedEnv | null {
  const root = depsCacheRoot();
  if (!root) return null;
  const key = harvestCacheKey(pkg, meta);
  const hit = readHarvestDisk(root, key);
  return hit ? materializeHarvestJson(hit) : null;
}
