/**
 * CLI 命令共享工具（路径采集、watch、reemit、abs 观察面、跨文件调用点归因）。
 * eval 注入包装配本体在 `@nudojs/service` 的 `buildEvalInjection`（单一实现），
 * check / migrate / health 只注入各自的解析策略。
 */
import {
  readFileSync,
  existsSync,
  watch,
  readdirSync,
  statSync,
  type Dirent,
} from "node:fs";
import { resolve, dirname, relative, join, basename, sep, isAbsolute } from "node:path";
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
  normalizeRealPath,
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
  diskCacheSignState,
  findProjectConfig,
  type CallRecord,
  type AnalysisResult,
} from "@nudojs/service";
import type { AbsCallRecord } from "@nudojs/core";
import { DIAG, extractAssumeSegs } from "@nudojs/core/internal";

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

/**
 * `--json` 面的路径错误条目形状（族 63b）。
 *
 * `pathErrors[]`（路径级错误全集）与 `targetErrors[]`（分析目标闸门子集）
 * **同形** ⇒ 机器消费者按字段分流时不用做形状转换。
 */
export type PathErrorEntry = {
  path: string;
  code: string;
  message: string;
  suggestion: string;
};

/**
 * 路径错误 → `--json` 面条目（族 63b · **单一映射源**）。
 *
 * `targetErrors[]` 必须与它在 `pathErrors[]` 里的对应条目**逐字同形**
 * （同一批事实、两个字段）⇒ 映射只写这一份，三个动词共用。
 */
export function pathErrorEntry(e: {
  path: string;
  code: string;
  message: string;
  suggestion: string;
}): PathErrorEntry {
  return { path: e.path, code: e.code, message: e.message, suggestion: e.suggestion };
}

/**
 * 信封挂 `targetErrors[]`（族 63b · 三个动词同款口径）。
 *
 * - `pathErrors[]`：**逐字不变**（字段名 + 内容 + 顺序）——既有机器消费者零影响。
 * - `targetErrors[]`：**新增的可选**字段 = 「分析目标闸门」错误（非分析目标 /
 *   空目录 / 路径不存在）的**精确**入口。
 *   - `--from` 路径错误**不**进这里（它是**精确入口**，不是副本）；
 *   - 闸门错误**同时**留在 `pathErrors[]` 里（全集不变 ⇒ 不丢事实）。
 * - **无**闸门错误 ⇒ **不出现**该字段（既有场景输出逐字不变）。
 */
export function attachTargetErrors<T extends object>(
  envelope: T,
  targetErrors: readonly { path: string; code: string; message: string; suggestion: string }[],
): T & { targetErrors?: PathErrorEntry[] } {
  if (targetErrors.length === 0) return envelope;
  return { ...envelope, targetErrors: targetErrors.map(pathErrorEntry) };
}

/**
 * CLI **展示/机器面相对路径**：把目标先归一到 cwd 的 realpath 空间再相减。
 *
 * macOS 上 `os.tmpdir()` 是 `/var/folders/...`（symlink → `/private/var/...`）。
 * 内核给 `process.cwd()` 的是 **realpath**（`/private/...`），而用户参数 /
 * 测试夹具拼出来的是 `/var/...`。裸 `relative(cwd, resolve(userArg))` 于是
 * 产出 `../../../../../../../var/.../syn.js` 这种逃逸串，污染 JSON 的 `file`
 * 字段与人类面文案（Bug 661 / 663 / 664 / 63b 在 macOS 临时目录上长期红）。
 *
 * `normalizeRealPath` 是 service 的单一身份归一实现（目标不存在时回落到
 * 「父目录 realpath + basename」）⇒ 两侧同空间，`syn.js` 就还是 `syn.js`。
 * 非 symlink 宿主 / 仓库内路径上结果与旧式 `relative()` **逐字节相同**。
 *
 * 注意 `displayPathOf` 故意**不**走这里：它承诺「逃出 cwd 时回落用户给的
 * 绝对路径」，改它会动既有 pins。本 helper 只用于 contract 族与 watch 的
 * 「相对 cwd 展示」计算点。
 */
export function relFromCwd(p: string): string {
  return relative(process.cwd(), normalizeRealPath(p));
}

/** 产品路径面：相对 cwd 的展示路径（逃出根时回落原值）。 */
export function displayPathOf(p: string): string {
  const rel = relative(process.cwd(), p);
  return rel === "" || rel.startsWith("..") ? p : rel;
}

/**
 * `git apply -p1` 可消费的 **diff 头路径**（Bug 27）。
 *
 * `displayPathOf` 是给**人**看的：目标越出 cwd 时回落成绝对路径，而
 * `unifiedDiff` 会把它拼成 `--- a//tmp/proj/lib.js` ⇒ 剥掉 `a/` 后仍是绝对
 * 路径，`git apply` 一律 `error: invalid path`（exit 128）。`..` 开头的相对
 * 路径同样被 git 拒绝（树外路径）。
 *
 * 因此 diff 头与展示面必须解耦：cwd 内 ⇒ 相对 cwd（与控制组逐字相同）；
 * 越出 cwd ⇒ **只留文件名**并返回 `outside: true`，由调用方在 `fix:` /
 * `freeze:` 行说明「须在目标目录里 apply」。这样补丁本身在目标目录下是
 * 合法可消费的，且 stdout 不再产出损坏的 `a//abs` 头。
 */
export function diffPathOf(p: string): { path: string; outside: boolean } {
  const rel = relative(process.cwd(), p);
  const posix = rel.split(sep).join("/");
  if (posix === "" || posix === ".." || posix.startsWith("../") || isAbsolute(posix)) {
    return { path: basename(p), outside: true };
  }
  return { path: posix, outside: false };
}

