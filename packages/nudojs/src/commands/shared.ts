/**
 * CLI 命令共享工具（路径采集、watch、reemit、abs 观察面）。
 * 从 index.ts 原样迁出，行为不变。
 */
import { readFileSync, existsSync, watch, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative, join, basename } from "node:path";
import {
  stripGeneratedCaseDirectives,
  insertGeneratedCaseDirectives,
  type EmitResult,
} from "@nudojs/service/emit";
import {
  analyzeFileAsync,
  buildModuleGraph,
  computeDirtySet,
  topoSortDirty,
  collectCallRecords,
  isNudoTargetPath,
  isWatchRelevantPath,
  isSidecarPath,
  isProjectConfigPath,
  ambientSourcesOfSidecar,
  envPathDependents,
  isEnvTemplatePath,
  getAnalysisSession,
  stablePathKey,
  type CallRecord,
  type AnalysisResult,
} from "@nudojs/service";

export type EmitCasesOptions = { mode: "add" | "update"; dryRun: boolean; exitOnDiff: boolean };

/** Usage-error face: one-line reason + a product-style `fix:` hint (same face as check diagnostics). */
function usageError(message: string, fix: string): void {
  console.error(message);
  console.error(`fix:  ${fix}`);
}

/** CLI 路径解析错误（--json 信封的 pathErrors 面；非 JSON 面走 usageError）。 */
export type PathError = {
  path: string;
  code:
    | "nudo:path-not-found"
    | "nudo:path-empty-dir"
    | "nudo:path-not-target"
    | "nudo:path-missing-callsite"
    /** BUG-023：--out 等 IO 失败（mkdir/write）——原始 errno 不进产品面 */
    | "nudo:path-io";
  message: string;
  suggestion: string;
};

/** 产品路径面：相对 cwd 的展示路径（逃出根时回落原值）。 */
export function displayPathOf(p: string): string {
  const rel = relative(process.cwd(), p);
  return rel === "" || rel.startsWith("..") ? p : rel;
}

/**
 * BUG-024：variadic 旗标（`--from <paths...>` 等）吞噬
 * 其后的位置参数后，paths 为空——commander 原生的
 * "missing required argument" 不指向真实原因，这里给
 * 定向 usage error（直指旗标 + `--` 终止符解法）。
 */
export function variadicSwallowError(
  command: string,
  flags: string[],
): void {
  const list = flags.join(", ");
  const first = flags[0] ?? "--from";
  console.error(
    `error: \`nudo ${command}\` received no paths — variadic flag(s) ${list} consumed the following arguments`,
  );
  console.error(
    `fix:  separate variadic flags from paths with \`--\` (e.g. \`nudo ${command} ${first} a.js -- b.js\`) or list paths before the flags`,
  );
  process.exitCode = 1;
}

