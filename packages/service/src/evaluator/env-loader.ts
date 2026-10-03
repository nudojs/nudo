import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve as resolvePath, join as joinPath } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { type Abs, type Environment } from "@nudojs/core";
import { defineEnv as defineEsEnv } from "@nudojs/env/es";
import { defineEnv as defineWebEnv } from "@nudojs/env/web";
import { defineEnv as defineNodeEnv } from "@nudojs/env/node";
import { BoundedLruMap } from "../lru-map.ts";

/** Abs 原生 env 定义（内置 es/web/node 与 harvest 产物） */
type EnvDefinition = {
  globals: Record<string, Abs>;
  modules?: Record<string, Record<string, Abs>>;
};

const envFactories: Record<string, () => EnvDefinition> = {
  es: defineEsEnv,
  web: defineWebEnv,
  node: defineNodeEnv,
};

const impliedDeps: Record<string, string[]> = {
  web: ["es"],
  node: ["es"],
};

function resolveEnvNames(names: string[]): string[] {
  const resolved = new Set<string>();
  const visit = (name: string) => {
    if (resolved.has(name)) return;
    const deps = impliedDeps[name];
    if (deps) deps.forEach(visit);
    resolved.add(name);
  };
  names.forEach(visit);
  return [...resolved];
}

export type LoadedEnv = {
  /** Abs 原生模块导出（求值引擎 / Abs 模块图） */
  modules: Record<string, Record<string, Abs>>;
  globals: Record<string, Abs>;
};

// Path-based env files (`/// @nudo:env ./nudo-harvest-node.ts`) are imported
// asynchronously and cached here; the sync loadEnvs() below consults this map
// so sync consumers (analyzeFile & friends) see them after a preload pass.
//
// 上限 PATH_ENV_CACHE_MAX / PATH_ENV_BY_PATH_MAX / PATH_ENV_BASE_DIRS_MAX + LRU：
// 命中/写入移到队尾，超限删最旧。条目是 defineEnv 工厂（闭包持 HarvestedEnv
// 级 globals/modules），故必须有界；clearPathEnvCaches 语义不变。
const PATH_ENV_CACHE_MAX = 64;
const PATH_ENV_BY_PATH_MAX = 64;
const PATH_ENV_BASE_DIRS_MAX = 64;
const pathEnvCache = new BoundedLruMap<() => EnvDefinition>(PATH_ENV_CACHE_MAX);
// resolvedPath → factory; looked up by trying the directive spelling as-is and
// resolved against every baseDir seen during preload (covers `./env.ts`,
// `../env.ts`, and bare `env.ts` spellings from different analyzed files).
const pathEnvByPath = new BoundedLruMap<{ factory: () => EnvDefinition; mtimeMs: number }>(PATH_ENV_BY_PATH_MAX);
// Set 保持插入序；超上限时删最旧 baseDir（LRU 等价——最近 preload 的排到尾）。
const pathEnvBaseDirs = new Set<string>();

function addPathEnvBaseDir(baseDir: string): void {
  pathEnvBaseDirs.delete(baseDir);
  pathEnvBaseDirs.add(baseDir);
  while (pathEnvBaseDirs.size > PATH_ENV_BASE_DIRS_MAX) {
    const oldest = pathEnvBaseDirs.values().next().value;
    if (oldest === undefined) break;
    pathEnvBaseDirs.delete(oldest);
  }
}

/** 测试/诊断：path-env 驻留规模（均 ≤ 对应上限） */
export function getPathEnvCacheSizes(): { byKey: number; byPath: number; baseDirs: number } {
  return {
    byKey: pathEnvCache.size,
    byPath: pathEnvByPath.size,
    baseDirs: pathEnvBaseDirs.size,
  };
}

function isPathEnvName(name: string, baseDir: string): boolean {
  if (name in envFactories) return false;
  if (name.includes("/") || name.startsWith("./") || name.startsWith("../")) return true;
  const resolved = resolvePath(baseDir, name);
  return resolved.endsWith(".ts") && existsSync(resolved);
}