/**
 * `nudo.cache.sign` 配置预检（B3 信任面）：targets 涉及的项目配置里，
 * 最近的签名配置错误消息（`sign: true` 但 `NUDO_CACHE_KEY` 缺席/空，或
 * sign 取值形状非法）；无错误返回 null。
 *
 * 签名是安全旋钮 ⇒ **拒绝运行**（不静默降级到未签名缓存：用户以为受保护
 * 实则没有）。各命令在 action 层用自己的 usage-error 通道输出本消息
 * （check 的 CheckJsonMulti 信封 / test 的 CaseJson 信封 / contract 的
 * 聚合信封 / health 的人类面）；service 侧 `openDiskCache` 的 throw 是
 * 漏检路径的 fail-closed 兜底。
 *
 * 项目配置按 `projectDir` 去重（批跑多文件共享同一 package.json 时只查一次；
 * `findProjectConfig` 自带目录链 memo）。
 */
export function diskCacheSignConfigError(files: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const f of files) {
    const proj = findProjectConfig(dirname(f));
    if (!proj?.projectDir) continue;
    if (seen.has(proj.projectDir)) continue;
    seen.add(proj.projectDir);
    const st = diskCacheSignState(proj.config);
    if (st.kind === "error") return st.message;
  }
  return null;
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

/**
 * 固化写回的**宿主接线**（BUG-055 / BUG-119）：有效契约（源码 `@nudo:contract`
 * + 侧车 `*.nudo.js`）的定位需要 `loadModule` / `fromFile` / `autoBind` /
 * `projectDir` —— 与 `contractOf` / `checkSource` 的侧车施加点同口径
 * （不同口径 ⇒ 同一份契约在两个面上落到不同的位）。
 */
export async function emitWiringOf(filePath: string): Promise<{
  filePath: string;
  loadModule: (spec: string, fromFile: string) => string | undefined;
  autoBind: boolean | undefined;
  projectDir: string | undefined;
}> {
  const { defaultLoadModule, findProjectConfig, contractConfig } = await import(
    "@nudojs/service"
  );
  const proj = findProjectConfig(dirname(filePath));
  return {
    filePath,
    loadModule: defaultLoadModule,
    autoBind: contractConfig(proj?.config).autoBind,
    projectDir: proj?.projectDir,
  };
}

/** 生成态见证行（与 service/emit 的 GENERATED_CASE_LINE_REGEX 同口径） */
const GENERATED_WITNESS_LINE = /^\s*\*?\s*@nudo:case\s+"(call@[^"]*)"/;

/** 源码里已固化的生成态见证名（按出现顺序） */
function generatedWitnessNames(source: string): string[] {
  const body = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = GENERATED_WITNESS_LINE.exec(line);
    if (m) out.push(m[1] ?? "");
  }
  return out;
}

/**
 * 见证身份（BUG-036 口径，与 health 的 `witnessIdentity` 同源）：
 * 严格 = **现场 + 行号**（`call@a.js:L2` 与 `call@b.js:L2` 是两个调用点）；
 * 归一 = 剥掉现场段（只用于「一侧带现场、另一侧不带」的命名方案归一）。
 */
function witnessIdentity(name: string): { strict: string; loose: string; hasSite: boolean } {
  const m = /^call@([^:]*):L(\d+)$/.exec(name);
  if (!m) return { strict: name, loose: name, hasSite: false };
  const site = m[1] ?? "";
  return { strict: `call@${site}:L${m[2]}`, loose: `call@L${m[2]}`, hasSite: site !== "" };
}

/**
 * **净删除**的生成态见证：被剥离、且写回后**不再存在**的那些（按身份逐条配对）。
 *
 * BUG-119：`--freeze=update` 的汇总此前只数**新写出**的条数 ⇒ 一次「剥离 1 条、
 * 重建 0 条」的净删除被印成「0 directive(s)」（汇总说谎）。配对时同一调用点
 * 的**行号漂移**（块插回后行号复原失败）不得算成删除。
 */
export function netRemovedWitnesses(oldNames: string[], newNames: string[]): string[] {
  const used = new Array<boolean>(newNames.length).fill(false);
  const out: string[] = [];
  for (const old of oldNames) {
    const oid = witnessIdentity(old);
    let hit = newNames.findIndex(
      (n, k) => !used[k] && witnessIdentity(n).strict === oid.strict,
    );
    if (hit < 0) {
      hit = newNames.findIndex((n, k) => {
        if (used[k]) return false;
        const id = witnessIdentity(n);
        return id.loose === oid.loose && id.hasSite !== oid.hasSite;
      });
    }
    if (hit >= 0) used[hit] = true;
    else out.push(old);
  }
  return out;
}

/**
 * 把 `target` 的函数声明**锚点**换到 `base` 的坐标系，其余（含 case 名）不动。
 *
 * BUG-019：`insertGeneratedCaseDirectives` 用 `fn.loc.start.line` 定位插入点，
 * 而 case 名里的行号来自分析所用的那份文本 ⇒ 二者**必须是同一个坐标系**。
 * 「写入后文本」的分析给出**正确的见证名**（`call@L8`），但它的锚点也在
 * 写入后坐标；插入基源（已剥离生成块）在基源坐标 ⇒ 只换锚点、不换名字。
 */
function withAnchorsOf(target: AnalysisResult, base: AnalysisResult): AnalysisResult {
  const lineOf = new Map(base.functions.map((f) => [f.name, f.loc.start.line] as const));
  return {
    ...target,
    functions: target.functions.map((f) => {
      const line = lineOf.get(f.name);
      if (line === undefined || line === f.loc.start.line) return f;
      return { ...f, loc: { ...f.loc, start: { ...f.loc.start, line } } };
    }),
  };
}

