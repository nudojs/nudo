import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

function findNodeModules(startDir: string): string | null {
  let dir = resolve(startDir);
  const root = resolve("/");

  while (dir !== root) {
    const nmPath = join(dir, "node_modules");
    if (existsSync(nmPath)) return nmPath;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * A3：裸包可执行入口（.js/.cjs/.mjs）。有源码就走 B 执行，而不是 harvest stub
 * （ms/debug 等纯 JS 包的返回面由此从 unknown 变成真实折叠）。
 */
export function resolveNpmJsEntry(
  source: string,
  fromDir: string,
): string | null {
  if (!source || source.startsWith(".") || source.startsWith("/") || source.startsWith("node:")) {
    return null;
  }
  const parts = source.startsWith("@")
    ? source.split("/").slice(0, 2)
    : source.split("/").slice(0, 1);
  const pkgName = parts.join("/");
  const subpath = source.slice(pkgName.length).replace(/^\//, "") || ".";

  const nodeModules = findNodeModules(fromDir);
  if (!nodeModules) return null;
  const pkgDir = join(nodeModules, pkgName);
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return null;

  const tryFile = (p: string): string | null => {
    for (const c of [p, `${p}.js`, `${p}.cjs`, `${p}.mjs`, join(p, "index.js"), join(p, "index.cjs")]) {
      try {
        if (existsSync(c) && statSync(c).isFile()) return c;
      } catch {
        /* ignore */
      }
    }
    return null;
  };

  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  // exports["."] / exports 子路径（仅字符串或 {require,default,node} 字符串）
  const exportsField = pkg.exports;
  const pickExport = (entry: unknown): string | null => {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      for (const k of ["nudo", "node", "require", "import", "default"]) {
        const v = o[k];
        const r = pickExport(v);
        if (r) return r;
      }
    }
    return null;
  };
  if (exportsField) {
    let rel: string | null = null;
    if (typeof exportsField === "string" && subpath === ".") rel = exportsField;
    else if (exportsField && typeof exportsField === "object") {
      const map = exportsField as Record<string, unknown>;
      const key = subpath === "." ? "." : `./${subpath}`;
      rel = pickExport(map[key] ?? (subpath === "." ? map : undefined));
    }
    if (rel) {
      const hit = tryFile(resolve(pkgDir, rel));
      if (hit) return hit;
    }
  }

  if (subpath === ".") {
    const main = typeof pkg.main === "string" ? pkg.main : undefined;
    const hit = tryFile(resolve(pkgDir, main ?? "."));
    if (hit) return hit;
    const mod = typeof pkg.module === "string" ? pkg.module : undefined;
    if (mod) {
      const hitMod = tryFile(resolve(pkgDir, mod));
      if (hitMod) return hitMod;
    }
    return null;
  }
  return tryFile(resolve(pkgDir, subpath));
}

function resolveExportsNudo(exports: unknown, subpath: string): string | null {
  if (!exports || typeof exports !== "object") return null;

  const entry = (exports as Record<string, unknown>)[subpath];
  if (!entry) return null;

  if (typeof entry === "object" && entry !== null && "nudo" in entry) {
    const nudoEntry = (entry as Record<string, unknown>)["nudo"];
    if (typeof nudoEntry === "string") return nudoEntry;
  }

  return null;
}

export function resolveNpmNudo(
  source: string,
  fromDir: string,
): string | null {
  const isRelative = source.startsWith(".") || source.startsWith("/");
  if (isRelative) return null;

  const parts = source.startsWith("@")
    ? source.split("/").slice(0, 2)
    : source.split("/").slice(0, 1);
  const pkgName = parts.join("/");
  const subpath = source.slice(pkgName.length) || ".";

  const nodeModules = findNodeModules(fromDir);
  if (!nodeModules) return null;

  const pkgJsonPath = join(nodeModules, pkgName, "package.json");
  if (!existsSync(pkgJsonPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    const nudoEntry = resolveExportsNudo(pkg.exports, subpath);
    if (nudoEntry) {
      const resolved = resolve(dirname(pkgJsonPath), nudoEntry);
      if (existsSync(resolved)) return resolved;
    }
  } catch {
    // ignore parse errors
  }

  return null;
}
