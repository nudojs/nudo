/**
 * CLI 命令共享工具（路径采集、watch、reemit、abs 观察面）。
 * 从 index.ts 原样迁出，行为不变。
 */
import { readFileSync, existsSync, watch, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative, join, basename } from "node:path";
import {
  analyzeFileAsync,
  buildModuleGraph,
  computeDirtySet,
  topoSortDirty,
  collectCallRecords,
  stripGeneratedCaseDirectives,
  insertGeneratedCaseDirectives,
  isNudoTargetPath,
  isWatchRelevantPath,
  isSidecarPath,
  isProjectConfigPath,
  ambientSourcesOfSidecar,
  envPathDependents,
  isEnvTemplatePath,
  getAnalysisSession,
  type CallRecord,
  type AnalysisResult,
  type EmitResult,
} from "@nudojs/service";

export type EmitCasesOptions = { mode: "add" | "update"; dryRun: boolean; exitOnDiff: boolean };

/** Usage-error face: one-line reason + a product-style `fix:` hint (same face as check diagnostics). */
function usageError(message: string, fix: string): void {
  console.error(message);
  console.error(`fix:  ${fix}`);
}

export async function reemitUpdate(
  filePath: string,
  source: string,
  from?: CallRecord[],
): Promise<{ result: AnalysisResult; emitOut: EmitResult; removed: string[] }> {
  const stripped = stripGeneratedCaseDirectives(source);
  const result = await analyzeFileAsync(
    filePath,
    stripped.source,
    undefined,
    from,
    undefined,
    "all",
  );
  const emitOut = insertGeneratedCaseDirectives(stripped.source, result);
  return { result, emitOut, removed: stripped.removed };
}

/** --from 公共采集 */
export function collectExternalRecords(sites: string[]): CallRecord[] | undefined {
  const records: CallRecord[] = [];
  for (const site of sites) {
    const sitePath = resolve(site);
    if (!existsSync(sitePath)) {
      usageError(
        `Callsite file not found: ${sitePath}`,
        `pass --from <file-or-dir> that exists; it supplies call@ records for generation`,
      );
      process.exitCode = 1;
      continue;
    }
    const siteFiles = statSync(sitePath).isDirectory() ? collectNudoFiles(sitePath) : [sitePath];
    for (const sf of siteFiles) {
      records.push(...collectCallRecords(sf, readFileSync(sf, "utf-8")));
    }
  }
  return records.length > 0 ? records : undefined;
}