/**
 * 在**写盘基源坐标系**上插入生成指令，但用**写入后文本**的坐标命名见证
 * （BUG-019 的核心）。
 *
 * 两步：
 * 1. `insert(base, baseAnalysis)` 得到「结构候选」（块位置/内容都正确，唯有
 *    名字仍是基源坐标：块插在声明上方 ⇒ 其下方调用点整体下移，名字指错行）。
 * 2. 对候选文本再分析一次 **`caseMode: "none"`**：不评估指令 case ⇒ 不受
 *    same-run exclusivity 掩盖 ⇒ 拿到**候选坐标**下的活调用点见证（`call@L8`）；
 *    把它的锚点换回基源坐标后重新插入一次 ⇒ 块结构逐字相同、名字是最终坐标。
 *
 * 结构长度不一致（极端：二次分析的 callsite 集合变了）⇒ 保守回退首轮结果，
 * 绝不写错位置。
 */
async function emitWithFinalCoordinates(
  filePath: string,
  base: string,
  baseAnalysis: AnalysisResult,
  from: CallRecord[] | undefined,
  wiring: Awaited<ReturnType<typeof emitWiringOf>>,
): Promise<EmitResult> {
  // 重建阶段（update 链）：按见证身份逐条重建，手写 case 只挡同名（BUG-119）。
  const insertOpts = { ...wiring, rebuildGenerated: true };
  const candidate = insertGeneratedCaseDirectives(base, baseAnalysis, insertOpts);
  if (candidate.source === base) return candidate; // 无插入 ⇒ 基源坐标即写盘坐标
  const settled = await analyzeFileAsync(
    filePath,
    candidate.source,
    undefined,
    from,
    undefined,
    "none",
  );
  const final = insertGeneratedCaseDirectives(base, withAnchorsOf(settled, baseAnalysis), insertOpts);
  return final.source.split("\n").length === candidate.source.split("\n").length
    ? final
    : candidate;
}

export async function reemitUpdate(
  filePath: string,
  source: string,
  from?: CallRecord[],
): Promise<{
  result: AnalysisResult;
  emitOut: EmitResult;
  removed: string[];
  /** BUG-119：**净删除**的生成态见证（汇总必须如实报出，不能印 0）。 */
  removedWitnesses: string[];
}> {
  const wiring = await emitWiringOf(filePath);
  // BUG-019：**不得在剥离后的坐标系上产出落盘文本**。
  //
  // 旧实现 `分析(剥离源) → 插入(剥离源)`：见证名里的行号来自**剥离坐标系**
  // （先前生成的指令行已被删掉），却按原文件路径写回 ⇒
  // ① 正确的见证行号被改错（`call@L8` → `call@L5`）；
  // ② 已过期的见证与新调用点**撞名** ⇒ 判「已经是最新」⇒ 永不刷新；
  // ③ 展示面行号整体偏移（少掉被剥离的行数）；
  // ④ 已冻结的指令 case 在 `--freeze` 运行里整个消失（剥离后再也没被分析）。
  //
  // ⇒ 写盘基源 = 剥离后的源码（唯一能重写生成块的位置），但**名字必须按
  // 写入后文本的坐标命名**（{@link emitWithFinalCoordinates}：先结构候选、
  // 再用 `caseMode "none"` 的候选分析取活调用点 → 换锚点后重插）。
  // 展示面（`result`）必须来自**最终要写的那份文本**：指令 case 在、
  // 行号就是用户打开文件时看到的行号。
  const stripped = stripGeneratedCaseDirectives(source);
  const baseAnalysis = await analyzeFileAsync(
    filePath,
    stripped.source,
    undefined,
    from,
    undefined,
    "all",
  );
  const emitOut = await emitWithFinalCoordinates(
    filePath,
    stripped.source,
    baseAnalysis,
    from,
    wiring,
  );
  // BUG-119：净删除 = 被剥离且写回后**不再存在**的生成态见证（按身份逐条配对）。
  const removedWitnesses = netRemovedWitnesses(
    stripped.removed,
    generatedWitnessNames(emitOut.source),
  );
  if (emitOut.source === source) {
    // 文件不需要改：源文件里已有生成块 ⇒ 基源分析看不到指令 case（①）⇒
    // 展示面必须重新分析**原文件**；剥离前无生成块时两份源码相同，可直接复用。
    const result =
      stripped.source === source
        ? baseAnalysis
        : await analyzeFileAsync(filePath, source, undefined, from, undefined, "all");
    return { result, emitOut, removed: stripped.removed, removedWitnesses };
  }
  const result = await analyzeFileAsync(
    filePath,
    emitOut.source,
    undefined,
    from,
    undefined,
    "all",
  );
  return { result, emitOut, removed: stripped.removed, removedWitnesses };
}

/**
 * 模块图装载问题的**「装不上」档**（engine 权威口径）。
 *
 * 与主分析通道的严重度分档**同集合**（`analyzer-orchestrate-uncached.ts` 的
 * `pushBModuleIssues`）：`missing` / `missing-export` / `unreadable` /
 * `json-invalid` 是 **error**；`cycle` / `depth` / `exports-unresolved` 是
 * **warning**（后者还会回落 harvest ⇒ 仍能求值）⇒ 不算「装不上」。
 */
const UNRESOLVED_MODULE_ISSUE_KINDS: ReadonlySet<string> = new Set([
  "missing",
  "missing-export",
  "unreadable",
  "json-invalid",
]);