/** 非 --json 面：打印 usageError 并挡 exit（历史行为）。 */
export function reportPathErrors(errors: PathError[]): void {
  for (const e of errors) usageError(e.message, e.suggestion);
  if (errors.length > 0) process.exitCode = 1;
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

/** --from 公共采集。`errorSink` 提供时路径错误进 sink（不设 exit），否则保持 usageError+exit。 */
export function collectExternalRecords(
  sites: string[],
  errorSink?: PathError[],
): CallRecord[] | undefined {
  const records: CallRecord[] = [];
  for (const site of sites) {
    const sitePath = resolve(site);
    if (!existsSync(sitePath)) {
      const err: PathError = {
        path: sitePath,
        code: "nudo:path-missing-callsite",
        message: `Callsite file not found: ${sitePath}`,
        suggestion: `pass --from <file-or-dir> that exists; it supplies call@ records for generation`,
      };
      if (errorSink) errorSink.push(err);
      else reportPathErrors([err]);
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

/** 路径解析（无副作用）：返回可分析目标 + 路径错误，由调用方决定 exit/JSON 面。 */
export function resolveTargetsCollect(path: string): { targets: string[]; errors: PathError[] } {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    return {
      targets: [],
      errors: [
        {
          path: resolved,
          code: "nudo:path-not-found",
          message: `Not found: ${resolved}`,
          suggestion: `check the path; it must be an existing .js/.mjs/.ts file or a directory containing them`,
        },
      ],
    };
  }
  if (statSync(resolved).isDirectory()) {
    const files = collectNudoFiles(resolved);
    if (files.length === 0) {
      return {
        targets: [],
        errors: [
          {
            path: resolved,
            code: "nudo:path-empty-dir",
            message: `No nudo files found in directory: ${resolved}`,
            suggestion: `add .js/.mjs/.ts sources (or point at a directory that has them); sidecar/decl/JSX are skipped`,
          },
        ],
      };
    }
    return { targets: files, errors: [] };
  }
  if (!isNudoTargetPath(resolved)) {
    return {
      targets: [],
      errors: [
        {
          path: resolved,
          code: "nudo:path-not-target",
          message: `Not an analysis target (need .js/.mjs/.ts, not sidecar/decl/JSX): ${resolved}`,
          suggestion: `pass a .js/.mjs/.ts analysis file (not .nudo.js sidecars, .d.ts decls, or .jsx/.tsx)`,
        },
      ],
    };
  }
  return { targets: [resolved], errors: [] };
}

export function resolveTargets(path: string): string[] {
  const { targets, errors } = resolveTargetsCollect(path);
  reportPathErrors(errors);
  return targets;
}

// ---------------------------------------------------------------------------
// watch mode (flag, not verb)
// ---------------------------------------------------------------------------

export type WatchRunner = (file: string) => Promise<void>;

/**
 * watch 循环（check / test 共用）。返回关闭句柄（停掉 fs watcher 与
 * 去抖计时器；CLI 面常驻不用，测试/宿主用于确定性清理）。
 *
 * 退出码语义 = 最近一轮的门禁状态：每轮开跑前复位 `process.exitCode`。
 * 不复位则首轮红置 1 后永久粘滞——后续绿轮也以 1 退出（假红）。
 */
export function startWatch(paths: string[], runOne: WatchRunner, label: string): () => void {
  const resolvedList = paths.map((p) => resolve(p));
  const isDir = resolvedList.some((p) => existsSync(p) && statSync(p).isDirectory());
  const primary = resolvedList[0]!;

  // 路径身份统一 stablePathKey：watch 事件 / collectNudoFiles / buildModuleGraph 边
  // 各有 fs 原生形态，跨形态查 tracked / computeDirtySet 在 Windows 会 miss。
  const getFiles = (): string[] => {
    const out: string[] = [];
    for (const p of resolvedList) {
      if (!existsSync(p)) continue;
      if (statSync(p).isDirectory()) out.push(...collectNudoFiles(p));
      else out.push(p);
    }
    return out.map(stablePathKey);
  };

  let graph = buildModuleGraph(getFiles());

  const runAll = async () => {
    console.clear();
    console.log(`[${new Date().toLocaleTimeString()}] nudo ${label}...\n`);
    process.exitCode = 0;
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
    for (const rawCf of changedFiles) {
      // watch 事件路径是 join() fs 原生形态；与 tracked / 图键同走 stablePathKey
      const cf = stablePathKey(rawCf);
      if (isNudoTargetPath(cf)) {
        for (const d of computeDirtySet(graph.dependents, cf)) dirtyUnion.add(stablePathKey(d));
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
          for (const srcRaw of envDeps) {
            const src = stablePathKey(srcRaw);
            if (tracked.has(src)) dirtyUnion.add(src);
            for (const d of computeDirtySet(graph.dependents, src)) dirtyUnion.add(stablePathKey(d));
          }
        } else if (isEnvTemplatePath(cf)) {
          forceFull = true;
          continue;
        }
      }
      if (isSidecarPath(cf)) {
        for (const srcRaw of ambientSourcesOfSidecar(cf)) {
          const src = stablePathKey(srcRaw);
          if (tracked.has(src)) dirtyUnion.add(src);
          for (const d of computeDirtySet(graph.dependents, src)) dirtyUnion.add(stablePathKey(d));
        }
        for (const d of computeDirtySet(graph.dependents, cf)) dirtyUnion.add(stablePathKey(d));
        if (![...dirtyUnion].some((f) => tracked.has(f))) forceFull = true;
      }
    }
    const dirty = forceFull ? files : [...dirtyUnion].filter((f) => tracked.has(f));
    if (dirty.length === 0) return;
    const ordered = topoSortDirty(graph.imports, dirty);
    console.clear();
    console.log(`[${new Date().toLocaleTimeString()}] nudo ${label} (incremental)...\n`);
    process.exitCode = 0;
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

  runAll().catch((err) => {
    // BUG-023：首跑失败不得静默吞掉——否则 watch 起不来
    // 且无任何上屏（用户只看到空输出）
    console.error(`nudo ${label} failed to start: ${(err as Error).message}`);
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const watchTarget = isDir ? primary : dirname(primary);
  const pendingChanged = new Set<string>();

  const watcher = watch(watchTarget, { recursive: isDir }, (_event, filename) => {
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

  // 关闭句柄：停 fs watcher + 去抖计时器（watch 是常驻面，CLI 不调用）
  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
  };
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
  const { defaultLoadModule: loadModule, tryEvalCall } = await import("@nudojs/service");
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
    // fail-closed：B-only（Φ 种子经 tryEvalCall）；B 失败（类方法等）
    // → unknown（显式无信息，ast-eval 兜底已删）
    const evalResult = tryEvalCall(source, filePath, name, args, { phi });
    const result = evalResult ?? algebra.unknown;
    const label = `${name}(${args.map((a) => algebra.formatShape(a)).join(", ")})`;
    console.log(algebra.formatAbsMultiline(result, label));
    console.log("");
  }
}
