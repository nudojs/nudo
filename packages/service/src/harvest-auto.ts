/**
 * harvest 自动化：源码裸 import → @types/package → env modules。
 * 手动 `nudo harvest` 仍保留；这里是分析路径上的按需注入。
 */

import { parse } from "@nudojs/parser";
import type { Abs } from "@nudojs/core";
import { collectDependencySpecs } from "./static-imports.ts";
import { harvestPackage, type PackageHarvest } from "./harvest-package.ts";
import { harvestPackageWithDisk } from "./harvest-disk.ts";
import { BoundedLruMap } from "./lru-map.ts";

/**
 * Node builtin module names (with or without `node:` prefix). Bare imports of
 * these are not npm packages — never harvest them as package roots.
 */
const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "http", "http2", "https", "inspector", "module", "net",
  "os", "path", "perf_hooks", "process", "punycode", "querystring", "readline",
  "repl", "stream", "string_decoder", "timers", "tls", "trace_events", "tty",
  "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

/** 裸说明符 → 包名（含 scope）；相对/绝对/node: 与裸 Node 内建返回 undefined */
export function barePackageName(spec: string): string | undefined {
  if (!spec) return undefined;
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) return undefined;
  const parts = spec.split("/");
  if (spec.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  }
  const name = parts[0]!;
  if (NODE_BUILTINS.has(name)) return undefined;
  return name;
}

export function collectBarePackages(source: string): string[] {
  try {
    const ast = parse(source);
    const names = new Set<string>();
    for (const spec of collectDependencySpecs(ast)) {
      const pkg = barePackageName(spec);
      if (pkg) names.add(pkg);
    }
    return [...names];
  } catch {
    return [];
  }
}

/**
 * 进程内 harvest 缓存：同包只 walk 一次 dts。
 *
 * 上限 HARVEST_CACHE_MAX（128 条 `fromDir::pkg` 条目）+ LRU：命中/写入移到队尾，
 * 超限删最旧。retained 内存因此有界；磁盘层（harvest-disk）不受此限。
 */
const HARVEST_CACHE_MAX = 128;
const harvestCache = new BoundedLruMap<PackageHarvest | null>(HARVEST_CACHE_MAX);

/** 测试/诊断：当前条目数（≤ HARVEST_CACHE_MAX） */
export function getHarvestCacheSize(): number {
  return harvestCache.size;
}

export function harvestPackageCached(pkg: string, fromDir: string): PackageHarvest | null {
  const key = `${fromDir}::${pkg}`;
  // null 是合法缓存值（harvest 失败占位）——必须用 has，不能看 undefined
  if (harvestCache.has(key)) return harvestCache.get(key)!;
  let result: PackageHarvest | null = null;
  try {
    // L2 磁盘投影 + L0 进程内（内部已回落 harvestPackage）
    result = harvestPackageWithDisk(pkg, fromDir);
  } catch {
    result = null;
  }
  harvestCache.set(key, result);
  return result;
}

export function clearHarvestCache(): void {
  harvestCache.clear();
}

/**
 * 自动 harvest 源码中全部裸包（有 @types 或包内 dts 时）。
 * 返回可注入 setEnvModules 的 modules 表；无包可 harvest 时为空对象。
 */
export function autoHarvestModules(
  source: string,
  fromDir: string,
): Record<string, Record<string, Abs>> {
  const packages = collectBarePackages(source);
  if (packages.length === 0) return {};
  const modules: Record<string, Record<string, Abs>> = {};
  for (const pkg of packages) {
    const h = harvestPackageCached(pkg, fromDir);
    if (!h) continue;
    for (const [mod, exports] of Object.entries(h.env.modules)) {
      // 模块键可能是相对路径形态；同时登记裸包名与原始键
      modules[mod] = exports;
      if (!modules[pkg]) modules[pkg] = exports;
      // `path` / `node:path` 等别名：basename 匹配
      const base = mod.replace(/^@types\//, "").replace(/\\/g, "/");
      if (base && !modules[base]) modules[base] = exports;
    }
    for (const [k, v] of Object.entries(h.env.globals)) {
      // 全局 API 也挂一份到包名模块，供 default/namespace 消费
      if (!modules[pkg]) modules[pkg] = {};
      if (modules[pkg]![k] === undefined) modules[pkg]![k] = v;
    }
  }
  return modules;
}
