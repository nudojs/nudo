/**
 * CLI 命令共享工具（路径采集、watch、reemit、abs 观察面）。
 * 从 index.ts 原样迁出，行为不变。
 */
import {
  readFileSync,
  existsSync,
  watch,
  readdirSync,
  statSync,
  realpathSync,
  type Dirent,
} from "node:fs";
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
  shouldAnalyzeFile,
  analysisConfig,
  findProjectConfig,
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
 * 产品默认安全排除的**目录段**（node_modules / dist / coverage）。
 *
 * 真源 = service 的默认 exclude 表（`analysisConfig(null).exclude`
 * ⇒ `DEFAULT_ANALYSIS_EXCLUDE`，见 packages/service/src/evaluator/config.ts）。
 * 这里**从产品表派生**而不是另抄一份（CLI 目录发现此前只抄了 `node_modules`
 * 一条 ⇒ `dist/` / `coverage/` 里的构建产物被当源码门禁，Bug 1026）。
 * 派生失败（产品表换形状）时只损失「不再进入目录」的剪枝性能，
 * 纳入判定仍由 service 闸门（`shouldAnalyzeFile`）兜底。
 */
const DEFAULT_EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set(
  analysisConfig(null)
    .exclude.map((p) => /^\*\*\/([^/]+)\/\*\*$/.exec(p)?.[1])
    .filter((name): name is string => name !== undefined),
);

/**
 * CLI **目录目标**的范围闸门：只施加**产品默认安全排除**
 * （node_modules / dist / coverage），**不**施加用户的 include/exclude ——
 * 「点名路径即意图」是 CLI 的文档约定（docs/design/cli-semantics.md §7 的
 * 「入口 × include/exclude」表：CLI `nudo check/test <path>` 忽略 include/exclude）。
 * `mode` 同样不适用（那张表：CLI 忽略 mode）⇒ 这里固定 `mode: "all"`。
 */
const CLI_TARGET_SCOPE_CONFIG = { ...analysisConfig(null), mode: "all" as const };

function inCliTargetScope(filePath: string): boolean {
  return shouldAnalyzeFile(filePath, undefined, CLI_TARGET_SCOPE_CONFIG);
}

/**
 * **watch 扫描**的范围闸门：产品默认安全排除 + **用户**的
 * `nudo.analysis.include` / `exclude` —— 与 LSP / vite-plugin 走**同一个**
 * `shouldAnalyzeFile` 闸门（同口径），但**不应用 mode**
 * （docs/design/cli-semantics.md §7：「watch 扫描 | 应用 | 不应用 mode」）。
 *
 * 旧实现走的是纯扩展名过滤（`collectNudoFiles`）⇒ 文档里「watch 扫描：应用」
 * 这一行在实现里是**空的**：范围外的文件照样被门禁报红，且与 IDE 对同一文件
 * 给出相反结论（Bug 689）。
 */
function inWatchScope(filePath: string): boolean {
  const proj = findProjectConfig(dirname(filePath));
  const cfg = { ...analysisConfig(proj?.config), mode: "all" as const };
  return shouldAnalyzeFile(filePath, undefined, cfg);
}

/**
 * dirent 判定（**跟随符号链接**）：文件 / 目录 / 都不是。
 *
 * `Dirent.isFile()` / `isDirectory()` 对**符号链接**恒为 false ⇒ 旧实现把
 * 链接进来的文件 / 目录**静默丢弃**（既不分析、也不报路径错误）⇒
 * `check <dir>` 对链接进来的坏文件**假绿**（exit 0），同一文件直传却 FAILED
 * （Bug 671）。这里用 `statSync`（跟随链接）判定；断链（ENOENT）⇒ 都不是
 * （无法分析的路径，不静默当成「干净」——它本来就不是分析目标）。
 */
function entryKind(entry: Dirent, fullPath: string): "file" | "dir" | undefined {
  if (entry.isDirectory()) return "dir";
  if (entry.isFile()) return "file";
  if (!entry.isSymbolicLink()) return undefined;
  const st = statSync(fullPath, { throwIfNoEntry: false });
  if (!st) return undefined; // 断链
  if (st.isDirectory()) return "dir";
  if (st.isFile()) return "file";
  return undefined;
}