export function collectNudoFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...collectNudoFiles(fullPath));
    } else if (entry.isFile() && isNudoTargetPath(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

export function resolveTargets(path: string): string[] {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    usageError(
      `Not found: ${resolved}`,
      `check the path; it must be an existing .js/.mjs/.ts file or a directory containing them`,
    );
    process.exitCode = 1;
    return [];
  }
  if (statSync(resolved).isDirectory()) {
    const files = collectNudoFiles(resolved);
    if (files.length === 0) {
      usageError(
        `No nudo files found in directory: ${resolved}`,
        `add .js/.mjs/.ts sources (or point at a directory that has them); sidecar/decl/JSX are skipped`,
      );
      process.exitCode = 1;
    }
    return files;
  }
  if (!isNudoTargetPath(resolved)) {
    usageError(
      `Not an analysis target (need .js/.mjs/.ts, not sidecar/decl/JSX): ${resolved}`,
      `pass a .js/.mjs/.ts analysis file (not .nudo.js sidecars, .d.ts decls, or .jsx/.tsx)`,
    );
    process.exitCode = 1;
    return [];
  }
  return [resolved];
}

// ---------------------------------------------------------------------------
// watch mode (flag, not verb)
// ---------------------------------------------------------------------------

export type WatchRunner = (file: string) => Promise<void>;

export function startWatch(paths: string[], runOne: WatchRunner, label: string): void {
  const resolvedList = paths.map((p) => resolve(p));
  const isDir = resolvedList.some((p) => existsSync(p) && statSync(p).isDirectory());
  const primary = resolvedList[0]!;

  const getFiles = (): string[] => {
    const out: string[] = [];
    for (const p of resolvedList) {
      if (!existsSync(p)) continue;
      if (statSync(p).isDirectory()) out.push(...collectNudoFiles(p));
      else out.push(p);
    }
    return out;
  };

  let graph = buildModuleGraph(getFiles());

  const runAll = async () => {
    console.clear();
    console.log(`[${new Date().toLocaleTimeString()}] nudo ${label}...\n`);
    for (const f of getFiles()) {
      try {
        await runOne(f);
      } catch (err) {
        console.error(`Error ${relative(process.cwd(), f)}:`, (err as Error).message);
      }
    }
    graph = buildModuleGraph(getFiles());
    console.log(`[${new Date().toLocaleTimeString()}] Watching for changes...`);
  };

  const runIncremental = async (changedFiles: string[]) => {
    const files = getFiles();
    const tracked = new Set(files);
    const dirtyUnion = new Set<string>();
    let forceFull = false;
    for (const cf of changedFiles) {
      if (isNudoTargetPath(cf)) {
        for (const d of computeDirtySet(graph.dependents, cf)) dirtyUnion.add(d);
        continue;
      }
      getAnalysisSession().clear();
      if (isProjectConfigPath(cf)) {
        forceFull = true;
        continue;
      }
      if (isEnvTemplatePath(cf) || !isSidecarPath(cf)) {
        const envDeps = envPathDependents(cf);
        if (envDeps.length > 0) {
          for (const src of envDeps) {
            if (tracked.has(src)) dirtyUnion.add(src);
            for (const d of computeDirtySet(graph.dependents, src)) dirtyUnion.add(d);
          }
        } else if (isEnvTemplatePath(cf)) {
          forceFull = true;
          continue;
        }
      }
      if (isSidecarPath(cf)) {
        for (const src of ambientSourcesOfSidecar(cf)) {
          if (tracked.has(src)) dirtyUnion.add(src);
          for (const d of computeDirtySet(graph.dependents, src)) dirtyUnion.add(d);
        }
        for (const d of computeDirtySet(graph.dependents, cf)) dirtyUnion.add(d);
        if (![...dirtyUnion].some((f) => tracked.has(f))) forceFull = true;
      }
    }
    const dirty = forceFull ? files : [...dirtyUnion].filter((f) => tracked.has(f));
    if (dirty.length === 0) return;
    const ordered = topoSortDirty(graph.imports, dirty);
    console.clear();
    console.log(`[${new Date().toLocaleTimeString()}] nudo ${label} (incremental)...\n`);
    getAnalysisSession().evictForDependents(ordered);
    for (const f of ordered) {
      try {
        await runOne(f);
      } catch (err) {
        console.error(`Error ${relative(process.cwd(), f)}:`, (err as Error).message);
      }
    }
    console.log(`[${new Date().toLocaleTimeString()}] Watching for changes...`);
    graph = buildModuleGraph(getFiles());
  };

  runAll().catch(() => {});

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const watchTarget = isDir ? primary : dirname(primary);
  const pendingChanged = new Set<string>();

  watch(watchTarget, { recursive: isDir }, (_event, filename) => {
    if (!filename) return;
    const fullPath = isDir ? join(watchTarget, filename) : primary;
    if (!isWatchRelevantPath(fullPath)) return;
    pendingChanged.add(fullPath);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const changedFiles = [...pendingChanged];
      pendingChanged.clear();
      if (changedFiles.some((f) => !existsSync(f))) getAnalysisSession().clear();
      runIncremental(changedFiles).catch(() => {});
    }, 200);
  });
}

/** check --abs：代数 term/pred/conf 观察 */
export async function runAbsView(
  filePath: string,
  opts: { fn?: string; assume?: string[]; generalize?: boolean },
): Promise<void> {
  const algebra = await import("@nudojs/core");
  const source = readFileSync(filePath, "utf8");
  let phi = algebra.pTrue;
  const assumeIds = new Set<string>();
  const assumeLines: string[] = [];
  for (const a of opts.assume ?? []) {
    const m = /^([A-Za-z_$][\w$]*)\s*(>=|>)\s*(-?\d+(?:\.\d+)?)$/.exec(a.trim());
    if (!m) {
      console.error(`Cannot parse --assume: ${a} (supported forms: x>0 / x>=1)`);
      continue;
    }
    const id = m[1]!;
    const n = Number(m[3]);
    phi = algebra.gtNum(algebra.v(id), n);
    assumeIds.add(id);
    assumeLines.push(`${id} ${m[2]} ${m[3]}`);
  }
  const list = opts.fn ? [opts.fn] : algebra.listFunctionNames(source);
  if (list.length === 0) {
    console.error(`Function not found: ${basename(filePath)}`);
    process.exitCode = 1;
    return;
  }
  const { defaultLoadModule: loadModule, tryBPathCall } = await import("@nudojs/service");
  console.log(`nudo check --abs  ${basename(filePath)}`);
  if (assumeLines.length > 0) {
    console.log(`assume: ${assumeLines.join(", ")}`);
  }
  if (opts.generalize) console.log("mode: generalize (symbolic α)\n");
  else console.log("");
  for (const name of list) {
    if (opts.generalize) {
      const g = algebra.generalizeFromAst(name, source, {
        refine: { loadModule, fromFile: filePath },
      });
      if (!g) continue;
      console.log(g.display);
      console.log("");
      continue;
    }
    const args = algebra.buildArgsFromAssume(source, name, assumeIds);
    // fail-closed：B-only（Φ 种子经 tryBPathCall）；B 失败（类方法等）
    // → unknown（显式无信息，ast-eval 兜底已删）
    const bResult = tryBPathCall(source, filePath, name, args, { phi });
    const result = bResult ?? algebra.unknown;
    const label = `${name}(${args.map((a) => algebra.formatShape(a)).join(", ")})`;
    console.log(algebra.formatAbsMultiline(result, label));
    console.log("");
  }
}
