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
import type { HarvestedEnv } from "./harvest-dts.ts";
import {
  harvestPackage,
  resolvePackageRoot,
  collectDtsFiles,
  collectDtsFromEntry,
  type PackageHarvest,
} from "./harvest-package.ts";
import {
  harvestCacheKey,
  materializeHarvestJson,
  serializeHarvestJson,
  HARVEST_DISK_ABI,
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

/**
 * dts 闭包内容哈希 + 读故障信号（fail-closed 口径）。
 *
 * - ENOENT 折 `"miss"`（合法缺席：闭包里的文件可以真的不存在）；
 * - 其它读错误（EACCES / EISDIR / …）**不得折 miss**——指纹键会把「读不了」
 *   伪装成「不存在」，磁盘层之后会按同键读写**陈旧/错配**缓存。
 *   `readerr:` 哨兵进哈希（与 miss 不同键），且 `readError: true` 供消费方
 *   （harvestPackageWithDisk）跳过本包本次磁盘层（不读不写，宁冷勿陈旧）。
 */
export function dtsClosureHashDetailed(files: string[]): { hash: string; readError: boolean } {
  const h = createHash("sha256");
  let readError = false;
  for (const f of [...files].sort()) {
    h.update(f.replace(/\\/g, "/"));
    try {
      h.update(readFileSync(f));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        h.update("miss");
      } else {
        readError = true;
        h.update(`readerr:${(e as NodeJS.ErrnoException).code ?? "unknown"}`);
      }
    }
  }
  return { hash: h.digest("hex"), readError };
}

/** dts 闭包内容哈希（覆盖每个实际读到的文件，不只入口）；读故障语义见 dtsClosureHashDetailed */
export function dtsClosureHash(files: string[]): string {
  return dtsClosureHashDetailed(files).hash;
}

function diskPath(root: string, key: string): string {
  return join(root, key.slice(0, 2), `${key}.json`);
}

export function readHarvestDisk(root: string, key: string): HarvestJson | undefined {
  try {
    const p = diskPath(root, key);
    if (!existsSync(p)) return undefined;
    const parsed = JSON.parse(readFileSync(p, "utf8")) as { abi?: string; value?: HarvestJson };
    if (parsed?.abi !== HARVEST_DISK_ABI) return undefined;
    return parsed.value;
  } catch {
    return undefined;
  }
}

export function writeHarvestDisk(root: string, key: string, value: HarvestJson): void {
  try {
    const p = diskPath(root, key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ abi: HARVEST_DISK_ABI, value }), "utf8");
  } catch {
    // fail-open
  }
}

/** 列包 dts 闭包（不解析）；供磁盘键与 miss 路径复用 */
export function listPackageDts(
  pkg: string,
  fromDir: string,
  maxFiles: number,
): { root: string; dtsFiles: string[]; pkgVersion?: string } | null {
  const root = resolvePackageRoot(pkg, fromDir);
  if (!root) return null;
  const entry = (() => {
    try {
      const raw = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
        types?: string;
        typings?: string;
      };
      const e = raw.types ?? raw.typings;
      return typeof e === "string" && e.endsWith(".d.ts") ? join(root, e) : undefined;
    } catch {
      return undefined;
    }
  })();
  let dtsFiles =
    entry && existsSync(entry) ? collectDtsFromEntry(entry, Math.max(maxFiles, 24)) : [];
  if (dtsFiles.length === 0) {
    const collected = collectDtsFiles(root, maxFiles);
    dtsFiles =
      entry && existsSync(entry) && !collected.includes(entry)
        ? [entry, ...collected.filter((f) => f !== entry)].slice(0, maxFiles)
        : collected;
  }
  if (dtsFiles.length === 0) return null;
  return { root, dtsFiles, pkgVersion: readPkgVersion(root) };
}

/**
 * L2 + L0：**磁盘优先**（跳过 harvestDts 解析），miss 再 harvest 并写盘。
 */
export function harvestPackageWithDisk(
  pkg: string,
  fromDir: string,
  maxFiles = 24,
): PackageHarvest | null {
  const cacheRoot = depsCacheRoot();
  const listed = listPackageDts(pkg, fromDir, maxFiles);
  if (!listed) return null;
  const { hash: dtsHash, readError } = dtsClosureHashDetailed(listed.dtsFiles);
  const key = harvestCacheKey(pkg, {
    dtsHash,
    maxFiles,
    pkgVersion: listed.pkgVersion,
  });

  // fail-closed：读错误不折 miss ⇒ 本包本次磁盘层**不读不写**
  // （宁冷勿陈旧——读不了时按 miss 键命中的缓存可能是错配的陈旧产物），
  // 只走下面的进程内 fresh harvest。
  if (cacheRoot && !readError) {
    const hit = readHarvestDisk(cacheRoot, key);
    if (hit) {
      const env = materializeHarvestJson(hit);
      if (env) {
        return { pkg, root: listed.root, dtsFiles: listed.dtsFiles, env };
      }
    }
  }

  // harvestPackage 的**确定终态**（error 结果）折 null——可缓存；
  // **抛异常**（瞬态故障）向上抛：harvestPackageCached 的异常路径不写
  // 缓存（宁冷勿陈旧），不再把 null 钉死整个进程。
  const raw = harvestPackage(pkg, fromDir, maxFiles);
  const h: PackageHarvest | null = "error" in raw ? null : raw;
  if (!h) return null;

  if (cacheRoot && !readError) {
    const stored = dtsClosureHashDetailed(h.dtsFiles);
    if (!stored.readError) {
      writeHarvestDisk(
        cacheRoot,
        key,
        serializeHarvestJson(pkg, h.env, {
          dtsHash: stored.hash,
          maxFiles,
          pkgVersion: listed.pkgVersion,
        }),
      );
    }
  }
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
