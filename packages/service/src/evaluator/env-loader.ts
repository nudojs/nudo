import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve as resolvePath, join as joinPath } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import {
  type Abs,
  type TypeValue,
  type Environment,
  absToTypeValue,
} from "@nudojs/core";
import { defineEnv as defineEsEnv } from "@nudojs/env/es";
import { defineEnv as defineWebEnv } from "@nudojs/env/web";
import { defineEnv as defineNodeEnv } from "@nudojs/env/node";
import { envValueToAbs } from "../env-to-abs.ts";

/** Abs 原生 env 定义（内置 es/web/node） */
type AbsEnvDefinition = {
  globals: Record<string, Abs>;
  modules?: Record<string, Record<string, Abs>>;
};

/** path 型 / harvester 生成的 TypeValue 定义（兼容） */
type TvEnvDefinition = {
  globals: Record<string, TypeValue>;
  modules?: Record<string, Record<string, TypeValue>>;
};

type EnvDefinition = AbsEnvDefinition | TvEnvDefinition;

function isAbsEnv(def: EnvDefinition): def is AbsEnvDefinition {
  const sample = Object.values(def.globals)[0];
  return !!sample && typeof sample === "object" && "shape" in sample && "conf" in sample;
}

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
  /** Abs 原生模块导出（B 路径 / Abs 模块图） */
  modules: Record<string, Record<string, Abs>>;
  /** TypeValue 投影（Environment 绑定 / BindingInfo.type 占位） */
  modulesTV: Record<string, Record<string, TypeValue>>;
  globals: Record<string, Abs>;
};

// Path-based env files (`/// @nudo:env ./nudo-harvest-node.ts`) are imported
// asynchronously and cached here; the sync loadEnvs() below consults this map
// so sync consumers (analyzeFile & friends) see them after a preload pass.
const pathEnvCache = new Map<string, () => EnvDefinition>();
// resolvedPath → factory; looked up by trying the directive spelling as-is and
// resolved against every baseDir seen during preload (covers `./env.ts`,
// `../env.ts`, and bare `env.ts` spellings from different analyzed files).
const pathEnvByPath = new Map<string, () => EnvDefinition>();
const pathEnvBaseDirs = new Set<string>();

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
  const out = text.replace(/(["'])(@nudojs\/[a-z0-9-]+)\1/g, (_m, quote: string, spec: string) => {
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
  if (pathEnvCache.has(cacheKey)) return;

  let mod: { defineEnv?: unknown } | null = null;
  try {
    const url = pathToFileURL(resolvedPath).href + `?mtime=${mtimeMs}`;
    mod = (await import(url)) as { defineEnv?: unknown };
  } catch {
    // Fall through to the rewritten-copy fallback below.
    mod = null;
  }

  if (!mod) {
    try {
      const text = readFileSync(resolvedPath, "utf-8");
      const rewritten = rewriteBareImports(text);
      if (rewritten === null) return; // nothing to fix; the import failure was something else
      const cacheDir = joinPath(tmpdir(), "nudo-env");
      mkdirSync(cacheDir, { recursive: true });
      const hash = createHash("md5").update(`${resolvedPath}:${mtimeMs}`).digest("hex").slice(0, 16);
      const copyPath = joinPath(cacheDir, `${hash}.ts`);
      writeFileSync(copyPath, rewritten, "utf-8");
      mod = (await import(pathToFileURL(copyPath).href)) as { defineEnv?: unknown };
    } catch {
      return;
    }
  }

  if (mod && typeof mod.defineEnv === "function") {
    pathEnvCache.set(cacheKey, mod.defineEnv as () => EnvDefinition);
    pathEnvByPath.set(resolvedPath, mod.defineEnv as () => EnvDefinition);
  }
}

function lookupPathEnv(name: string): (() => EnvDefinition) | undefined {
  if (pathEnvByPath.size === 0) return undefined;
  const candidates = name.startsWith("/")
    ? [name]
    : [name, ...[...pathEnvBaseDirs].map((d) => resolvePath(d, name))];
  for (const candidate of candidates) {
    const hit = pathEnvByPath.get(candidate);
    if (hit) return hit;
  }
  return undefined;
}

export async function preloadPathEnvs(envNames: string[], baseDir: string): Promise<void> {
  pathEnvBaseDirs.add(baseDir);
  for (const name of envNames) {
    if (!isPathEnvName(name, baseDir)) continue;
    const resolved = resolvePath(baseDir, name);
    if (!existsSync(resolved)) continue; // silent skip, matching registry behavior
    try {
      const { mtimeMs } = statSync(resolved);
      await importPathEnv(resolved, mtimeMs);
    } catch {
      // unreadable/unstattable — skip
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

/** TypeValue env 定义 → Abs + TypeValue 投影 */
function normalizeTvDef(def: TvEnvDefinition): {
  globals: Record<string, Abs>;
  globalsTV: Record<string, TypeValue>;
  modules: Record<string, Record<string, Abs>>;
  modulesTV: Record<string, Record<string, TypeValue>>;
} {
  const globals: Record<string, Abs> = {};
  for (const [k, v] of Object.entries(def.globals)) {
    globals[k] = envValueToAbs(v);
  }
  const modules: Record<string, Record<string, Abs>> = {};
  const modulesTV: Record<string, Record<string, TypeValue>> = {};
  if (def.modules) {
    for (const [modName, exports] of Object.entries(def.modules)) {
      const named: Record<string, Abs> = {};
      for (const [k, v] of Object.entries(exports)) {
        named[k] = envValueToAbs(v);
      }
      modules[modName] = named;
      modulesTV[modName] = { ...exports };
    }
  }
  return { globals, globalsTV: def.globals, modules, modulesTV };
}

export function loadEnvs(envNames: string[], globalEnv: Environment): LoadedEnv {
  const allModules: Record<string, Record<string, Abs>> = {};
  const allModulesTV: Record<string, Record<string, TypeValue>> = {};
  const allGlobals: Record<string, Abs> = {};
  const resolved = resolveEnvNames(envNames);

  for (const name of resolved) {
    const factory = envFactories[name] ?? lookupPathEnv(name);
    if (!factory) continue;
    const def = factory();

    if (isAbsEnv(def)) {
      for (const [key, value] of Object.entries(def.globals)) {
        allGlobals[key] = value;
        globalEnv.bind(key, value);
      }
      if (def.modules) {
        for (const [modName, exports] of Object.entries(def.modules)) {
          allModules[modName] = { ...allModules[modName], ...exports };
          const tvExports: Record<string, TypeValue> = {};
          for (const [k, v] of Object.entries(exports)) {
            tvExports[k] = absToTypeValue(v);
          }
          allModulesTV[modName] = { ...allModulesTV[modName], ...tvExports };
        }
      }
    } else {
      const norm = normalizeTvDef(def);
      for (const [key, value] of Object.entries(norm.globals)) {
        allGlobals[key] = value;
        globalEnv.bind(key, value);
      }
      for (const [modName, exports] of Object.entries(norm.modules)) {
        allModules[modName] = { ...allModules[modName], ...exports };
      }
      for (const [modName, exports] of Object.entries(norm.modulesTV)) {
        allModulesTV[modName] = { ...allModulesTV[modName], ...exports };
      }
    }
  }

  return { modules: allModules, modulesTV: allModulesTV, globals: allGlobals };
}