/**
 * 现场文件可用性探针（Bug 466 + **Bug 1060 第三档**）。
 *
 * `collectCallRecords`（service）把求值异常 blanket 吞成「0 条记录」，于是
 * **「现场文件读失败」与「现场文件里确实没有调用」在下游同形** ⇒
 * `nudo test --from <坏文件>` 静默回落 entry@ + exit 0（假绿：用户以为跑过
 * 调用点验证，实际什么都没验证）。
 *
 * 本探针复跑一次求值（与 collectCallRecords 同参数 ⇒ 命中 eval memo，
 * 不重复执行现场文件的顶层代码），判**三档**：
 * - 解析失败（语法错）→ `mockSeedsForSource` 内的 `parse` 抛错；
 * - 求值失败（模块装载失败 / 顶层抛）→ `tryRunEval` 返回 undefined；
 * - **模块解析失败**（**Bug 1060 第三档**）→ 求值**成功**（lenient 装载器给
 *   未解析的 import 补 stub，模块体继续跑完）但**调用点被丢弃** ⇒
 *   `tryRunEval` 的 `moduleIssues` 里带着 `missing` / `missing-export`
 *   （引擎权威，与主分析通道的 `nudo:module-missing` 家族同源）。
 *
 * 三档都判为「现场文件读失败」，与「文件不存在」同口径（pathMissingCallsite
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
    // 第三档（Bug 1060）：求值成功但**模块图有装不上的 import** ⇒ 调用点已丢。
    const unresolved = (run.moduleIssues ?? []).filter((i) =>
      UNRESOLVED_MODULE_ISSUE_KINDS.has(i.kind),
    );
    if (unresolved.length > 0) {
      return {
        ok: false,
        reason: `module resolution failed: ${unresolved.map((i) => i.reason).join("; ")}`,
      };
    }
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
  // 同一路径给几次就登记几次错误、跑几次求值探针（Bug 171）⇒ resolve 后去重。
  // 用户写重复的 `--from a.js --from a.js` 不是两次不同的现场。
  const seenSites = new Set<string>();
  const pushPathError = (err: PathError): void => {
    if (errorSink) errorSink.push(err);
    else reportPathErrors([err]);
  };
  for (const site of sites) {
    const sitePath = resolve(site);
    if (seenSites.has(sitePath)) continue;
    seenSites.add(sitePath);
    // 单次 stat：miss（ENOENT）→ PathError；EACCES/EIO 上抛（顶层 CLI catch，不伪装 miss）
    const siteStat = statSync(sitePath, { throwIfNoEntry: false });
    if (!siteStat) {
      pushPathError({
        path: sitePath,
        code: DIAG.pathMissingCallsite,
        message: `Callsite file not found: ${sitePath}`,
        suggestion: `pass --from <file-or-dir> that exists; it supplies call@ records for generation`,
      });
      continue;
    }
    const siteFiles = siteStat.isDirectory() ? collectNudoFiles(sitePath) : [sitePath];
    // 空目录是「0 条记录」的**第三种**同形情形（Bug 129）：文件缺失 / 读失败
    // 各有 PathError，空目录此前静默通过 ⇒ 现场啥也没采到却 exit 0。
    // 与 target 面同一码（`nudo:path-empty-dir`）⇒ 两面路径解析口径一致。
    if (siteFiles.length === 0) {
      pushPathError({
        path: sitePath,
        code: DIAG.pathEmptyDir,
        message: `Callsite directory contains no analyzable files: ${sitePath}`,
        suggestion: `add .js/.mjs/.cjs/.ts/.mts/.cts sources to the directory or pass --from <file> instead`,
      });
      continue;
    }
    for (const sf of siteFiles) {
      const source = readFileSync(sf, "utf-8");
      // 探针**先行**（不再挂在「0 条记录」分支上）：
      // - Bug 466：0 条记录 ⇒「现场文件里没有调用」与「现场文件读失败」同形，
      //   必须区分（读失败被吞成 0 条记录 ⇒ 静默 entry@ + exit 0 假绿）。
      // - Bug 1060：**模块解析失败**这一档**求值是成功的**（lenient 装载器给
      //   未解析的 import 补 stub）⇒ 记录**非空**但指向**不存在的函数**
      //   （下游被丢弃）⇒ 静默回落 entry@ + exit 0 假绿。
      //   ⇒ 探针必须对**每个**现场文件都跑，不能只挂在「0 条记录」分支上。
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
      const siteRecords = collectCallRecords(sf, source);
      records.push(...siteRecords);
    }
  }
  return records.length > 0 ? records : undefined;
}

/**
 * `--from` 采集的跨文件调用点记录 → core drift 判定用的 AbsCallRecord
 * （Bug 366 / BUG-054）——check 与 health 共用同一归因实现。
 *
 * core 的 drift 判定（`nudo:contract-drift`）此前只吃**被检查文件自身**求值
 * 产生的调用记录 ⇒ 调用点在别的文件里时，`--from` 写出的生成段永远判不出
 * 陈旧（落盘契约静默陈旧，0 warning 假绿）。本函数把 `--from` 的跨文件证据
 * 接进同一条通道。
 *
 * 口径：
 * - **只收可归因到本文件的记录**（targetModule = 导出 tag / fnModule = 定义
 *   位点 命中本文件）⇒ 别的模块里的同名函数不会污染本文件的 drift 判定
 *   （zero-FP 红线；与 service 侧 case 合成的 matchingExternal 同口径）。
 * - `fnName` 取**被调方在目标模块里的导出名**（targetExport；缺失或命名空间
 *   通配时回落调用处可见名）⇒ import 别名不影响路由。
 * - **不携带 callLoc**：跨文件调用点在被检查文件内没有位置（不把别的文件的
 *   行号挂到本文件上）。
 * - 路径归一 = service `normalizeRealPath`（身份键口径：resolve → realpath，
 *   目标不在时目录 realpath 拼回 basename）。
 */
