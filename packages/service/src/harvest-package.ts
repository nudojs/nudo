/**
 * Host：从 npm 包 / @types 收集 .d.ts → harvestDts。
 * 代数不碰 fs；这里只做「找到 dts 路径」这一层宿主职责。
 */

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
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

const SKIP_DIRS = new Set(["node_modules", "test", "tests", "docs", "doc", "examples", "__tests__"]);
/** 单文件上限：巨型 lib.d.ts 级别拖垮 harvest */
const MAX_DTS_BYTES = 1_500_000;

/** 优先入口：index.d.ts / pkg 名 / lib 入口 */
function dtsPriority(p: string, root: string): number {
  const base = basename(p);
  const rel = p.slice(root.length);
  if (base === "index.d.ts") return 0;
  if (base === "index.d.mts") return 1;
  if (rel.includes("/types/") && base === "index.d.ts") return 2;
  if (base.endsWith(".d.ts") && !base.includes(".")) return 3; // foo.d.ts
  return 10;
}

/**
 * 递归收集包内 .d.ts（限制数量 + 跳过超大文件 + 入口优先）。
 */
export function collectDtsFiles(root: string, maxFiles = 8): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (out.length >= maxFiles * 3) return; // 多收一点再排序截断
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= maxFiles * 3) return;
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".d.ts") && !name.endsWith(".d.ts.map")) {
        if (st.size > MAX_DTS_BYTES) continue;
        out.push(p);
      }
    }
  };
  walk(root);
  out.sort((a, b) => dtsPriority(a, root) - dtsPriority(b, root) || a.length - b.length);
  return out.slice(0, maxFiles);
}

/** package.json types/typings 入口（若存在且合理大小） */
function entryDtsFromPackageJson(root: string): string | undefined {
  const pj = join(root, "package.json");
  if (!existsSync(pj)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(pj, "utf8")) as {
      types?: string;
      typings?: string;
      exports?: Record<string, unknown>;
    };
    const entry = raw.types ?? raw.typings;
    if (typeof entry === "string" && entry.endsWith(".d.ts")) {
      const p = resolve(root, entry);
      if (existsSync(p)) {
        const st = statSync(p);
        if (st.size <= MAX_DTS_BYTES) return p;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
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
  maxFiles = 8,
): PackageHarvest | { error: string } {
  const root = resolvePackageRoot(pkg, fromDir);
  if (!root) return { error: `package not found: ${pkg}` };
  const entry = entryDtsFromPackageJson(root);
  const collected = collectDtsFiles(root, maxFiles);
  const dtsFiles = entry && !collected.includes(entry)
    ? [entry, ...collected.filter((f) => f !== entry)].slice(0, maxFiles)
    : collected;
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
