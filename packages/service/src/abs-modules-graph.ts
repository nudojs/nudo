/**
 * Host：import 图（相对 + 裸包 harvest）→ Abs 导出表 → 注入入口。
 * 读 fs / 解析路径 / harvest 在这里；core 只收 modules 表。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "@nudojs/parser";
import {
  evalProgramAbs,
  collectAbsExports,
  type Abs,
  type AbsModuleExports,
  type AstEnv,
  type Phi,
} from "@nudojs/core";
import type { Node } from "@babel/types";
import { bareSpecToAbsModules } from "./harvest-to-abs.ts";

export type AbsLoadModule = (spec: string, fromFile: string) => string | undefined;

/** 相对说明符 → 源码 */
export function defaultAbsLoadModule(spec: string, fromFile: string): string | undefined {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
  try {
    const p = resolve(dirname(resolve(fromFile)), spec);
    for (const cand of [p, `${p}.js`, `${p}.mjs`, `${p}.ts`, resolve(p, "index.js")]) {
      try {
        return readFileSync(cand, "utf-8");
      } catch {
        /* next */
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function resolveRel(spec: string, fromFile: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;
  const p = resolve(dirname(resolve(fromFile)), spec);
  for (const cand of [p, `${p}.js`, `${p}.mjs`, `${p}.ts`, resolve(p, "index.js")]) {
    try {
      readFileSync(cand, "utf-8");
      return cand;
    } catch {
      /* next */
    }
  }
  return null;
}

function importSpecs(source: string): string[] {
  try {
    const file = parse(source);
    const out: string[] = [];
    for (const stmt of file.program.body) {
      if (stmt.type === "ImportDeclaration" || stmt.type === "ExportNamedDeclaration") {
        const src = (stmt as { source?: { value: string } }).source;
        if (src && typeof src.value === "string") {
          out.push(src.value);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** 把当前文件的全部 import（相对 + 裸包）编成 modules 表 */
function buildModulesForFile(
  source: string,
  fromFile: string,
  load: AbsLoadModule,
  evalDep: (path: string, src: string, depth: number) => AbsModuleExports,
  depth: number,
  maxDepth: number,
): Record<string, AbsModuleExports> {
  const modules: Record<string, AbsModuleExports> = {};
  for (const spec of importSpecs(source)) {
    if (spec.startsWith(".") || spec.startsWith("/")) {
      const childPath = resolveRel(spec, fromFile);
      if (!childPath) continue;
      const childSrc = load(spec, fromFile);
      if (childSrc === undefined) continue;
      modules[spec] = evalDep(childPath, childSrc, depth + 1);
    } else if (!spec.startsWith("node:")) {
      const bare = bareSpecToAbsModules(spec, fromFile);
      if (bare) modules[spec] = bare;
    }
  }
  void maxDepth;
  return modules;
}

export type AbsModuleGraphResult = {
  /** 入口 import 说明符 → 依赖导出表 */
  modules: Record<string, AbsModuleExports>;
  /** 绝对路径 → 导出表（含依赖；循环时占位为空） */
  byPath: Map<string, AbsModuleExports>;
};

export type AbsGraphOptions = {
  loadModule?: AbsLoadModule;
  seedVars?: Record<string, Abs>;
  seedFns?: Record<string, { params: string[]; body: Node; async?: boolean }>;
  maxDepth?: number;
};

/**
 * 递归求值相对依赖 + 裸包 harvest，产出入口可用的 modules 表。
 * 循环依赖：先放空表再回填（与 TypeValue 路径 partial 口径一致）。
 */
export function evalAbsModuleGraph(
  entrySource: string,
  entryFile: string,
  opts: AbsGraphOptions = {},
): AbsModuleGraphResult {
  const load = opts.loadModule ?? defaultAbsLoadModule;
  const maxDepth = opts.maxDepth ?? 16;
  const cache = new Map<string, AbsModuleExports>();

  function evalDep(absPath: string, source: string, depth: number): AbsModuleExports {
    if (cache.has(absPath)) return cache.get(absPath)!;
    if (depth > maxDepth) {
      const empty: AbsModuleExports = { named: {} };
      cache.set(absPath, empty);
      return empty;
    }
    cache.set(absPath, { named: {} });

    const modules = buildModulesForFile(source, absPath, load, evalDep, depth, maxDepth);

    try {
      const file = parse(source);
      const { env } = evalProgramAbs(source, { file, modules });
      const exports = collectAbsExports(file, env);
      cache.set(absPath, exports);
      return exports;
    } catch {
      const empty: AbsModuleExports = { named: {} };
      cache.set(absPath, empty);
      return empty;
    }
  }

  const modules = buildModulesForFile(
    entrySource,
    entryFile,
    load,
    evalDep,
    0,
    maxDepth,
  );

  return { modules, byPath: cache };
}

/** 便捷：入口求值 + 依赖 Abs 注入 */
export function evalProgramAbsWithModules(
  source: string,
  entryFile: string,
  opts: AbsGraphOptions & { file?: unknown } = {},
): { env: AstEnv; last: Abs; phi: Phi } {
  const { modules } = evalAbsModuleGraph(source, entryFile, opts);
  return evalProgramAbs(source, {
    file: opts.file as never,
    modules,
    seedVars: opts.seedVars,
    seedFns: opts.seedFns,
  });
}