export function externalAbsCallRecords(
  filePath: string,
  records: readonly CallRecord[] | undefined,
): AbsCallRecord[] {
  if (!records || records.length === 0) return [];
  const current = normalizeRealPath(filePath);
  const out: AbsCallRecord[] = [];
  for (const r of records) {
    const attributed =
      (r.fnModule !== undefined && normalizeRealPath(r.fnModule) === current) ||
      (r.targetModule !== undefined && normalizeRealPath(r.targetModule) === current);
    if (!attributed) continue;
    const targetExport = r.targetExport;
    const fnName =
      targetExport !== undefined && targetExport !== "*" && targetExport !== ""
        ? targetExport
        : r.fnName;
    if (!fnName) continue;
    out.push({ fnName, args: r.argAbs, result: r.resultAbs });
  }
  return out;
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


/**
 * 目录扫描的分析目标。
 *
 * **同目录同 stem 的 `.ts` 与 `.js` 是同一模块的两份副本**：`migrate strip`
 * 的产物 `.js` 与它的源 `.ts` 默认并存（源只有 `--backup` 才改名）⇒ 门禁把
 * 同一个模块分析两遍，机器面 `summary.errors` / `functions` / `files` 恰好
 * 翻倍（Bug 923）。这里按「模块」计数：同目录的 `.ts` 与 `.js` **只分析一份**
 * （一个模块 ⇒ 一次分析 ⇒ 计数不翻倍）。
 *
 * ★ **取哪一份 = 产物（发布物）胜出**（Bug 1053）：
 * - 旧规则把「取 `.ts`」**硬编码**（迁移**前**的事实源：带类型注解 ⇒ 推断更准）。
 * - 但 `migrate strip --write` **默认保留源 `.ts`** ⇒ 迁移过渡期（strip →
 *   retire 之间）目录里 `.ts` 与 `.js` **并存**是常态 ⇒ `retire` 装上的 CI
 *   门禁（`nudo check .`）查的是**退役后不再被编译的死源**，真正**发布出去
 *   的产物 `.js` 零覆盖** ⇒ **假绿**；且与 `migrate verify` 对同一包给出
 *   **相反结论**（verify 红 / check 绿）。
 * - 现在改成「**产物胜出**」：同目录存在同名产物 ⇒ 源被产物取代 ⇒ 门禁查
 *   **发布物**（迁移门禁必须门禁**要发布的东西**）；源单独存在时照旧分析源。
 *
 * **不变式**（Bug 923 仍然成立）：一个模块 ⇒ **一次**分析（计数不翻倍）。
 *
 * 映射与 `migrate strip` 的产物扩展名同口径：`.ts → .js`、`.mts → .mjs`、
 * `.cts → .cjs`（Bug 26：与 tsc / Node 解析序一致；strip 只剥类型，
 * 不做模块系统转换，故 `.cts` 产物在 strip 计划里另带一条告警）。
 *
 * ⚠ **取舍**（行为变更，已写进 changeset）：同 stem 的 `.js` 若**不是** strip
 * 产物（例如手写的旧模块、或被提交进仓库的编译输出），现在被分析的是 `.js`
 * 而不是 `.ts` ⇒ 源不再被门禁覆盖。要区分「产物」与「同名的另一个模块」需要
 * strip 落一份产物清单（marker）——本次未做（见交回报告）。
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
  const seenDirs = new Set<string>([normalizeRealPath(dir)]);
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
  // 同目录里**已存在的产物**（`.js` / `.mjs`，按 stem 索引）——
  // 「源 vs 产物」同 stem 冲突时**产物胜出**（Bug 1053：门禁要门禁发布物）。
  // 只收**分析目标**：侧车（`*.nudo.js`）/ draft 不是产物 ⇒ 不能压掉源。
  const jsProducts = new Set<string>(); // .js 产物（stem）
  const mjsProducts = new Set<string>(); // .mjs 产物（stem）
  for (const entry of entries) {
    if (kinds.get(entry.name) !== "file") continue;
    const fullPath = join(dir, entry.name);
    const lower = entry.name.toLowerCase();
    if (lower.endsWith(".mjs")) {
      if (isNudoTargetPath(fullPath)) mjsProducts.add(entry.name.slice(0, entry.name.length - 4));
    } else if (lower.endsWith(".js")) {
      if (isNudoTargetPath(fullPath)) jsProducts.add(entry.name.slice(0, entry.name.length - 3));
    }
  }
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const kind = kinds.get(entry.name);
    if (kind === "dir") {
      // 产品默认安全排除（node_modules / dist / coverage）——不再进入
      if (DEFAULT_EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      // 符号链接目录：按 realpath 防环（链接指回祖先 ⇒ 无限递归）
      const real = normalizeRealPath(fullPath);
      if (seenDirs.has(real)) continue;
      seenDirs.add(real);
      results.push(...collectNudoFilesIn(fullPath, inScope, seenDirs));
      continue;
    }
    if (kind !== "file") continue;
    if (!isNudoTargetPath(fullPath)) continue;
    // 源（.ts / .mts / .cts）与同 stem 的产物（.js / .mjs）并存 ⇒
    // **产物胜出**：源被产物取代 ⇒ 不再分析源（Bug 1053：迁移过渡期门禁必须
    // 查发布出去的 `.js`，否则 CI 门禁查的是退役后不再被编译的死源 ⇒ 假绿）。
    // 产物侧不再跳过（产物恒被分析）⇒ Bug 923 的「一个模块只分析一遍」不变式
    // 由「源被压掉」保证（计数不翻倍）。
    const stem = sourceStemOf(entry.name);
    if (stem !== undefined) {
      const lower = entry.name.toLowerCase();
      const products = lower.endsWith(".mts") ? mjsProducts : jsProducts;
      if (products.has(stem)) continue;
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

/**
 * 跨位置参数的目标收敛（Bug 79）：位置参数只声明「要分析哪些模块」，
 * 同一模块只分析一遍。
 *
 * `resolveTargetsCollect` 的返回值天然是「**该 path** 的目标列表」，四个一级
 * 动词过去跨 path 直接 `push` ⇒ 同一文件被完整分析 N 次、`reports[]` N 条、
 * `summary` 逐次累加；`test` 还用 `targets.length > 1` 判「`--json` 只接受
 * 单文件」⇒ 只点名了一个文件的命令行被误判成多文件（假 usage error）。
 * `migrate status` 的 `seenRoots`（Bug 668）早已确立「同一包只列一次」的
 * 口径，这里把同样的收敛装到所有一级动词的入口。
 */
export function collectTargets(
  paths: readonly string[],
): { targets: string[]; errors: PathError[] } {
  const targets: string[] = [];
  const errors: PathError[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    const r = resolveTargetsCollect(p);
    for (const t of r.targets) {
      // realpath 归一：`src` 与 `./src/lib.js` 与符号链接写法都指向同一模块
      const key = normalizeRealPath(t);
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(t);
    }
    errors.push(...r.errors);
  }
  return { targets, errors };
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
 * watch 变更指纹：`size + mtimeMs`。文件不存在（删除 / 竞态）返回 undefined。
 * 抽成模块级函数是为了让「FSEvents 噪声过滤」可被确定性单测覆盖。
 */
export function watchPathVersion(p: string): string | undefined {
  const st = statSync(p, { throwIfNoEntry: false });
  return st ? `${st.size}:${st.mtimeMs}` : undefined;
}

/**
 * 去抖窗口内只保留**指纹真的变了**的路径。
 * - tracked 且指纹未变 ⇒ macOS FSEvents 顺带报告的噪声，丢弃；
 * - 未记录（配置 / 侧车 / env 模板 / 新建文件）或已删除 ⇒ 一律放行，
 *   保持既有「非 tracked 路径触发全量/依赖驱逐」语义。
 */
export function filterUnchangedWatchPaths(
  candidates: readonly string[],
  knownVersions: ReadonlyMap<string, string>,
): string[] {
  return candidates.filter((f) => {
    const known = knownVersions.get(stablePathKey(f));
    return known === undefined || watchPathVersion(f) !== known;
  });
}

/**
 * 机器面 JSON 文档落盘（**watch 面 = JSON Lines**，族 63）。
 *
 * - `lines === false`（**非 watch 面**）⇒ 缩进 2 的 pretty 文档——既有形态，
 *   **逐字不变**（既有金标钉的就是它）。
 * - `lines === true`（**watch 面**）⇒ **一行**一份完整 JSON 文档：watch 的
 *   stdout 是**流**（第 2 轮起 stdout 里会累积第 2 份文档 ⇒ 整份
 *   `JSON.parse(stdout)` 抛 "Unexpected non-whitespace character after JSON"）。
 *   逐行落盘后 stdout = **JSON Lines**（每行一份完整 JSON 文档）⇒ 机器
 *   消费者可**逐行** `JSON.parse`，不再随轮数炸。
 *
 * watch 横幅**仍走 stderr**（Bug 693）⇒ stdout 保持纯机器面。
 */
export function emitJsonDoc(doc: unknown, lines: boolean): void {
  console.log(lines ? JSON.stringify(doc) : JSON.stringify(doc, null, 2));
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

  /**
   * FSEvents 噪声过滤（macOS）：一个 `fs.watch` 根在目录级上常会顺带报告
   * **同一批次里其他未被触碰的文件**。改 `a.js` 时 `sub/b.js` 也可能进
   * `pendingChanged` ⇒ 增量轮把两个文件都重跑，Bug 684/685 的「重跑的是
   * 被改的那个」断言变成概率性（同一夹具重复跑约 1/3 失败）。
   *
   * 启动时记下每个 tracked 文件的 `(size, mtimeMs)`；去抖窗口内只保留
   * **指纹真的变了**的路径。删除（`stat` miss）与非 tracked 路径（配置 /
   * 侧车 / env 模板 / 新建文件）一律放行，既有语义不变。
   *
   * **记基线的时机**（2026-11-13 修复「吞改动」竞态）：通过过滤、**开始分析
   * 之前**就记下这些路径当前的指纹，而不是等 `runIncremental` 结束后再记。
   * 旧写法把分析期间的二次保存也记成基线 ⇒ 下一次事件比对「未变」⇒ 改动被
   * 静默吞掉（用户得再保存一次）。分析期间的文件写入与「开跑前快照」必然
   * 不同 ⇒ 下一轮正常触发。
   *
   * 局限：`mtimeMs` 是浮点毫秒，同一毫秒内**同尺寸**的二次写入可能撞指纹，
   * 那一轮增量分析会被跳过。概率极低（Node 保留亚毫秒小数），且 watch 只
   * 重跑分析、不写盘，不制造假绿；下次触碰同一文件仍会正常触发。
   */
  const knownVersions = new Map<string, string>();
  /** 记下这些路径**当下**的指纹；删除/暂不可 stat ⇒ 移除键（重建后不算「未变」）。 */
  const recordVersions = (files: Iterable<string>): void => {
    for (const f of files) {
      const key = stablePathKey(f);
      const v = watchPathVersion(f);
      if (v === undefined) knownVersions.delete(key);
      else knownVersions.set(key, v);
    }
  };
  recordVersions(getFiles());

  /**
   * ABS-18 · 增量轮分相计时（**opt-in**，`NUDO_WATCH_PROFILE=1`）。
   *
   * 目的：把 watch 增量轮的 `getFiles` / dirty 计算 / `evictForDependents` /
   * 逐文件 `runOne`（analyze） / `buildModuleGraph` 拆开，判断「整条依赖链
   * 重算」的成本落在哪一段，而不是靠猜。
   *
   * 纪律：默认（未设 env）**零输出、零行为变化**；输出走 stderr —— watch 的
   * stdout 在 `--json` 面必须是纯机器面（JSON Lines），横幅也走 stderr
   * （Bug 693）。
   */
  const watchProfile = process.env.NUDO_WATCH_PROFILE === "1";
  const prof = (msg: string): void => {
    if (watchProfile) console.error(`[watch-profile] ${msg}`);
  };
  let profRound = 0;

  const runAll = async () => {
    const tStart = performance.now();
    onRoundStart?.();
    console.clear();
    watchBanner(`[${new Date().toLocaleTimeString()}] nudo ${label}...\n`);
    process.exitCode = 0;
    let analyzeMs = 0;
    let n = 0;
    for (const f of getFiles()) {
      const tFile = performance.now();
      n++;
      try {
        await runOne(f);
      } catch (err) {
        console.error(`Error ${relFromCwd(f)}:`, (err as Error).message);
        // Bug 926：单文件分析失败（解析失败 / 装配失败）**必须置红**。
        // 改前这里只打一行 stderr 就吞掉 ⇒ watch 面**保持绿**（exit 0），
        // 而同一目录的 `check --watch` / `health --watch` / 非 watch 的
        // `test` **全部 exit 1** ⇒ watch 面上唯一的假绿。
        // 与本文件自陈的「退出码语义 = 最近一轮的门禁状态」一致。
        // ⚠ **不中断整轮**：一个坏文件不该中止整轮（这是现在的行为，也是对的；
        //   错的只是「不置红」）。
        process.exitCode = 1;
      }
      analyzeMs += performance.now() - tFile;
    }
    const tAnalyzed = performance.now();
    graph = buildModuleGraph(getFiles());
    const tGraph = performance.now();
    prof(
      `round=all files=${n} analyzeSum=${analyzeMs.toFixed(1)} graph=${(tGraph - tAnalyzed).toFixed(1)} round=${(tGraph - tStart).toFixed(1)}`,
    );
    watchBanner(`[${new Date().toLocaleTimeString()}] Watching for changes...`);
  };

  const runIncremental = async (changedFiles: string[]) => {
    const profId = ++profRound;
    const tProfStart = performance.now();
    const files = getFiles();
    const tFiles = performance.now();
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
    const tDirty = performance.now();
    onRoundStart?.();
    console.clear();
    watchBanner(`[${new Date().toLocaleTimeString()}] nudo ${label} (incremental)...\n`);
    process.exitCode = 0;
    getAnalysisSession().evictForDependents(ordered);
    const tEvict = performance.now();
    let analyzeMs = 0;
    for (const f of ordered) {
      const tFile = performance.now();
      try {
        await runOne(f);
      } catch (err) {
        console.error(`Error ${relFromCwd(f)}:`, (err as Error).message);
        // Bug 926：增量轮的单文件失败**同样必须置红**（与全量轮同口径）。
        // 改前增量轮只打 stderr 不置红 ⇒ 改坏一个文件后 watch 面仍是绿的。
        process.exitCode = 1;
      }
      const dt = performance.now() - tFile;
      analyzeMs += dt;
      prof(`round=${profId} file=${relFromCwd(f)} ms=${dt.toFixed(1)}`);
    }
    watchBanner(`[${new Date().toLocaleTimeString()}] Watching for changes...`);
    const tAnalyzed = performance.now();
    graph = buildModuleGraph(getFiles());
    const tGraph = performance.now();
    prof(
      `round=${profId} dirty=${ordered.length} getFiles=${(tFiles - tProfStart).toFixed(1)} dirtyCalc=${(tDirty - tFiles).toFixed(1)} evict=${(tEvict - tDirty).toFixed(1)} analyzeSum=${analyzeMs.toFixed(1)} analyzeWall=${(tAnalyzed - tEvict).toFixed(1)} graph=${(tGraph - tAnalyzed).toFixed(1)} round=${(tGraph - tProfStart).toFixed(1)}`,
    );
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
        const candidates = [...pendingChanged];
        pendingChanged.clear();
        // 丢掉 FSEvents 顺带报告的、指纹未变的同批文件（见上方注释）。
        const changedFiles = filterUnchangedWatchPaths(candidates, knownVersions);
        if (changedFiles.length === 0) return;
        // **先**记基线再分析：分析期间的二次保存必须与基线不同（否则被吞）。
        recordVersions(changedFiles);
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
  // BUG-085：源码级 `@nudo:assume` 走**前提槽**（与门禁 core check.ts 同源），
  // 该槽只经 `@nudojs/core/exec` 的 withAssumePremises 播种（不是公共 index 面）。
  const { withAssumePremises } = await import("@nudojs/core/exec");
  const source = readFileSync(filePath, "utf8");
  let phi = algebra.pTrue;
  const assumeIds = new Set<string>();
  // Bug 976（CLI 半）：`--assume` 的**界**必须落到**形参自己的前提**上。
  // core 的 `buildArgsFromAssume` 此前只拿到 id 集合 ⇒ 把被假设形参的 pred
  // **写死**成 `x > 0`（core 半已改成收「形参名 → 界」的映射）⇒ 用户写
  // `--assume 'x>-5'` 时，写死的 `x>0` 反而**更强**（`x>-5 ∧ x>0` ⇒ `x>0`）
  // ⇒ 引擎按 `x>0` 剪枝，`x=-1` 的分支被当成不可达 ⇒ 观察面给出比用户声明
  // **更窄**的结果（说谎）。
  //
  // CLI 半的修法：把**用户声明的界**（按形参名归并、同一形参多条取合取）
  // 落进形参的前提（**替换**那个写死的默认，不是与它合取 —— 合取仍然是写死
  // 的界更强 ⇒ 剪枝照旧）。
  const assumeBounds = new Map<string, import("@nudojs/core").Pred>();
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
    // 同一形参的多条界同样**合取**（`--assume 'x>0' --assume 'x<10'` ⇒ `0<x<10`）
    const prev = assumeBounds.get(parsed.id);
    assumeBounds.set(
      parsed.id,
      prev === undefined ? parsed.pred : algebra.and(prev, parsed.pred),
    );
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
    contractConfig,
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
  const autoBind = contractConfig(proj?.config).autoBind;
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
    // Bug 976（CLI 半）：把**用户声明的界**交给 core 落进形参自己的前提
    // （core 半：`buildArgsFromAssume` 的第 4 参 `bounds`，形参名 → 界）。
    const args = algebra.buildArgsFromAssume(source, name, assumeIds, assumeBounds);
    // 兜底（core 半缺席时也正确）：把**用户声明的界**写进形参自己的前提
    // （**替换** core 写死的 `x>0` 默认，不是与它合取 —— 合取仍然是写死的界
    // 更强 ⇒ 剪枝照旧）。与 core 半**幂等**（core 半已落时是同一个 pred）。
    const formals = algebra.extractFn(source, name)?.params ?? [];
    for (let i = 0; i < args.length; i++) {
      const bound = assumeBounds.get(formals[i] ?? "");
      if (!bound) continue;
      args[i] = { ...args[i]!, pred: bound };
    }
    // 契约约束的形参：constraintToEntryAbs（core 既有导出，与 check 的签名表
    // 同一入口 Abs 语义）覆盖 assume 推导出的入口 Abs。
    const eff = contractOf(algebra, source, name, filePath, loadModule, autoBind, projectDir);
    if (eff) {
      const binders = eff.binders
        ? new Map(Object.entries(eff.binders))
        : undefined;
      const byParam = new Map(
        eff.params.map((p) => [
          p.param,
          algebra.constraintToEntryAbs(p.constraint, p.param, undefined, binders),
        ]),
      );
      for (let i = 0; i < args.length; i++) {
        const c = byParam.get(formals[i] ?? "");
        if (!c) continue;
        // 契约的义务与用户的假设**并存**（契约 pred ∧ 用户界）⇒ 契约不被削弱，
        // 用户的界也不被写死的默认顶掉。
        const bound = assumeBounds.get(formals[i] ?? "");
        args[i] = bound
          ? { ...c, pred: algebra.and(c.pred ?? algebra.pTrue, bound) }
          : c;
      }
    }
    // BUG-085（issue #152 用户引理）：源码级 `@nudo:assume d <= max` 是**用户
    // 公理**，门禁在目标函数入口以 `withAssumePremises` 种**前提槽**——不是
    // phi（前提**不随调用链继承**，callee 帧一律见空；phi 是路径条件且调用
    // 边界不重置 ⇒ 当成 phi 种会漏给 callee，同名形参误染 = unsound 假精度）。
    // `--abs` 此前只种 CLI `--assume` 的 phi ⇒ 同一函数在 `check --json`
    // （`number where /(d, max) ≤ 1`）与 `check --abs`（`number`，无 pred）
    // 两个面互斥；`@nudo:assume` 行一删两面又一致 ⇒ 差异精确来自这条指令。
    // `>=` 段已由 extractAssumeSegs 翻转为 le（消费方只见 le，与 core 同口径）；
    // 文法外段由门禁报 nudo:assume-invalid，观察面不重复裁定。
    const premises = extractAssumeSegs(source, name).flatMap((seg) =>
      seg.kind === "ok" ? [algebra.le(algebra.v(seg.lhs), algebra.v(seg.rhs))] : [],
    );
    // fail-closed：B-only（Φ 种子经 tryEvalCall）；B 失败（类方法等）
    // → unknown（显式无信息，ast-eval 兜底已删）
    // Bug 91：`--abs` 是观察面——引擎证明「必抛」时 result 是精确的 never
    // （throws ≠ never），`tryEvalCall` 默认按 fail-closed 返回 undefined，
    // 旧代码把 undefined 一律折成 `algebra.unknown`（`conf: partial`，
    // 文档定义 = 推断失败）⇒ 同一次运行的签名表与 --json 却是
    // `never #exact`。打开 keepNeverThrows 让观察面与机器面同源同值。
    const evalOpts = { phi, keepNeverThrows: true };
    const evalResult =
      premises.length === 0
        ? tryEvalCall(source, filePath, name, args, evalOpts)
        : withAssumePremises(algebra.and(...premises), () =>
            tryEvalCall(source, filePath, name, args, evalOpts),
          );
    const result = evalResult ?? algebra.unknown;
    const label = `${name}(${args.map((a) => algebra.formatShape(a)).join(", ")})`;
    console.log(algebra.formatAbsMultiline(result, label));
    console.log("");
  }
}

/**
 * 有效契约（源码 `@nudo:contract` + 侧车 `*.nudo.js`）—— 与 check 签名表同源
 * （core `effectiveContract`，opts 与 `checkSource` 的侧车施加点同口径：
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
): import("@nudojs/core").EffectiveContract | undefined {
  try {
    return algebra.effectiveContract(source, name, {
      loadModule,
      fromFile: filePath,
      ...(autoBind === false ? { autoBind: false } : {}),
      ...(projectDir !== undefined ? { projectDir } : {}),
    });
  } catch {
    return undefined;
  }
}