// A harvested env file lives anywhere on disk (e.g. /tmp) and imports
// "@nudojs/core" — a bare specifier that only resolves from inside the repo's
// packages. When the direct import fails, rewrite those specifiers to absolute
// file URLs (resolved from this package, which depends on them) and import a
// cached copy under the OS tmpdir.
 function rewriteBareImports(text: string): string | null {
  const require = createRequire(import.meta.url);
  let rewrote = false;
  // 子路径 specifier（`@nudojs/env/es`、`@nudojs/core/xyz`）也须重写；
  // 原正则只认裸包名，子路径无法匹配 → env 文件被静默丢弃（issue #88）。
  const out = text.replace(/(["'])(@nudojs\/[a-z0-9-]+(?:\/[^"']+)*)\1/g, (_m, quote: string, spec: string) => {
    try {
      const entry = require.resolve(spec);
      const url = pathToFileURL(entry).href;
      rewrote = true;
      return `${quote}${url}${quote}`;
    } catch {
      return `${quote}${spec}${quote}`;
    }
  });
  return rewrote ? out : null;
}

async function importPathEnv(resolvedPath: string, mtimeMs: number): Promise<void> {
  const cacheKey = `${resolvedPath}:${mtimeMs}`;
  // get 触发 LRU 触摸（命中仍返回同一 factory）
  if (pathEnvCache.get(cacheKey)) return;

  let mod: { defineEnv?: unknown } | null = null;
  let directErr: unknown = null;
  try {
    const url = pathToFileURL(resolvedPath).href + `?mtime=${mtimeMs}`;
    mod = (await import(url)) as { defineEnv?: unknown };
  } catch (e) {
    // Fall through to the rewritten-copy fallback below.
    directErr = e;
    mod = null;
  }

  if (!mod) {
    try {
      const text = readFileSync(resolvedPath, "utf-8");
      const rewritten = rewriteBareImports(text);
      if (rewritten === null) {
        recordPathEnvError(resolvedPath, directErr); // 无可重写 → import 失败原因上报
        return;
      }
      const cacheDir = joinPath(tmpdir(), "nudo-env");
      mkdirSync(cacheDir, { recursive: true });
      const hash = createHash("md5").update(`${resolvedPath}:${mtimeMs}`).digest("hex").slice(0, 16);
      const copyPath = joinPath(cacheDir, `${hash}.ts`);
      writeFileSync(copyPath, rewritten, "utf-8");
      mod = (await import(pathToFileURL(copyPath).href)) as { defineEnv?: unknown };
    } catch (e) {
      recordPathEnvError(resolvedPath, e);
      return;
    }
  }

  if (mod && typeof mod.defineEnv === "function") {
    pathEnvCache.set(cacheKey, mod.defineEnv as () => EnvDefinition);
    pathEnvByPath.set(resolvedPath, {
      factory: mod.defineEnv as () => EnvDefinition,
      mtimeMs,
    });
    pathEnvFiles.set(resolvedPath, mtimeMs);
    clearPathEnvError(resolvedPath);
  }
}

function lookupPathEnv(name: string): (() => EnvDefinition) | undefined {
  if (pathEnvByPath.size === 0) return undefined;
  const candidates = name.startsWith("/")
    ? [name]
    : [name, ...[...pathEnvBaseDirs].map((d) => resolvePath(d, name))];
  for (const candidate of candidates) {
    const hit = pathEnvByPath.get(candidate);
    if (!hit) continue;
    // mtime 变了 → 丢弃陈旧 factory（下次 preload 会重 import）
    try {
      const { mtimeMs } = statSync(candidate);
      if (mtimeMs !== hit.mtimeMs) {
        pathEnvByPath.delete(candidate);
        return undefined;
      }
    } catch {
      pathEnvByPath.delete(candidate);
      return undefined;
    }
    return hit.factory;
  }
  return undefined;
}

/** Host cache-clear hooks (CLI watch / vite / tests) must drop path-env modules too */
export function clearPathEnvCaches(): void {
  pathEnvCache.clear();
  pathEnvByPath.clear();
  pathEnvBaseDirs.clear();
  pathEnvFiles.clear();
  pathEnvLoadErrors.length = 0;
}

// path env 文件级诊断（import 失败必须可见——issue #88）与缓存指纹
const pathEnvFiles = new Map<string, number>();
const pathEnvLoadErrors: Array<{ path: string; error: string }> = [];

function recordPathEnvError(path: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  // 去重补充：同一 path 保留最新错误
  const i = pathEnvLoadErrors.findIndex((x) => x.path === path);
  if (i >= 0) pathEnvLoadErrors[i] = { path, error: msg };
  else pathEnvLoadErrors.push({ path, error: msg });
}

function clearPathEnvError(path: string): void {
  const i = pathEnvLoadErrors.findIndex((x) => x.path === path);
  if (i >= 0) pathEnvLoadErrors.splice(i, 1);
}

/** path env 加载失败诊断（check/test 打印 nudo:env-unresolved warning 用） */
export function getPathEnvLoadErrors(): Array<{ path: string; error: string }> {
  return [...pathEnvLoadErrors];
}

/** 已成功预载的 path env 文件（供 check 磁盘缓存指纹纳入 sha） */
export function getPathEnvDepContents(): Array<{ path: string; content: string | null }> {
  const out: Array<{ path: string; content: string | null }> = [];
  for (const p of pathEnvFiles.keys()) {
    let content: string | null = null;
    try {
      content = readFileSync(p, "utf-8");
    } catch {
      content = null;
    }
    out.push({ path: p, content });
  }
  return out;
}

export async function preloadPathEnvs(envNames: string[], baseDir: string): Promise<void> {
  addPathEnvBaseDir(baseDir);
  for (const name of envNames) {
    if (!isPathEnvName(name, baseDir)) continue;
    const resolved = resolvePath(baseDir, name);
    if (!existsSync(resolved)) continue; // silent skip, matching registry behavior
    try {
      const { mtimeMs } = statSync(resolved);
      await importPathEnv(resolved, mtimeMs);
    } catch (e) {
      recordPathEnvError(resolved, e);
    }
  }
}

export async function loadEnvsAsync(
  envNames: string[],
  globalEnv: Environment,
  baseDir: string = process.cwd(),
): Promise<LoadedEnv> {
  await preloadPathEnvs(envNames, baseDir);
  return loadEnvs(envNames, globalEnv);
}

export function loadEnvs(envNames: string[], globalEnv: Environment): LoadedEnv {
  const allModules: Record<string, Record<string, Abs>> = {};
  const allGlobals: Record<string, Abs> = {};
  const resolved = resolveEnvNames(envNames);

  for (const name of resolved) {
    const factory = envFactories[name] ?? lookupPathEnv(name);
    if (!factory) continue;
    const def = factory();

    for (const [key, value] of Object.entries(def.globals)) {
      allGlobals[key] = value;
      globalEnv.bind(key, value);
    }
    if (def.modules) {
      for (const [modName, exports] of Object.entries(def.modules)) {
        allModules[modName] = { ...allModules[modName], ...exports };
      }
    }
  }

  return { modules: allModules, globals: allGlobals };
}
