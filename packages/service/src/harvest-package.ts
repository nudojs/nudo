/**
 * Host：从 npm 包 / @types 收集 .d.ts → harvestDts。
 * 代数不碰 fs；这里只做「找到 dts 路径」这一层宿主职责。
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { harvestDts, type HarvestedEnv } from "@nudojs/harvester";
import { typeValueToString, type TypeValue } from "@nudojs/core";

/** 在 node_modules 中解析包根（含 @types/*） */
export function resolvePackageRoot(
  pkg: string,
  fromDir: string = process.cwd(),
): string | undefined {
  let dir = resolve(fromDir);
  const candidates = [
    join(dir, "node_modules", pkg),
    join(dir, "node_modules", "@types", pkg.replace(/^@/, "").replace(/\//g, "__")),
  ];
  // 向上找 node_modules
  for (let i = 0; i < 8; i++) {
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** 递归收集包内 .d.ts（限制数量防爆炸） */
export function collectDtsFiles(root: string, maxFiles = 8): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (out.length >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= maxFiles) return;
      if (name === "node_modules" || name === "test" || name === "tests") continue;
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".d.ts") && !name.endsWith(".d.ts.map")) out.push(p);
    }
  };
  walk(root);
  return out;
}

export type PackageHarvest = {
  pkg: string;
  root: string;
  dtsFiles: string[];
  env: HarvestedEnv;
};

/** harvest 一个 npm 包（或 @types 包） */
export function harvestPackage(
  pkg: string,
  fromDir?: string,
): PackageHarvest | { error: string } {
  const root = resolvePackageRoot(pkg, fromDir);
  if (!root) return { error: `package not found: ${pkg}` };
  const dtsFiles = collectDtsFiles(root);
  if (dtsFiles.length === 0) {
    return { error: `no .d.ts under ${root}` };
  }
  const env = harvestDts(dtsFiles);
  return { pkg, root, dtsFiles, env };
}

/** harvest 结果 → 人类可读导出表 */
export function formatHarvestSummary(h: PackageHarvest): string {
  const lines: string[] = [];
  lines.push(`${h.pkg}: ${h.dtsFiles.length} d.ts, ${h.env.stats.symbols} symbols`);
  const mods = Object.keys(h.env.modules);
  for (const m of mods.slice(0, 5)) {
    const exports = h.env.modules[m]!;
    const names = Object.keys(exports).slice(0, 12);
    lines.push(`  module "${m}": ${names.join(", ")}${Object.keys(exports).length > 12 ? "…" : ""}`);
  }
  if (mods.length > 5) lines.push(`  … ${mods.length - 5} more modules`);
  return lines.join("\n");
}

/** 取某个导出的 TypeValue 字符串 */
export function lookupHarvested(
  h: PackageHarvest,
  moduleName: string,
  exportName: string,
): string | undefined {
  const mod = h.env.modules[moduleName];
  const tv = mod?.[exportName] ?? h.env.globals[exportName];
  if (!tv) return undefined;
  return typeValueToString(tv as TypeValue);
}
