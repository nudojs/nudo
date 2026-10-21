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
  mockSeedsForSource,
  stablePathKey,
  tryRunEval,
  type CallRecord,
  type AnalysisResult,
} from "@nudojs/service";
import { DIAG } from "@nudojs/core/internal";

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
    | typeof DIAG.pathNotFound
    | typeof DIAG.pathEmptyDir
    | typeof DIAG.pathNotTarget
    | typeof DIAG.pathMissingCallsite
    /** BUG-023：--out 等 IO 失败（mkdir/write）——原始 errno 不进产品面 */
    | typeof DIAG.pathIo;
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

/**
 * 现场文件可用性探针（Bug 466）。
 *
 * `collectCallRecords`（service）把求值异常 blanket 吞成「0 条记录」，于是
 * **「现场文件读失败」与「现场文件里确实没有调用」在下游同形** ⇒
 * `nudo test --from <坏文件>` 静默回落 entry@ + exit 0（假绿：用户以为跑过
 * 调用点验证，实际什么都没验证）。
 *
 * 本探针在**该现场文件产出 0 条记录**时复跑一次求值（与 collectCallRecords
 * 同参数 ⇒ 命中 eval memo，不重复执行现场文件的顶层代码）：
 * - 解析失败（语法错）→ `mockSeedsForSource` 内的 `parse` 抛错；
 * - 求值失败（模块装载失败 / 顶层抛）→ `tryRunEval` 返回 undefined。
 *
 * 两者都判为「现场文件读失败」，与「文件不存在」同口径（pathMissingCallsite
 * 家族）：明确报错 + 非 0 退出。
 */
function probeCallsiteFile(
  sitePath: string,
  source: string,
): { ok: true } | { ok: false; reason: string } {
  try {
    const mocks = mockSeedsForSource(source, { fromFile: sitePath });
    const run = tryRunEval(source, sitePath, {
      mode: "exec",
      lenientGlobals: true,
      ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
    });
    if (!run) return { ok: false, reason: "evaluation failed (module did not load)" };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `parse failed: ${(err as Error).message}` };
  }
}

/** --from 公共采集。`errorSink` 提供时路径错误进 sink（不设 exit），否则保持 usageError+exit。 */
export function collectExternalRecords(
  sites: string[],
  errorSink?: PathError[],
): CallRecord[] | undefined {
  const records: CallRecord[] = [];
  for (const site of sites) {
    const sitePath = resolve(site);
    // 单次 stat：miss（ENOENT）→ PathError；EACCES/EIO 上抛（顶层 CLI catch，不伪装 miss）
    const siteStat = statSync(sitePath, { throwIfNoEntry: false });
    if (!siteStat) {
      const err: PathError = {
        path: sitePath,
        code: DIAG.pathMissingCallsite,
        message: `Callsite file not found: ${sitePath}`,
        suggestion: `pass --from <file-or-dir> that exists; it supplies call@ records for generation`,
      };
      if (errorSink) errorSink.push(err);
      else reportPathErrors([err]);
      continue;
    }
    const siteFiles = siteStat.isDirectory() ? collectNudoFiles(sitePath) : [sitePath];
    for (const sf of siteFiles) {
      const source = readFileSync(sf, "utf-8");
      const siteRecords = collectCallRecords(sf, source);
      // 0 条记录 ⇒ 「现场文件里没有调用」与「现场文件读失败」同形，必须区分
      // （Bug 466：读失败被吞成 0 条记录 ⇒ 静默 entry@ + exit 0 假绿）。
      if (siteRecords.length === 0) {
        const probe = probeCallsiteFile(sf, source);
        if (!probe.ok) {
          const err: PathError = {
            path: sf,
            code: DIAG.pathMissingCallsite,
            message: `Callsite file failed to load: ${sf} — ${probe.reason}`,
            suggestion: `fix the callsite file (it must parse and evaluate) or pass --from <file-or-dir> that loads cleanly; it supplies call@ records for generation`,
          };
          if (errorSink) errorSink.push(err);
          else reportPathErrors([err]);
          continue;
        }
      }
      records.push(...siteRecords);
    }
  }
  return records.length > 0 ? records : undefined;
}

