/**
 * harvest 自动化：源码裸 import → @types/package → env modules。
 * 手动 `nudo harvest` 仍保留；这里是分析路径上的按需注入。
 */

import { parse } from "@nudojs/parser";
import type { Abs } from "@nudojs/core";
import { collectDependencySpecs } from "./static-imports.ts";
import { harvestPackage, type PackageHarvest } from "./harvest-package.ts";

/** 裸说明符 → 包名（含 scope）；相对/绝对/node: 内建返回 undefined */
export function barePackageName(spec: string): string | undefined {
  if (!spec) return undefined;
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) return undefined;
  const parts = spec.split("/");
  if (spec.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  }
  return parts[0];
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

/** 进程内 harvest 缓存：同包只 walk 一次 dts */
const harvestCache = new Map<string, PackageHarvest | null>();

export function harvestPackageCached(pkg: string, fromDir: string): PackageHarvest | null {
  const key = `${fromDir}::${pkg}`;
  if (harvestCache.has(key)) return harvestCache.get(key)!;
  let result: PackageHarvest | null = null;
  try {
    const h = harvestPackage(pkg, fromDir);
    if (!("error" in h)) result = h;
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
