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

/** JS 入口条件键优先级：browser 进白名单；types 仅兜底（见 pickExport）。 */
const JS_CONDITIONS = ["node", "require", "import", "browser", "default"] as const;

/**
 * 递归展开 exports 目标树：字符串直出；数组按序首个命中（Node fallback 语义，
 * tryTarget 判存在性）；对象按条件键递归。types 仅在所有条件键都未命中时兜底。
 */
function pickExport(
  entry: unknown,
  conditions: readonly string[],
  tryTarget: (rel: string) => string | null,
): string | null {
  if (typeof entry === "string") return tryTarget(entry);
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const r = pickExport(item, conditions, tryTarget);
      if (r) return r;
    }
    return null;
  }
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    for (const k of conditions) {
      if (k in o) {
        const r = pickExport(o[k], conditions, tryTarget);
        if (r) return r;
      }
    }
    // types 仅兜底：主条件键全部 miss 后才尝试
    if ("types" in o) {
      const r = pickExport(o["types"], conditions, tryTarget);
      if (r) return r;
    }
  }
  return null;
}

/**
 * 在 exports 目标树中专找 `nudo` 条件（可嵌套于数组/条件对象深处）。
 * 找到 nudo 子树后用 JS 条件键继续解析（处理 nudo: { import, default } 等嵌套）。
 * 非 nudo 字符串不匹配——那是普通 JS 入口，不属于 sidecar。
 */
function pickNudoExport(
  entry: unknown,
  tryTarget: (rel: string) => string | null,
): string | null {
  if (typeof entry === "string") return null;
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const r = pickNudoExport(item, tryTarget);
      if (r) return r;
    }
    return null;
  }
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    if ("nudo" in o) {
      return pickExport(o["nudo"], JS_CONDITIONS, tryTarget);
    }
    for (const v of Object.values(o)) {
      const r = pickNudoExport(v, tryTarget);
      if (r) return r;
    }
  }
  return null;
}

type ExportsEntry = { target: unknown; substitution: string | null };

/**
 * 在 exports map 中定位 subpath 的原始目标（精确键优先，其次模式键 `./x/*`）。
 * 模式键返回 * 捕获段（substitution），供目标字符串替换。
 */
function findExportsEntry(exportsField: unknown, subpath: string): ExportsEntry | null {
  const key = subpath === "." ? "." : `./${subpath}`;

  if (typeof exportsField === "string") {
    return subpath === "." ? { target: exportsField, substitution: null } : null;
  }
  if (!exportsField || typeof exportsField !== "object") return null;

  const map = exportsField as Record<string, unknown>;

  // 精确键
  if (key in map) {
    return { target: map[key], substitution: null };
  }

  // 模式键：`./x/*` → 目标 `*` 替换（单 `*`，Node subpath patterns 同向）
  if (subpath !== ".") {
    let best: { target: unknown; substitution: string; prefixLen: number } | null = null;
    for (const [patternKey, target] of Object.entries(map)) {
      const starIdx = patternKey.indexOf("*");
      if (starIdx === -1) continue;
      if (patternKey.indexOf("*", starIdx + 1) !== -1) continue; // 仅支持单 *

      const prefix = patternKey.slice(0, starIdx);
      const suffix = patternKey.slice(starIdx + 1);
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      if (key.length < prefix.length + suffix.length) continue;

      const substitution = key.slice(prefix.length, key.length - suffix.length);
      if (!best || prefix.length > best.prefixLen) {
        best = { target, substitution, prefixLen: prefix.length };
      }
    }
    if (best) return { target: best.target, substitution: best.substitution };
  }

  // 顶层条件对象（无 ./ 键）：exports: { "require": ..., "default": ... } 糖式主入口
  if (subpath === "." && !("." in map)) {
    const keys = Object.keys(map);
    if (keys.length > 0 && keys.every((k) => !k.startsWith("."))) {
      return { target: map, substitution: null };
    }
  }

  return null;
}