/**
 * 目录扫描的分析目标。
 *
 * **同目录同 stem 的 `.ts` 与 `.js` 是同一模块的两份副本**：`migrate strip`
 * 的产物 `.js` 与它的源 `.ts` 默认并存（源只有 `--backup` 才改名）⇒ 门禁把
 * 同一个模块分析两遍，机器面 `summary.errors` / `functions` / `files` 恰好
 * 翻倍（Bug 923）。这里按「模块」计数：同目录的 `.ts` 与 `.js` 只取 **`.ts`**
 * （迁移前的事实源：带类型注解 ⇒ 推断更准；`.js` 是它的产物副本），
 * `.ts` 被删掉后自然回落到 `.js`。
 *
 * 映射与 `migrate strip` 的产物扩展名同口径：`.ts → .js`、`.mts → .mjs`、
 * `.cts → .js`（strip 只剥类型，不做模块系统转换）。
 */
export function collectNudoFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  // 同目录里「会产出同名 .js / .mjs」的 TS 源（按 stem 索引）
  const jsStems = new Set<string>(); // .ts / .cts 源 → 产物 .js
  const mjsStems = new Set<string>(); // .mts 源 → 产物 .mjs
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const stem = sourceStemOf(entry.name);
    if (stem === undefined) continue;
    if (entry.name.toLowerCase().endsWith(".mts")) mjsStems.add(stem);
    else jsStems.add(stem);
  }
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...collectNudoFiles(fullPath));
    } else if (entry.isFile() && isNudoTargetPath(fullPath)) {
      // 产物副本（.js / .mjs）且同目录有对应 TS 源 ⇒ 跳过（同一模块只分析一遍）
      const lower = entry.name.toLowerCase();
      if (lower.endsWith(".mjs")) {
        const stem = entry.name.slice(0, entry.name.length - 4);
        if (mjsStems.has(stem)) continue;
      } else if (lower.endsWith(".js")) {
        const stem = entry.name.slice(0, entry.name.length - 3);
        if (jsStems.has(stem)) continue;
      }
      results.push(fullPath);
    }
  }
  return results;
}

/** 文件名 → stem（`foo.ts` → `foo`）；非 TS 源返回 undefined */
function sourceStemOf(name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const ext of [".ts", ".mts", ".cts"]) {
    if (lower.endsWith(ext) && !lower.endsWith(`.d${ext}`)) {
      return name.slice(0, name.length - ext.length);
    }
  }
  return undefined;
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
          code: DIAG.pathNotFound,
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
            code: DIAG.pathEmptyDir,
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
          code: DIAG.pathNotTarget,
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
 *
 * `onRoundStart`：每轮（全量/增量）开跑前回调——test 面用它清空
 * env-unresolved 告警去重表（console.clear 后同轮内仍需去重、跨轮需重印）。
 */
export function startWatch(
  paths: string[],
  runOne: WatchRunner,
  label: string,
  onRoundStart?: () => void,
): () => void {
  const resolvedList = paths.map((p) => resolve(p));
  // 单次 stat：miss（含竞态删除）不计 dir；EACCES/EIO 上抛（fail loud）
  const isDir = resolvedList.some(
    (p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() === true,
  );
  const primary = resolvedList[0]!;

  // 路径身份统一 stablePathKey：watch 事件 / collectNudoFiles / buildModuleGraph 边
  // 各有 fs 原生形态，跨形态查 tracked / computeDirtySet 在 Windows 会 miss。
  const getFiles = (): string[] => {
    const out: string[] = [];
    for (const p of resolvedList) {
      // miss（watch 启动后被删）→ 跳过该路径不崩；其余 errno 上抛
      const st = statSync(p, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) out.push(...collectNudoFiles(p));
      else out.push(p);
    }
    return out.map(stablePathKey);
  };

  let graph = buildModuleGraph(getFiles());

  const runAll = async () => {
    onRoundStart?.();
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
    onRoundStart?.();
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
      // 与 runAll 的 BUG-023 同口径：增量轮本体抛错（buildModuleGraph/
      // evictForDependents/topoSortDirty 都在 runOne 的 try 之外）不得静默吞掉，
      // 否则该轮无声死掉，用户只看到上一轮结果冻结。
      runIncremental(changedFiles).catch((err) => {
        console.error(`nudo ${label} incremental failed: ${(err as Error).message}`);
      });
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
