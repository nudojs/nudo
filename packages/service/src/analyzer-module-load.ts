/**
 * module-load 背面：resolveModule / 相对 import 图 / 脏集 / 拓扑序。
 * 自 analyzer.ts 机械拆出；语义未改。
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse } from "@nudojs/parser";
import { resolveNpmNudo } from "./evaluator/resolve-npm.ts";

export function resolveModule(source: string, fromDir: string): { ast: ReturnType<typeof parse>; filePath: string; json?: unknown } | null {
  const extensions = [".js", ".ts", ".mjs"];

  const nudoPath = resolveNpmNudo(source, fromDir);
  if (nudoPath) {
    const src = readFileSync(nudoPath, "utf-8");
    return { ast: parse(src), filePath: nudoPath };
  }

  const basePath = resolve(fromDir, source);
  for (const ext of ["", ...extensions]) {
    const candidate = basePath + ext;
    if (!existsSync(candidate)) continue;
    // 目录：按 package.json main / index.js 解析（require('..') 模式）
    if (statSync(candidate).isDirectory()) {
      let entry: string | null = null;
      const pkgPath = resolve(candidate, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const main = JSON.parse(readFileSync(pkgPath, "utf-8")).main;
          if (typeof main === "string") {
            for (const e of ["", ...extensions]) {
              const p = resolve(candidate, main + e);
              if (existsSync(p) && statSync(p).isFile()) { entry = p; break; }
            }
          }
        } catch { /* 无效 package.json → fallback index */ }
      }
      if (!entry) {
        for (const e of ["", ...extensions]) {
          const p = resolve(candidate, "index" + e);
          if (existsSync(p) && statSync(p).isFile()) { entry = p; break; }
        }
      }
      if (!entry) return null;
      const src = readFileSync(entry, "utf-8");
      return { ast: parse(src), filePath: entry };
    }
    // .json 模块：require('../package.json') 等模式——按 JSON 求值而非 JS parse
    if (candidate.endsWith(".json")) {
      try {
        return { ast: parse("module.exports = undefined;"), filePath: candidate, json: JSON.parse(readFileSync(candidate, "utf-8")) };
      } catch {
        return null;
      }
    }
    const src = readFileSync(candidate, "utf-8");
    return { ast: parse(src), filePath: candidate };
  }
  return null;
}

/** Resolve a relative import specifier to an existing file (extension rules identical to CLI resolveModule: ''/'.js'/'.ts'/'.mjs'); null when unresolvable. */
function resolveImportPath(specifier: string, fromDir: string): string | null {
  const basePath = resolve(fromDir, specifier);
  for (const ext of ["", ".js", ".ts", ".mjs"]) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** mtime 边缓存：key 为文件路径，edges 为已抽取的相对 import 边（与 buildModuleGraph 返回语义一致）。 */
export type ModuleGraphCache = Map<string, { mtimeMs: number; size: number; edges: string[] }>;

/** Statically extract each file's relative import edges (extension resolution identical to CLI resolveModule: ''/'.js'/'.ts'/'.mjs'; bare npm specifiers skipped). */
export function buildModuleGraph(
  files: string[],
  cache?: ModuleGraphCache,
): {
  imports: Map<string, Set<string>>;
  dependents: Map<string, Set<string>>;
} {
  const imports = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  const edge = (from: string, to: string) => {
    if (!imports.has(from)) imports.set(from, new Set());
    if (!dependents.has(to)) dependents.set(to, new Set());
    imports.get(from)!.add(to);
    dependents.get(to)!.add(from);
  };
  for (const file of files) {
    if (!imports.has(file)) imports.set(file, new Set());
    if (!dependents.has(file)) dependents.set(file, new Set());
    let edges: string[];
    if (cache) {
      // stat 仅取元数据不读内容；mtimeMs+size 均一致视为命中，复用边并跳过磁盘读取与解析
      let stat: ReturnType<typeof statSync> | null = null;
      try {
        stat = statSync(file);
      } catch {
        /* stat 失败（文件被删等）按未命中处理，走直读兜底 */
      }
      const cached = stat ? cache.get(file) : undefined;
      if (stat && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        edges = cached.edges;
      } else {
        edges = extractImportEdges(file);
        if (stat) cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, edges });
      }
    } else {
      edges = extractImportEdges(file);
    }
    for (const to of edges) edge(file, to);
  }
  return { imports, dependents };
}

/** 磁盘直读并解析单个文件，抽取其相对 import 边（读取/解析失败返回空数组）。 */
function extractImportEdges(file: string): string[] {
  const edges: string[] = [];
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(readFileSync(file, "utf-8"));
  } catch {
    return edges;
  }
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const specifier = stmt.source.value;
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) continue;
    const resolved = resolveImportPath(specifier, dirname(file));
    if (resolved) edges.push(resolved);
  }
  return edges;
}

/** changed plus its transitive dependents (reverse-edge BFS); cycle-safe via visited. */
export function computeDirtySet(dependents: Map<string, Set<string>>, changedFile: string): string[] {
  const dirty: string[] = [];
  const visited = new Set<string>();
  const queue = [changedFile];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    dirty.push(file);
    for (const dep of dependents.get(file) ?? []) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }
  return dirty;
}

/** Topological order with dependencies before dependents (only imports edges internal to dirty; cycles tolerated — remaining files appended in arbitrary order). */
export function topoSortDirty(imports: Map<string, Set<string>>, dirty: string[]): string[] {
  const inSet = new Set(dirty);
  const pending = new Map<string, number>();
  for (const file of dirty) {
    let count = 0;
    for (const dep of imports.get(file) ?? []) {
      if (inSet.has(dep)) count++;
    }
    pending.set(file, count);
  }
  const ordered: string[] = [];
  const ready = dirty.filter((f) => pending.get(f) === 0);
  while (ready.length > 0) {
    const file = ready.shift()!;
    ordered.push(file);
    for (const other of dirty) {
      if (pending.get(other) === undefined) continue;
      if ((imports.get(other) ?? new Set<string>()).has(file)) {
        const next = pending.get(other)! - 1;
        pending.set(other, next);
        if (next === 0) ready.push(other);
      }
    }
  }
  for (const file of dirty) {
    if (pending.has(file) && pending.get(file)! > 0) ordered.push(file);
  }
  return ordered;
}