/** 基于 substitution 生成 tryTarget：先替换 *，再检查文件存在性。 */
function makeTryTarget(
  pkgDir: string,
  substitution: string | null,
  tryFile: (p: string) => string | null,
): (rel: string) => string | null {
  return (rel: string) => {
    const substituted = substitution !== null ? rel.replace("*", substitution) : rel;
    return tryFile(resolve(pkgDir, substituted));
  };
}

/** resolveNpmJsEntry 详细结果：路径 + exports 声明未命中标志。 */
export type ResolveNpmJsEntryResult = {
  path: string | null;
  /** package.json 确有 exports 声明但当前 subpath 未命中（或目标文件缺失）。 */
  exportsUnresolved: boolean;
};

/**
 * A3：裸包可执行入口（.js/.cjs/.mjs）。有源码就走 eval 执行，而不是 harvest stub
 * （ms/debug 等纯 JS 包的返回面由此从 unknown 变成真实折叠）。
 */
export function resolveNpmJsEntryDetailed(
  source: string,
  fromDir: string,
): ResolveNpmJsEntryResult {
  const none: ResolveNpmJsEntryResult = { path: null, exportsUnresolved: false };
  if (!source || source.startsWith(".") || source.startsWith("/") || source.startsWith("node:")) {
    return none;
  }
  const parts = source.startsWith("@")
    ? source.split("/").slice(0, 2)
    : source.split("/").slice(0, 1);
  const pkgName = parts.join("/");
  const subpath = source.slice(pkgName.length).replace(/^\//, "") || ".";

  const nodeModules = findNodeModules(fromDir);
  if (!nodeModules) return none;
  const pkgDir = join(nodeModules, pkgName);
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return none;

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
    return none;
  }

  const exportsField = pkg.exports;
  let exportsUnresolved = false;

  if (exportsField !== undefined && exportsField !== null) {
    const entry = findExportsEntry(exportsField, subpath);
    if (entry) {
      const tryTarget = makeTryTarget(pkgDir, entry.substitution, tryFile);
      const rel = pickExport(entry.target, JS_CONDITIONS, tryTarget);
      if (rel) return { path: rel, exportsUnresolved: false };
    }
    // 有 exports 声明但未命中（键不匹配或目标文件缺失）
    exportsUnresolved = true;
  }

  if (subpath === ".") {
    const main = typeof pkg.main === "string" ? pkg.main : undefined;
    const hit = tryFile(resolve(pkgDir, main ?? "."));
    if (hit) return { path: hit, exportsUnresolved };
    const mod = typeof pkg.module === "string" ? pkg.module : undefined;
    if (mod) {
      const hitMod = tryFile(resolve(pkgDir, mod));
      if (hitMod) return { path: hitMod, exportsUnresolved };
    }
    return { path: null, exportsUnresolved };
  }
  return { path: tryFile(resolve(pkgDir, subpath)), exportsUnresolved };
}

/** 兼容包装：只取路径。 */
export function resolveNpmJsEntry(
  source: string,
  fromDir: string,
): string | null {
  return resolveNpmJsEntryDetailed(source, fromDir).path;
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
  // exports 键是 "./sub" / "."，不是 "/sub"（与 resolveNpmJsEntry 同口径）
  const subpath = source.slice(pkgName.length).replace(/^\//, "") || ".";

  const nodeModules = findNodeModules(fromDir);
  if (!nodeModules) return null;

  const pkgDir = join(nodeModules, pkgName);
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
    const exportsField = pkg.exports;
    if (exportsField === undefined || exportsField === null) return null;

    const entry = findExportsEntry(exportsField, subpath);
    if (!entry) return null;

    const tryFile = (p: string): string | null => {
      try {
        if (existsSync(p) && statSync(p).isFile()) return p;
      } catch {
        /* ignore */
      }
      return null;
    };
    const tryTarget = makeTryTarget(pkgDir, entry.substitution, tryFile);
    return pickNudoExport(entry.target, tryTarget);
  } catch {
    // ignore parse errors
  }

  return null;
}
