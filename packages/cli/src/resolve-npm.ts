import { readFileSync, existsSync } from "node:fs";
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