/** realpath（失败回落原路径）——符号链接目录防环用。 */
function realPathOf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
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
 *
 * **符号链接**（Bug 671）：链接进来的文件 / 目录**参与**分析
 * （跟随链接判定；目录链接按 realpath 防环）。
 *
 * **范围闸门**（两层，口径见上）：
 * - **产品默认安全排除**（node_modules / dist / coverage）**始终**生效 ——
 *   与 IDE / vite 走同一个 service 闸门（此前 CLI 只抄了 1/3，Bug 1026）。
 * - **用户的 include / exclude** 只在 **watch 扫描**（`scope: "watch"`）时
 *   生效（文档承诺 watch 扫描「应用」）；CLI 目录目标**忽略**它们
 *   （「点名路径即意图」，Bug 689 的分工说明）。
 */
export function collectNudoFiles(
  dir: string,
  opts?: { scope?: "target" | "watch" },
): string[] {
  const inScope = opts?.scope === "watch" ? inWatchScope : inCliTargetScope;
  const seenDirs = new Set<string>([realPathOf(dir)]);
  return collectNudoFilesIn(dir, inScope, seenDirs);
}

function collectNudoFilesIn(
  dir: string,
  inScope: (file: string) => boolean,
  seenDirs: Set<string>,
): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  // dirent 判定（跟随符号链接）——一次算完，两个循环共用
  const kinds = new Map<string, "file" | "dir" | undefined>();
  for (const entry of entries) {
    kinds.set(entry.name, entryKind(entry, join(dir, entry.name)));
  }
  // 同目录里「会产出同名 .js / .mjs」的 TS 源（按 stem 索引）
  const jsStems = new Set<string>(); // .ts / .cts 源 → 产物 .js
  const mjsStems = new Set<string>(); // .mts 源 → 产物 .mjs
  for (const entry of entries) {
    if (kinds.get(entry.name) !== "file") continue;
    const stem = sourceStemOf(entry.name);
    if (stem === undefined) continue;
    if (entry.name.toLowerCase().endsWith(".mts")) mjsStems.add(stem);
    else jsStems.add(stem);
  }
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const kind = kinds.get(entry.name);
    if (kind === "dir") {
      // 产品默认安全排除（node_modules / dist / coverage）——不再进入
      if (DEFAULT_EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      // 符号链接目录：按 realpath 防环（链接指回祖先 ⇒ 无限递归）
      const real = realPathOf(fullPath);
      if (seenDirs.has(real)) continue;
      seenDirs.add(real);
      results.push(...collectNudoFilesIn(fullPath, inScope, seenDirs));
      continue;
    }
    if (kind !== "file") continue;
    if (!isNudoTargetPath(fullPath)) continue;
    // 产物副本（.js / .mjs）且同目录有对应 TS 源 ⇒ 跳过（同一模块只分析一遍）
    const lower = entry.name.toLowerCase();
    if (lower.endsWith(".mjs")) {
      const stem = entry.name.slice(0, entry.name.length - 4);
      if (mjsStems.has(stem)) continue;
    } else if (lower.endsWith(".js")) {
      const stem = entry.name.slice(0, entry.name.length - 3);
      if (jsStems.has(stem)) continue;
    }
    // 范围闸门（产品默认安全排除 [+ watch 扫描的用户 include/exclude]）
    if (!inScope(fullPath)) continue;
    results.push(fullPath);
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

/** watch 监视根：一个根 = 一个目录 + 是否递归。 */
type WatchRoot = { root: string; recursive: boolean };

/**
 * **watch 监视根解析**（Bug 684 / 685 / 686 的共享路径解析）。
 *
 * **每个路径各自一个根**：
 * - 目录路径 → 监视该目录（递归）
 * - 文件路径 → 监视其**所在目录**（非递归）
 *
 * 旧实现只取**第 0 个路径**当监视根（`isDir ? primary : dirname(primary)`），
 * 于是：
 * - 多路径且**首个是文件** ⇒ 监视根是一个**文件**（`fs.watch` 只对它本身
 *   触发），事件路径又被拼成目录形式的假路径 ⇒ 增量轮**永不触发**（Bug 684）；
 * - 路径**跨多个目录** ⇒ 其余目录**从未被 `fs.watch` 注册** ⇒ 那些目录里的
 *   文件是**永久盲区**（Bug 686）。
 *
 * 同一目录既是「文件路径的宿主」又是「目录路径」时取覆盖面更大的那档（递归）。
 */
function resolveWatchRoots(resolvedList: string[]): WatchRoot[] {
  const byRoot = new Map<string, WatchRoot>();
  for (const p of resolvedList) {
    // 单次 stat：miss（含竞态删除）不计监视根；EACCES/EIO 上抛（fail loud）
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    const isDirPath = st.isDirectory();
    const root = isDirPath ? p : dirname(p);
    const key = stablePathKey(root);
    const prev = byRoot.get(key);
    if (prev) {
      prev.recursive = prev.recursive || isDirPath;
      continue;
    }
    byRoot.set(key, { root, recursive: isDirPath });
  }
  return [...byRoot.values()];
}

/**
 * watch 横幅（人类进度）**一律走 stderr**（Bug 693）。
 *
 * `--json` 是**机器面**：stdout 必须是**纯 JSON**（`nudo test --watch --json`
 * / `nudo health --watch --json` 的 stdout 契约）。旧实现用 `console.log`
 * 把横幅写进 stdout ⇒ stdout = 横幅 + JSON + 横幅 ⇒ `JSON.parse(stdout)`
 * 直接抛 SyntaxError。
 *
 * 横幅是**进度**不是数据 ⇒ 走 stderr 是通用纪律（非 JSON 模式下终端照样看得到）。
 */
function watchBanner(text: string): void {
  console.error(text);
}

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
  // 监视根：**全部**路径各自一个根（见 resolveWatchRoots）
  const watchRoots = resolveWatchRoots(resolvedList);

  // 路径身份统一 stablePathKey：watch 事件 / collectNudoFiles / buildModuleGraph 边
  // 各有 fs 原生形态，跨形态查 tracked / computeDirtySet 在 Windows 会 miss。
  const getFiles = (): string[] => {
    const out: string[] = [];
    for (const p of resolvedList) {
      // miss（watch 启动后被删）→ 跳过该路径不崩；其余 errno 上抛
      const st = statSync(p, { throwIfNoEntry: false });
      if (!st) continue;
      // 目录扫描：watch 面**应用** include/exclude（文档承诺）+ 产品默认安全排除
      if (st.isDirectory()) out.push(...collectNudoFiles(p, { scope: "watch" }));
      // 点名文件 = 用户意图（与 CLI 非 watch 的「点名路径即意图」同口径）
      else out.push(p);
    }
    return out.map(stablePathKey);
  };

  let graph = buildModuleGraph(getFiles());

  const runAll = async () => {
    onRoundStart?.();
    console.clear();
    watchBanner(`[${new Date().toLocaleTimeString()}] nudo ${label}...\n`);
    process.exitCode = 0;
    for (const f of getFiles()) {
      try {
        await runOne(f);
      } catch (err) {
        console.error(`Error ${relative(process.cwd(), f)}:`, (err as Error).message);
      }
    }
    graph = buildModuleGraph(getFiles());
    watchBanner(`[${new Date().toLocaleTimeString()}] Watching for changes...`);
  };

  const runIncremental = async (changedFiles: string[]) => {
    const files = getFiles();
    const tracked = new Set(files);
    const dirtyUnion = new Set<string>();
    let forceFull = false;
    for (const rawCf of changedFiles) {
      // watch 事件路径是 join() fs 原生形态；与 tracked / 图键同走 stablePathKey
      const cf = stablePathKey(rawCf);
      // Bug 697：**env 模板判定必须排在 isNudoTargetPath 之前**。
      // env 模板的扩展名（.env.js / .env.mjs / .env.ts / mock-*.js / *.mock.js）
      // 同时命中 isNudoTargetPath ⇒ 旧顺序下下面的 env 反向边分支是**死代码**
      // ⇒ 改了 env 模板，依赖它的源文件永不复分析（IDE/watch 面板里类型一直是旧值）。
      // （.env.mts / .env.cjs 不命中 isNudoTargetPath ⇒ 旧顺序下反而正常。）
      if (isEnvTemplatePath(cf)) {
        getAnalysisSession().clear();
        const envDeps = envPathDependents(cf);
        if (envDeps.length > 0) {
          for (const srcRaw of envDeps) {
            const src = stablePathKey(srcRaw);
            if (tracked.has(src)) dirtyUnion.add(src);
            for (const d of computeDirtySet(graph.dependents, src)) dirtyUnion.add(stablePathKey(d));
          }
        } else {
          forceFull = true;
        }
        continue;
      }
      if (isNudoTargetPath(cf)) {
        for (const d of computeDirtySet(graph.dependents, cf)) dirtyUnion.add(stablePathKey(d));
        continue;
      }
      getAnalysisSession().clear();
      if (isProjectConfigPath(cf)) {
        forceFull = true;
        continue;
      }
      if (!isSidecarPath(cf)) {
        const envDeps = envPathDependents(cf);
        if (envDeps.length > 0) {
          for (const srcRaw of envDeps) {
            const src = stablePathKey(srcRaw);
            if (tracked.has(src)) dirtyUnion.add(src);
            for (const d of computeDirtySet(graph.dependents, src)) dirtyUnion.add(stablePathKey(d));
          }
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
    watchBanner(`[${new Date().toLocaleTimeString()}] nudo ${label} (incremental)...\n`);
    process.exitCode = 0;
    getAnalysisSession().evictForDependents(ordered);
    for (const f of ordered) {
      try {
        await runOne(f);
      } catch (err) {
        console.error(`Error ${relative(process.cwd(), f)}:`, (err as Error).message);
      }
    }
    watchBanner(`[${new Date().toLocaleTimeString()}] Watching for changes...`);
    graph = buildModuleGraph(getFiles());
  };

  runAll().catch((err) => {
    // BUG-023：首跑失败不得静默吞掉——否则 watch 起不来
    // 且无任何上屏（用户只看到空输出）
    console.error(`nudo ${label} failed to start: ${(err as Error).message}`);
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingChanged = new Set<string>();

  /**
   * 每个监视根一个 watcher；**事件路径按该事件所属的监视根换算**
   * （Bug 685：旧实现无条件用第 0 个路径 ⇒ 同目录多文件时变更文件被误记成
   * 首个路径 ⇒ 被改的文件永不被重新分析）。
   */
  const watchers = watchRoots.map(({ root, recursive }) =>
    watch(root, { recursive }, (_event, filename) => {
      if (!filename) return;
      const fullPath = join(root, filename);
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
    }),
  );

  /**
   * 关闭句柄聚合：多监视根（Bug 686）下要一次关掉**全部** watcher ——
   * 对外仍是单个 `close()`（调用方不变）。
   */
  const watcher = {
    close: () => {
      for (const w of watchers) w.close();
    },
  };

  // 关闭句柄：停 fs watcher + 去抖计时器（watch 是常驻面，CLI 不调用）
  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
  };
}

/**
 * `--assume` 形如 `x>0` / `x>=1`（Bug 670：形如 `x=5` 的坏值此前只打一行
 * stderr 就被吞掉 ⇒ 命令 exit 0 ⇒ CI 里把「假设没生效」当成功）。
 *
 * 返回 null 表示**坏值**：调用方必须报用法错误 + 置非零 exit。
 */
function parseAssumeEntry(
  algebra: typeof import("@nudojs/core"),
  raw: string,
): { id: string; n: number; op: ">" | ">="; pred: import("@nudojs/core").Pred } | null {
  const m = /^([A-Za-z_$][\w$]*)\s*(>=|>)\s*(-?\d+(?:\.\d+)?)$/.exec(raw.trim());
  if (!m) return null;
  const id = m[1]!;
  const n = Number(m[3]);
  const op = m[2] as ">" | ">=";
  // Bug 973：`>=` 之前一律按 `>` 构造 ⇒ 用户写 `x>=1` 实际得到 `x>1`，
  // 引擎里的谓词与用户写的不一致（`x+1 > 1.999…` 而不是 `x+1 >= 2`）。
  // 谓词构造按运算符分派，用 core 既有导出（geNum/gtNum）。
  const pred = op === ">=" ? algebra.geNum(algebra.v(id), n) : algebra.gtNum(algebra.v(id), n);
  return { id, n, op, pred };
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
  const badAssume: string[] = [];
  for (const a of opts.assume ?? []) {
    const parsed = parseAssumeEntry(algebra, a);
    if (!parsed) {
      // Bug 670：坏值是**用法错误**，不是「打一行提示后继续」。
      badAssume.push(a);
      continue;
    }
    // Bug 974：多条假设**合取**（此前每条都覆盖上一条 ⇒ 只有最后一条生效）。
    // 用 core 既有导出 algebra.and（公共 API 冻结面不新增导出）。
    phi = phi === algebra.pTrue ? parsed.pred : algebra.and(phi, parsed.pred);
    assumeIds.add(parsed.id);
    // 回显打印**实际构造出来的谓词**（运算符来自同一处分派 ⇒ 与引擎一致）
    assumeLines.push(`${parsed.id} ${parsed.op} ${parsed.n}`);
  }
  if (badAssume.length > 0) {
    for (const a of badAssume) {
      usageError(
        `Cannot parse --assume: ${a}`,
        "supported forms: x>0 / x>=1 (e.g. --assume 'x>=1')",
      );
    }
    process.exitCode = 1;
    return;
  }
  // Bug 975：`--generalize` 分支**不吃** assume（generalizeFromAst 没有 Φ 入口）
  // ⇒ 旧实现「接受、打印 assume 回显、然后忽略」＝ 静默说谎。
  // 组合无意义 ⇒ 显式拒绝（用法错误 + 非零 exit），不回显假设。
  if (opts.generalize && assumeLines.length > 0) {
    usageError(
      "--assume cannot be combined with --generalize",
      "generalize (symbolic α) has no assumption (Φ) input; drop --assume or drop --generalize",
    );
    process.exitCode = 1;
    return;
  }
  const fnNames = algebra.listFunctionNames(source);
  let list: string[];
  if (opts.fn !== undefined) {
    // Bug 669：`--fn <不存在的名字>` 此前被当成「引擎推导失败」（unknown/partial），
    // 而「文件本身没有函数」是既有的用法错误 ⇒ 同一类错误两个口径。
    // 拼错名字现在与「文件里没有该函数」同款报错 + 非零 exit。
    if (!fnNames.includes(opts.fn)) {
      usageError(
        `Function not found: ${basename(filePath)} — ${opts.fn}`,
        fnNames.length > 0
          ? `available: ${fnNames.join(", ")}`
          : "this file declares no top-level function",
      );
      process.exitCode = 1;
      return;
    }
    list = [opts.fn];
  } else {
    list = fnNames;
  }
  if (list.length === 0) {
    console.error(`Function not found: ${basename(filePath)}`);
    process.exitCode = 1;
    return;
  }
  const {
    defaultLoadModule: loadModule,
    tryEvalCall,
    findProjectConfig,
    interfaceConfig,
  } = await import("@nudojs/service");
  console.log(`nudo check --abs  ${basename(filePath)}`);
  if (assumeLines.length > 0) {
    console.log(`assume: ${assumeLines.join(", ")}`);
  }
  if (opts.generalize) console.log("mode: generalize (symbolic α)\n");
  else console.log("");
  // Bug 692：`--abs` 面与签名表**同源** —— 有效契约（源码 `@nudo:contract` +
  // 侧车 `*.nudo.js`）约束的形参真的进求值。此前 `--abs` 完全不看契约 ⇒
  // 同一函数在 `check`（x: number => string）与 `check --abs`（x: any => any）
  // 两个面上给出互斥的类型。
  const proj = findProjectConfig(dirname(filePath));
  const autoBind = interfaceConfig(proj?.config).autoBind;
  const projectDir = proj?.projectDir;
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
    // 契约约束的形参：constraintToEntryAbs（core 既有导出，与 check 的签名表
    // 同一入口 Abs 语义）覆盖 assume 推导出的入口 Abs。
    const eff = contractOf(algebra, source, name, filePath, loadModule, autoBind, projectDir);
    if (eff) {
      const formals = algebra.extractFn(source, name)?.params ?? [];
      const byParam = new Map(
        eff.params.map((p) => [p.param, algebra.constraintToEntryAbs(p.constraint, p.param)]),
      );
      for (let i = 0; i < args.length; i++) {
        const c = byParam.get(formals[i] ?? "");
        if (c) args[i] = c;
      }
    }
    // fail-closed：B-only（Φ 种子经 tryEvalCall）；B 失败（类方法等）
    // → unknown（显式无信息，ast-eval 兜底已删）
    const evalResult = tryEvalCall(source, filePath, name, args, { phi });
    const result = evalResult ?? algebra.unknown;
    const label = `${name}(${args.map((a) => algebra.formatShape(a)).join(", ")})`;
    console.log(algebra.formatAbsMultiline(result, label));
    console.log("");
  }
}

/**
 * 有效契约（源码 `@nudo:contract` + 侧车 `*.nudo.js`）—— 与 check 签名表同源
 * （core `effectiveInterface`，opts 与 `checkSource` 的侧车施加点同口径：
 * `loadModule` / `fromFile` / `autoBind === false` / `projectDir`）。
 * 解析失败一律降级为「无契约」（不得让观察面崩）。
 */
function contractOf(
  algebra: typeof import("@nudojs/core"),
  source: string,
  name: string,
  filePath: string,
  loadModule: (spec: string, fromFile: string) => string | undefined,
  autoBind: boolean | undefined,
  projectDir: string | undefined,
): import("@nudojs/core").EffectiveInterface | undefined {
  try {
    return algebra.effectiveInterface(source, name, {
      loadModule,
      fromFile: filePath,
      ...(autoBind === false ? { autoBind: false } : {}),
      ...(projectDir !== undefined ? { projectDir } : {}),
    });
  } catch {
    return undefined;
  }
}
