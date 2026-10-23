/**
 * Core validation + analysis-cache logic for the LSP server, extracted from
 * server.ts so it can be exercised directly in tests without a live LSP
 * connection. server.ts wires these functions to `connection` / `documents`;
 * tests wire them to fakes.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeErrorMessage } from "./sanitize.ts";
import { configIgnoreThrows } from "./gate-config.ts";
import {
  analyzeFile,
  analyzeFileAsync,
  buildModuleGraph,
  computeDirtySet,
  defaultLoadModule,
  clearAnalysisSessionCaches,
  clearPathEnvCaches,
  evictAbsModuleCacheFiles,
  evictEvalCacheForFiles,
  evictAnalysisFileCacheForFiles,
  evictFnAnalysisCacheForFiles,
  evalAbsModuleGraph,
  findProjectConfig,
  interfaceConfig,
  checkConfig,
  collectSkipReturns,
  collectEnvNames,
  envPathDependents,
  getPathEnvLoadErrors,
  filterDiagnosticsByLevel,
  diagnosticsLevelForFile,
  getSessionCacheLimits,
  isProjectConfigPath,
  isNudoTargetPath,
  type AnalysisResult,
  type Diagnostic as JsDiagnostic,
  type DiagnosticSeverity as JsDiagSeverity,
  type ModuleGraphCache,
} from "@nudojs/service";
import { preloadPathEnvs } from "@nudojs/service/evaluator";
// Bug 634：门禁面的**注入装配器**与 agent 工具面同源（`buildLspInjection`，
// packages/lsp/src/agent-tools.ts）——CLI 走 `inject` 通道（`@nudo:mock` /
// `@nudo:as` / `@nudo:replace` / env 全局），LSP 编辑器面此前**只传
// `modules`** ⇒ 同一份文件 CLI 绿 / IDE 红（假红）。
//
// ⚠ 循环依赖：agent-tools.ts 已 import 本模块的 `evalAnalysisModules`
// （`evalAnalysisModules` ↔ `buildLspInjection` 互为对偶）⇒ 本模块再
// import agent-tools 形成环。环上**只有函数声明**被跨模块引用（ESM 的
// 函数声明在模块实例化期即就绪）⇒ 环是良性的：两侧都只在**函数体内**
// 调用对方，不存在初始化期读取。
import { buildLspInjection } from "./agent-tools.ts";

export { filterDiagnosticsByLevel, diagnosticsLevelForFile };
import { checkSource, pTrue, evictGeneralizeMemoForPaths, evictCheckSourceMemoForPaths, extractNudoImports, isNodeModulesPath, sidecarPathOf, type AbsModuleExports, type CheckIssue } from "@nudojs/core";
import { parse, extractDirectives, type DirectiveDiag } from "@nudojs/parser";
import { DIAG, extractAllLoadSpecs, hashSource, loadModuleDepsFingerprint, resolveDepPath, runWithCollectorScope, sidecarSpecsOf, stablePathKey, stripStringsKeepComments } from "@nudojs/core/internal";
import type { File } from "@babel/types";
import { createHash } from "node:crypto";

function sourceFingerprint(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

/**
 * 项目配置指纹：analysis.mode / diagnostics / autoBind / env / callSiteBudget /
 * evalMissingSlot 变更必须 miss analysisCache（与 CLI force-full 同口径）。
 *
 * 导出（测试可见）：指纹的**归一口径**是 #487 的契约面——写测试比留
 * 内部函数更直接。
 */
export function projectConfigFingerprint(filePath: string): string {
  try {
    const proj = findProjectConfig(dirname(filePath));
    const cfg = proj?.config ?? {};
    // autoBind 必须取**归一后**的值（service 侧唯一归一点 `interfaceConfig`）：
    // 分析面读的是归一值，指纹读原始值 ⇒ 两者口径分裂。写 `"autoBind": "false"`
    // （非布尔，非法形状）时归一回落 true ⇒ 有效行为与「不写」完全相同，
    // 但原始指纹不同 ⇒ 用户只改了这处无效写法也会 miss 缓存、全量重算
    // （#487）。谓词形态（函数）无法 JSON 序列化，落一个稳定标记。
    const autoBind = interfaceConfig(cfg).autoBind;
    return sourceFingerprint(
      JSON.stringify({
        autoBind: typeof autoBind === "function" ? "predicate" : autoBind,
        analysis: cfg.analysis ?? null,
        env: cfg.env ?? null,
        check: cfg.check ?? null,
      }),
    );
  } catch {
    return "-";
  }
}
import {
  DiagnosticSeverity,
  DiagnosticTag,
  type Diagnostic as LspDiagnostic,
} from "vscode-languageserver/node";

/**
 * Per-file analysis cache; version comes from TextDocument.version.
 * casesHash joins the key so CodeLens case switches invalidate without a
 * document version bump (B2: activeCases must be part of the fingerprint).
 *
 * 条目同时携带 lazy 附属产物（同一指纹口径失效）：
 * - `ast`：hover/completion/signatureHelp 复用的 parse 结果（cachedAstFor）；
 * - `checkDiags`：Abs-check 主通道诊断（getCachedCheckDiags；source/deps/cfg
 *   指纹与 result 同键，侧车/依赖/项目配置变更随条目整体失效）。
 */
export const analysisCache = new Map<
  string,
  {
    version: number;
    result: AnalysisResult;
    sourceHash?: string;
    casesHash?: string;
    depsHash?: string;
    cfgHash?: string;
    /** 与 sourceHash 同源内容的文件 AST（cachedAstFor 惰性填） */
    ast?: File;
    /** checkToLspDiagnostics（已按 analysis.diagnostics 档过滤；getCachedCheckDiags 惰性填） */
    checkDiags?: LspDiagnostic[];
    /**
     * 文档逐行字符数（Bug 778）：诊断 range 必须夹到**行尾**以内，而 pull
     * 通道（server.ts）调 toLspDiagnostic 时**没有源码参数** ⇒ 用会话条目
     * 里的行长表夹取（push / pull 两条通道同口径）。
     */
    lineLengths?: number[];
  }
>();

function casesFingerprint(cases?: Map<string, number>): string {
  if (!cases || cases.size === 0) return "-";
  return [...cases.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

// ---------------------------------------------------------------------------
// 会话 Map 上限（与 service getSessionCacheLimits 同源；长 IDE 会话不无界膨胀）
// ---------------------------------------------------------------------------

/** analysisCache / knownFiles 上限 = maxFiles（0 = 关闭该层缓存，读路径 miss） */
function fileCap(): number {
  return getSessionCacheLimits().maxFiles;
}

/** nudoDepParents 键是依赖路径（含侧车闭包），条目数天然多于文件数——4× 口径 */
function depParentCap(): number {
  return getSessionCacheLimits().maxFiles * 4;
}

/** LRU 命中刷新：delete+set 把键移到队尾（Map 迭代序 = 插入序） */
function lruRefresh<K, V>(m: Map<K, V>, key: K): V | undefined {
  const hit = m.get(key);
  if (hit === undefined) return undefined;
  m.delete(key);
  m.set(key, hit);
  return hit;
}

/** 超上限淘汰最旧键；0 = 关闭（set 侧调用方跳过写入） */
function lruTrim<K, V>(m: Map<K, V>, cap: number): void {
  while (m.size > cap) {
    const oldest = m.keys().next().value;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
}

/** knownFiles 有界登记：重插刷新到队尾，超上限丢最旧（脏传播覆盖面收窄，不陈旧） */
function knownFilesAdd(key: string): void {
  const cap = fileCap();
  if (cap <= 0) return;
  knownFiles.delete(key);
  knownFiles.add(key);
  while (knownFiles.size > cap) {
    const oldest = knownFiles.values().next().value;
    if (oldest === undefined) break;
    knownFiles.delete(oldest);
  }
}

/** Every file analyzed successfully in this session (import-graph nodes for dirty propagation). */
export const knownFiles = new Set<string>();

/**
 * 模块图边缓存（会话级常驻）：key 为文件路径，value 为 mtimeMs+size+已抽取的 import 边。
 * validateText 的脏传播把整个 knownFiles 喂给 buildModuleGraph——命中条目只做 stat
 * 比对、跳过磁盘重读与重解析，使「编辑防抖→脏传播」不再每次全量重读会话摸过的
 * 所有文件。条目仅是路径+边集字符串数组，内存随会话文件数线性有界；
 * watched-files 删除事件经 evictModuleGraphCacheEntries 逐出对应条目。
 */
export const moduleGraphCache: ModuleGraphCache = new Map();

/**
 * `*.nudo.js` → 父分析文件（含 `@nudo:import` 的 .js/.ts）。
 * 供 watched-files 变更时定向重检打开中的父缓冲。
 */
export const nudoDepParents = new Map<string, Set<string>>();

/** 每文件校验代数（A8）：新 validate 启动即 bump；await 返回后代数不一致 → 放弃发布 */
export const validateGeneration = new Map<string, number>();

/**
 * Bump (or initialize) the per-file validate generation.
 * Used by validateText on start and by server onDidClose so in-flight
 * results for a closed/superseded document are discarded.
 */
export function bumpValidateGeneration(filePath: string): number {
  const key = cacheKey(filePath);
  const gen = (validateGeneration.get(key) ?? 0) + 1;
  validateGeneration.set(key, gen);
  return gen;
}

/**
 * Abs-check LSP diagnostics by `analysis.diagnostics` level.
 * Shared by push (`validateText`) and pull (`languages.diagnostics`) so both
 * channels filter identically:
 * - off → silent for analyzer noise, but **check product errors stay visible**
 *   (`nudo:entry-may-throw` + L1 error codes) so IDE matches CLI gate;
 * - errors → Error only; default → Error+Warning; verbose → all.
 */
export function filterCheckLspByLevel(
  diags: LspDiagnostic[],
  level: "off" | "errors" | "default" | "verbose",
): LspDiagnostic[] {
  /** CLI check 永远门禁的码：analysis.diagnostics=off 也不得静默 */
  const ALWAYS_KEEP = new Set<string>([
    DIAG.entryMayThrow,
    DIAG.constraintViolated,
    DIAG.assignMismatch,
    DIAG.argStructure,
    DIAG.caseInconsistency,
    DIAG.interfaceParamMismatch,
    DIAG.interfaceConflict,
  ]);
  const isGate = (d: LspDiagnostic): boolean => {
    const code = (d as { code?: string | number }).code;
    // 门禁码：Error 与 Warning 都保留（对齐 CLI：entryThrows=warning 时 IDE 不得静默丢 L2）
    return (
      typeof code === "string" &&
      ALWAYS_KEEP.has(code) &&
      (d.severity === DiagnosticSeverity.Error || d.severity === DiagnosticSeverity.Warning)
    );
  };
  if (level === "verbose") return diags;
  if (level === "off") return diags.filter(isGate);
  if (level === "errors") {
    return diags.filter((d) => d.severity === DiagnosticSeverity.Error || isGate(d));
  }
  return diags.filter(
    (d) =>
      d.severity === DiagnosticSeverity.Error ||
      d.severity === DiagnosticSeverity.Warning ||
      isGate(d),
  );
}

function normPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Canonical key for session path-keyed maps (analysisCache / knownFiles /
 * nudoDepParents / validateGeneration). Accepts a URI or a file path.
 *
 * Unifies Windows drive forms: `file:///c:/x` → `c:\x`（Windows 上的
 * `fileURLToPath`）/ `/c:/x`（POSIX 上的同形）and `c:\x` / `c:/x` / `C:/x`
 * (fs-resolved) all collapse to `c:/x`. Without the
 * leading-slash strip, `path.resolve('/c:/x')` stays `\c:\x` even on Windows
 * and delete/lookup misses the entry written under the URI-derived key.
 *
 * ⚠ Bug 748：`uriToFilePath` 改用 `fileURLToPath`（与 `pathToFileURL` 互逆）
 *   ⇒ 本键的**盘符形态**随之变化（Windows 上不再带前导斜杠）；下面的
 *   前导斜杠剥离分支**仍保留**（POSIX 形态 `file:///c:/x` 依旧命中）。
 *
 * Drive-form unification is `stablePathKey`（core 单源）——L0 memo 依赖索引与
 * 本键必须同形态，否则 Windows 上定向逐出 miss（FIX-RESIDUAL-3）。
 */
export function cacheKey(p: string): string {
  let fp = uriToFilePath(p);
  const drive = /^\/([A-Za-z]:)(.*)$/.exec(fp);
  if (drive) fp = `${drive[1]}${drive[2]}`;
  // Drive-absolute: skip resolvePath (POSIX would treat c:/x as relative).
  if (/^[A-Za-z]:[\\/]/.test(fp)) return stablePathKey(fp);
  return stablePathKey(resolvePath(fp));
}

/**
 * Re-key a `buildModuleGraph` imports/dependents map through cacheKey. The
 * graph's edge targets come from `resolveModuleFile` (fs-native form, e.g.
 * Windows `c:\a.js`) while its `from` nodes come from `knownFiles` (cacheKey
 * form, `c:/a.js`) — so `computeDirtySet` lookups cross forms and drop edges on
 * Windows. Normalizing keys and values to cacheKey makes lookups hit (FIX-J1).
 */
export function cacheKeyGraph(m: Map<string, Set<string>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [k, vs] of m) {
    const key = cacheKey(k);
    let set = out.get(key);
    if (!set) {
      set = new Set<string>();
      out.set(key, set);
    }
    for (const v of vs) set.add(cacheKey(v));
  }
  return out;
}

/** 每次 validate 后刷新：parent 的全部 @nudo:import 边 + autoBind 隐式侧车边
 *  （自身侧车 + 每个依赖文件的侧车——跨文件被调按定义文件路径绑定，
 *   依赖侧车变更同样须重检 parent；与 loadModuleDepsFingerprint 同口径） */
export function registerNudoImportDeps(filePath: string, source: string): void {
  // accept URI or path — dirname/resolve below need a real path shape
  const fp = uriToFilePath(filePath);
  const parent = cacheKey(fp);
  for (const set of nudoDepParents.values()) {
    set.delete(parent);
  }
  const imports = extractNudoImports(source);
  for (const imp of imports) {
    if (!imp.spec.startsWith(".") && !imp.spec.startsWith("/")) continue;
    const dep = normPath(resolvePath(dirname(fp), imp.spec));
    addNudoDepParent(dep, parent);
  }
  registerSidecarClosureFor(normPath(resolvePath(fp)), parent);
  for (const spec of extractAllLoadSpecs(source)) {
    if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
    const dep = normPath(resolvePath(dirname(fp), spec));
    // 相对 load-module 本身也是分析依赖：变更必须触发 parent 重检
    // （只登记其侧车不够——实现文件内容进 dep 指纹）
    if (!isNodeModulesPath(dep)) addNudoDepParent(dep, parent);
    registerSidecarClosureFor(dep, parent);
  }
}

function addNudoDepParent(dep: string, parent: string): void {
  const key = cacheKey(dep);
  let set = nudoDepParents.get(key);
  if (!set) {
    set = new Set();
    if (depParentCap() > 0) {
      nudoDepParents.set(key, set);
      lruTrim(nudoDepParents, depParentCap());
    }
  } else {
    // LRU 刷新：delete+set 移到队尾
    nudoDepParents.delete(key);
    nudoDepParents.set(key, set);
  }
  set.add(cacheKey(parent));
}

/** 隐式侧车登记的闭包节点上限（防病态侧车图；与 loadModuleDepsFingerprint 同量级） */
const MAX_IMPLICIT_SIDECAR_NODES = 64;

/**
 * autoBind 隐式依赖边（设计 §4.5）：入口文件的旁路侧车与其递归 .nudo 依赖
 * 登记 deps → parent——侧车不被 @nudo:import 声明，不登记则侧车（或其依赖）
 * 变更不触发 parent 重检（陈旧缓存）。node_modules 不登记。
 * 磁盘上尚无侧车时**也登记**边：创建事件即触发 parent 重检（A4）。
 * 递归依赖边与 loadModuleDepsFingerprint 的 sidecar 闭包同口径。
 */
function registerSidecarClosureFor(entryFile: string, parent: string): void {
  const sidecar = sidecarPathOf(entryFile);
  if (isNodeModulesPath(sidecar)) return;
  // miss 也登记：磁盘上尚无侧车时创建事件才能触发 parent 重检（A4）
  addNudoDepParent(sidecar, parent);
  let rootSrc: string;
  try {
    rootSrc = readFileSync(sidecar, "utf8");
  } catch {
    return; // 文件不存在：边已保留，创建即重检
  }
  const seen = new Set<string>([sidecar]);
  const queue: string[] = [sidecar];
  let n = 0;
  while (queue.length > 0) {
    if (n++ >= MAX_IMPLICIT_SIDECAR_NODES) return;
    const path = queue.shift()!;
    let src: string;
    try {
      src = readFileSync(path, "utf8");
    } catch {
      continue; // 声明了但缺文件：边保留（创建即重检），闭包到此为止
    }
    for (const spec of sidecarSpecsOf(src)) {
      const depPath = resolveDepPath(path, spec);
      if (seen.has(depPath)) continue;
      seen.add(depPath);
      addNudoDepParent(depPath, parent);
      queue.push(depPath);
    }
  }
}

/**
 * `*.nudo.js` / 项目配置创建/变更：定向逐出 L0 memo 中依赖该文件的条目，
 * 并重检打开中的父文件（propagate=false，不级联）。
 * 项目配置（package.json#nudo.*）没有 parent 边：必须整会话失效 + force 打开文档。
 */
export async function handleNudoDepFileChanged(
  nudoPath: string,
  deps: ValidateTextDeps,
): Promise<void> {
  const p = cacheKey(nudoPath);
  evictGeneralizeMemoForPaths([p]);
  evictCheckSourceMemoForPaths([p]);
  deps.onProjectConfigChanged?.();
  if (isProjectConfigPath(p)) {
    // analysis.mode / autoBind / nudo.env / diagnostics 档变更：与 CLI watch 同口径 force full
    clearAnalysisSessionCaches();
    analysisCache.clear();
    const open = deps.listOpenDocuments?.() ?? [];
    for (const doc of open) {
      const fp = uriToFilePath(doc.uri);
      if (!fp || !isNudoTargetPath(fp)) continue;
      await validateText(
        fp,
        doc.uri,
        doc.getText(),
        doc.version,
        deps,
        false,
        true,
      );
    }
    return;
  }
  const parents = lruRefresh(nudoDepParents, p);
  // **self-排除**（族 26 前置件，给 server.ts 的 didChangeWatchedFiles /
  // didSave 路径用）：变更文件自己**不是**自己的「父文件」——自依赖边
  // （文件 import 自己 / 侧车把自己登记成 parent）会把变更文件塞进
  // parentSet ⇒ 触发对**自己**的 force 重检 ⇒ 自激重检（Bug 776）。
  const parentSet = new Set<string>();
  for (const x of parents ?? []) {
    if (x !== p) parentSet.add(x);
  }
  // **path-based `@nudo:env` 模板的反向边**（service 的 env-path-deps 表——
  // CLI watch 的真源）。
  //
  // ⚠ 为什么必须显式接这条边：env 模板**不是 import 边** ⇒ 模块图里没有它；
  //   LSP 自己的 `nudoDepParents` 登记用的是**未解析**的 spec 路径
  //   （`resolvePath(dirname, "./custom.env")`）⇒ 与磁盘上的
  //   `custom.env.ts` **对不上** ⇒ 模板变更找不到依赖它的源文件 ⇒
  //   **不重检** ⇒ IDE 诊断停在旧状态；而 CLI watch 用同一张表会重检 ⇒
  //   **两面口径分裂**。
  // ⇒ 这里直接消费 service 的**同一张表**（不另写一份解析）⇒ IDE 与 CLI 同口径。
  for (const dependent of envPathDependents(p)) {
    const parent = cacheKey(dependent);
    if (parent === p) continue;
    parentSet.add(parent);
  }
  // 普通 import/实现文件：从 module graph 取 transitive dependents
  // （外部编辑 utils.js 时打开中的 parent 必须失效）
  if (isNudoTargetPath(p)) {
    try {
      const { dependents } = buildModuleGraph([...knownFiles], moduleGraphCache);
      // 边目标是 resolveModuleFile 的 fs 原生形态，与 knownFiles 的 cacheKey 形态
      // 跨形态查找会漏边（Windows）——统一过 cacheKey 再算脏集（FIX-J1）
      for (const d of computeDirtySet(cacheKeyGraph(dependents), cacheKey(p))) {
        // computeDirtySet 的脏集**含种子**（变更文件自己）⇒ 必须排除自身，
        // 否则变更文件被当成自己的 parent 重检（自激重检，Bug 776）。
        const parent = cacheKey(d);
        if (parent === p) continue;
        parentSet.add(parent);
      }
    } catch {
      /* graph rebuild failure → fall back to nudoDepParents only */
    }
  }
  if (parentSet.size === 0) return;
  const parentList = [...parentSet];
  // 父文件源码未变但依赖内容变了：整文件 check / evaluator / AnalysisResult / fn-cache 都可能陈旧
  evictEvalCacheForFiles(parentList);
  evictAnalysisFileCacheForFiles(parentList);
  evictFnAnalysisCacheForFiles(parentList);
  // path-env factory 进程全局；定向逐出若不清它，新 dep-hash 键会被旧 defineEnv 投毒
  clearPathEnvCaches();
  for (const parent of parentList) {
    // LSP 本地 analysisCache 按 sourceHash 短路：侧车/dep 变更时源码未变，
    // 必须清掉并 force 重算，否则 hover/inlay/evaluator 诊断仍吃旧结果
    analysisCache.delete(parent);
    const doc = deps.getOpenDocumentByPath?.(parent);
    if (!doc) continue;
    await validateText(
      parent,
      doc.uri,
      doc.getText(),
      doc.version,
      deps,
      false,
      true, // force：不可用 sourceHash 短路
    );
  }
}

/** Test hook — resets module-level session state. */
export function clearValidationState(): void {
  knownFiles.clear();
  analysisCache.clear();
  nudoDepParents.clear();
  moduleGraphCache.clear();
  validateGeneration.clear();
  // service+core 会话 memo 全清（evaluator / analysis-file / fn-analysis /
  // abs-module / generalize L0 / check 整文件 / nudo-module exec）
  clearAnalysisSessionCaches();
}

/**
 * watched-files Deleted 清理：从会话登记中移除一个文件（knownFiles + analysisCache）。
 * server.ts 的 DidChangeWatchedFiles handler 对「被删除且不在打开集」的文件逐个调用；
 * 仅关闭（文件仍在磁盘上）不走这里，关闭文件仍可作为依赖图节点参与脏传播。
 */
export function forgetValidatedFile(filePath: string): void {
  const key = cacheKey(filePath);
  knownFiles.delete(key);
  analysisCache.delete(key);
  validateGeneration.delete(key);
  for (const set of nudoDepParents.values()) {
    set.delete(key);
  }
}

/**
 * watched-files 删除事件的模块图边缓存逐出：server.ts 通过 registerWatchedFilesListener
 * 把「被删除且不在打开集」的 uri 列表广播到这里（uri→filePath 复用 uriToFilePath）。
 * 已删除文件的条目只剩内存驻留价值——同名重建文件若 mtime/size 恰好撞上旧值，
 * 会复用陈旧边集得出错误 dirty 集，因此删除时立即逐出。
 * Abs 依赖模块导出缓存（abs-modules-graph）同口径逐出：虽然 stat 失效自愈，
 * 但删除文件的内存驻留条目应随会话清理释放。
 */
export function evictModuleGraphCacheEntries(uris: string[]): void {
  const paths = uris.map(uriToFilePath);
  for (const p of paths) moduleGraphCache.delete(cacheKey(p));
  evictAbsModuleCacheFiles(paths);
}

export function hasNudoDirectives(source: string): boolean {
  // 与 service analysis-scope.hasNudoDirectives 同口径：指令住注释，字符串内不算。
  // 名单是**全部活指令**：parser 侧（case/mock/pure/skip/sample/env/mock-module/
  // as/replace）+ core 侧（contract/import/assume/invariant/throws/budget）——
  // 少一个，该指令所在的文件在 mode=directives 下就被整份跳过（静默无诊断）。
  return /@nudo:(case|mock|pure|skip|sample|contract|import|env|mock-module|as|replace|assume|invariant|throws|budget)\b/.test(
    stripStringsKeepComments(source),
  );
}

/**
 * `file:` URI → 文件路径（Bug 748：**必须与 `filePathToUri` 互逆**）。
 *
 * ⚠ 此前本函数是裸 `decodeURIComponent(uri.slice(7))` ⇒ 两个毛病：
 *   ① **畸形百分号转义**（`%` / `%zz`）抛 **`URIError`** ⇒
 *      `didOpen` / `didChange` / `didClose` 三个处理器中断 ⇒
 *      **该文档零诊断**（L2 假绿）；服务端自产的 URI（裸 `%`）**自己解不回来**。
 *   ② **Windows 盘符**：`slice(7)` 不剥前导斜杠 ⇒ `file:///c:/x` ⇒ `/c:/x`。
 * ⇒ 改用 Node 内置 **`fileURLToPath`**（与 `pathToFileURL` **天生互逆**、
 *   跨平台、盘符形态正确）+ **`try/catch` 兜底**：畸形 ⇒ **回退到未解码原文**，
 *   **绝不抛**（抛异常会让整条通知链断掉）。
 * ⚠ **非 `file:` scheme**（`untitled:` 等）**原样返回**（行为不变）。
 */
export function uriToFilePath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  try {
    return fileURLToPath(uri);
  } catch {
    // 畸形（百分号转义非法 / 非法 host）⇒ 回退：先试旧的解码口径，再退原文。
    try {
      return decodeURIComponent(uri.slice(7));
    } catch {
      return uri.slice(7);
    }
  }
}

/**
 * Cache-aware sync analysis for high-frequency handlers: returns the cached
 * result when the document version matches, otherwise falls back to sync
 * analyzeFile (path-based `@nudo:env` files degrade here — the async preload
 * only runs on the validation path).
 *
 * Cache hit also requires sidecar/deps fingerprint match（P1：pull 不得混用
 * 侧车变更后的陈旧 evaluator 结果）。
 */
export function getCachedOrAnalyze(
  filePath: string,
  source: string,
  version: number,
  activeCases?: Map<string, number>,
  loadModule?: (spec: string, fromFile: string) => string | undefined,
): AnalysisResult {
  const key = cacheKey(filePath);
  // 版本 + activeCases 指纹同时命中才复用：case 切换不 bump 文档 version，
  // 漏掉 casesHash 会把上一 case 的分析结果/lens 原样吐回（B2）
  const casesHash = casesFingerprint(activeCases);
  const depsHash = depsFingerprint(filePath, source, loadModule);
  const cfgHash = projectConfigFingerprint(filePath);
  const cached =
    fileCap() > 0
      ? lruRefresh(analysisCache, key)
      : undefined;
  if (
    cached &&
    cached.version === version &&
    (cached.casesHash ?? "-") === casesHash &&
    (cached.depsHash ?? "-") === depsHash &&
    (cached.cfgHash ?? "-") === cfgHash
  ) {
    return cached.result;
  }
  // E5/A4：与 validateText 同源——buffer-aware loadModule 传入 analyzeFile
  // 惰性 case：默认不跑 @nudo:case；selectCase 后只跑选中
  const caseMode =
    activeCases && activeCases.size > 0 ? ("selected" as const) : ("none" as const);
  const result = analyzeFile(filePath, source, activeCases, undefined, loadModule, caseMode);
  if (fileCap() > 0) {
    analysisCache.set(key, {
      version,
      result,
      sourceHash: sourceFingerprint(source),
      casesHash,
      depsHash,
      cfgHash,
      lineLengths: lineLengthsOf(source),
    });
    lruTrim(analysisCache, fileCap());
  }
  return result;
}

/** 依赖内容截断（fail-visible）：计数 + 单调序号使每次调用指纹必变 → 永不陈旧命中 */
let truncDepsSeq = 0;

/**
 * 侧车 + 全部 import 依赖内容指纹（P1/depsFingerprint 窄修复）：走 core
 * `loadModuleDepsFingerprint`（与 service evaluator 同一 BFS/口径）——覆盖
 * ESM from / require / dynamic import / `@nudo:import` / autoBind 侧车闭包，
 * 不只 `sidecarPathOf(filePath)` 一条。`@nudo:import ./other.nudo.js` 的
 * 内容变更必须 miss analysisCache（旧口径只 hash 自身侧车 → 陈旧命中）。
 * loadModule 未提供时用 defaultLoadModule（与 analyzeFile 同源）。
 * truncated/readerr → 唯一指纹（永不命中，对齐 service noCache fail-closed）。
 */
function depsFingerprint(
  filePath: string,
  source: string,
  loadModule?: (spec: string, fromFile: string) => string | undefined,
): string {
  try {
    const fp = loadModuleDepsFingerprint(source, loadModule ?? lspLoadModule, filePath);
    // truncated/readerr（#135）：读错误轮键不可信 → 唯一指纹（永不命中）
    if (fp.truncated || fp.readError) {
      return `${fp.truncated ? "trunc" : "readerr"}:${fp.paths.length}#${truncDepsSeq++}`;
    }
    return hashSource(fp.fp);
  } catch {
    return "-";
  }
}

/**
 * hover/completion/signatureHelp 的 AST 复用：取 analysisCache 条目上与
 * sourceHash 同源的惰性 parse 结果；条目在而 ast 未填时 parse 一次并回填。
 * 调用方应先经 getCachedOrAnalyze / validateText 建条目（本函数不建条目）。
 */
export function cachedAstFor(filePath: string, source: string): File | undefined {
  const key = cacheKey(filePath);
  const entry = lruRefresh(analysisCache, key);
  if (!entry) return undefined;
  const fp = sourceFingerprint(source);
  if (entry.sourceHash !== undefined && entry.sourceHash !== fp) return undefined;
  if (entry.ast) return entry.ast;
  let ast: File | undefined;
  try {
    ast = parse(source);
  } catch {
    return undefined; // 解析失败不缓存：下一次重试（与旧行为同正确性）
  }
  entry.ast = ast;
  return ast;
}

/**
 * Abs-check 主通道诊断的缓存读：条目已有 checkDiags 且 sourceHash 同源 → 直接
 * 复用；否则全量 checkToLspDiagnostics + 按档过滤后回填条目。与 evalDiags 同条目
 * 同口径失效（source/deps/cfg 指纹；侧车/依赖/项目配置变更时条目整体被删），
 * push 防抖与 pull 诊断共用，避免每次全量 checkSource+extractDirectives。
 * 前置：调用方在本 tick 已跑过 getCachedOrAnalyze / validateText（条目新鲜）。
 */
export function getCachedCheckDiags(
  filePath: string,
  source: string,
  loadModule?: (spec: string, fromFile: string) => string | undefined,
  /** G7：错误脱敏根（LSP server 注入 workspaceRoots） */
  workspaceRoots?: string[],
): LspDiagnostic[] {
  const key = cacheKey(filePath);
  const entry = lruRefresh(analysisCache, key);
  const fp = sourceFingerprint(source);
  if (entry?.checkDiags && entry.sourceHash === fp) {
    return entry.checkDiags;
  }
  const diags = filterCheckLspByLevel(
    checkToLspDiagnostics(filePath, source, loadModule, workspaceRoots),
    diagnosticsLevelForFile(filePath),
  );
  if (entry && entry.sourceHash === fp) entry.checkDiags = diags;
  return diags;
}

export type OpenDocumentLike = {
  uri: string;
  version: number;
  getText(): string;
};

export type { LspDiagnostic };

export type ValidateTextDeps = {
  /**
   * 发布诊断。version = 本次 validate 启动时的文档版本（LSP
   * PublishDiagnosticsParams.version，3.15+ 可选）：宿主客户端
   * 据此丢弃陈旧发布（BUG-021/S5-003——慢分析 + 防抖窗口内
   * 旧文本诊断不得挂到新 buffer）。
   */
  sendDiagnostics: (params: { uri: string; diagnostics: LspDiagnostic[]; version?: number }) => void;
  /** Nudo-file gate; when omitted every uri is validated. */
  isNudoUri?: (uri: string) => boolean;
  getActiveCases?: (uri: string) => Map<string, number>;
  /** Open-document lookup by file path — enables dirty propagation to dependents. */
  getOpenDocumentByPath?: (filePath: string) => OpenDocumentLike | undefined;
  /** A4：侧车 buffer 优先的 loadModule */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  /** 枚举打开中的文档：package.json 等项目配置变更时 force 全量重检 */
  listOpenDocuments?: () => OpenDocumentLike[];
  /** 项目配置变更后宿主侧清理（如 nudoFileCache） */
  onProjectConfigChanged?: () => void;
  /**
   * G7：错误脱敏根（server 注入 InitializeParams 的 workspaceFolders）。
   * 扩展宿主 fork 的 server cwd ≠ 工作区根，多根工作区更无单一 cwd——
   * 缺省回落 sanitizeErrorMessage 的 [process.cwd()] 默认。
   */
  workspaceRoots?: string[];
};

const severityMap: Record<JsDiagSeverity, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
};

/**
 * 指令文法诊断（nudo:directive-syntax）的修复提示文案。
 *
 * check 通道（checkToLspDiagnostics 显式 extract）与 eval 通道（service
 * drain）抽的是**同一条**指令诊断；两通道的诊断合并按 `code + message`
 * 去重（push 与 pull 同口径，见 validateText / server.languages.diagnostics）
 * ——文案不一致 → 同一条诊断被发布两次（一条带提示、一条不带）。
 * 故：提示文案只此一处定义，两通道同渲染。
 */
const DIRECTIVE_SYNTAX_HINT = "Fix the directive syntax (see docs/reference/diagnostics.md)";

/**
 * service 的 `Diagnostic.range` 行号是 **1 基源码行**（Babel `node.loc`；
 * CLI 报告与 check-json-map 直接印这个值），`line: 0` 是「无源码锚点」的
 * **占位**（指令文法诊断 / mock 解析失败 / 模块缺失等），不是「第 0 行」。
 *
 * LSP 的 `Position.line` 是 0 基 uinteger：1 基 → 0 基要减 1，占位值减 1
 * 会落成 -1（非法位置，IDE 侧丢弃或错位）——换算后必须钳位到 0。
 */
function lspLine(line: number): number {
  return Math.max(0, line - 1);
}

/** service 的 column 已是 0 基（Babel）；负值（占位/异常）钳位到 0。 */
function lspChar(column: number): number {
  return Math.max(0, column);
}

/**
 * 文档逐行字符数（LSP range 夹取用）：LSP 的 `Position` 必须落在文档内，
 * 而 service 用 `column: 999` 当「整行」哨兵（`nudo:case-expected`，
 * Bug 778）⇒ 不夹则协议层越界（客户端按 range 渲染会划到行外）。
 * 字符数按 UTF-16 code unit 计（与 Babel `loc.column` 同口径）。
 */
export function lineLengthsOf(source: string): number[] {
  return source.split(/\r\n|\r|\n/).map((l) => l.length);
}

/** 列号夹到该行长度以内；行长未知（无源码 / 行不在文档内）⇒ 不夹。 */
function clampChar(ch: number, line: number, lengths?: number[]): number {
  if (!lengths) return ch;
  const len = lengths[line];
  if (len === undefined) return ch;
  return Math.min(ch, len);
}

/**
 * Diagnostic **range 的唯一计算点**（Bug 778）：
 * - service / core check 的行号是 1 基源码行 → LSP 0 基（占位 line 0 → 0）；
 * - 列号夹到**该行长度**以内（`column: 999` 整行哨兵 ⇒ 行尾）；
 * - 同一行时 end ≥ start（夹取后不得倒挂）。
 *
 * eval 通道（toLspDiagnostic）与 check 通道（checkIssueToLspDiagnostic）
 * 共用本函数 ⇒ 两条通道的 range 口径同源。
 */
export function lspDiagnosticRange(
  start: { line: number; column: number },
  end: { line: number; column: number },
  lengths?: number[],
): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  const sLine = lspLine(start.line);
  const eLine = lspLine(end.line);
  const sChar = clampChar(lspChar(start.column), sLine, lengths);
  const eChar = clampChar(lspChar(end.column), eLine, lengths);
  return {
    start: { line: sLine, character: sChar },
    end: {
      line: eLine,
      character: eLine === sLine ? Math.max(sChar, eChar) : Math.max(0, eChar),
    },
  };
}

/**
 * 会话内已登记的文档行长表（按 cacheKey）：pull 通道（server.ts）调
 * toLspDiagnostic 时**没有源码参数** ⇒ 用会话条目里的行长表夹取 range
 * （Bug 778：push / pull 两条通道都必须夹到行尾，同口径）。
 */
function cachedLineLengths(uri: string): number[] | undefined {
  try {
    return analysisCache.get(cacheKey(uriToFilePath(uri)))?.lineLengths;
  } catch {
    return undefined;
  }
}

/** eval 通道消息：指令文法诊断补上与 check 通道同文案的修复提示（去重键对齐）。 */
function evalChannelMessage(d: JsDiagnostic): string {
  if (d.code !== DIAG.directiveSyntax) return d.message;
  return d.message.includes(DIRECTIVE_SYNTAX_HINT)
    ? d.message
    : `${d.message} · ${DIRECTIVE_SYNTAX_HINT}`;
}

/**
 * eval 通道（service Diagnostic → LSP Diagnostic）。
 *
 * `source` 缺省时用会话条目里的行长表夹取 range（pull 通道无源码参数）。
 */
export function toLspDiagnostic(
  d: JsDiagnostic,
  uri: string,
  source?: string,
): LspDiagnostic {
  return toLspDiagnosticWithLengths(
    d,
    uri,
    source !== undefined ? lineLengthsOf(source) : cachedLineLengths(uri),
  );
}

/** toLspDiagnostic 的行长表版本（同一批诊断只算一次行长表）。 */
function toLspDiagnosticWithLengths(
  d: JsDiagnostic,
  uri: string,
  lengths?: number[],
): LspDiagnostic {
  const diag: LspDiagnostic = {
    severity: severityMap[d.severity],
    range: lspDiagnosticRange(d.range.start, d.range.end, lengths),
    message: evalChannelMessage(d),
    source: "nudo",
    code: d.code,
    data: { ...((d.data as object) ?? {}), suggestions: d.suggestions },
  };
  if (d.tags?.includes("unnecessary")) {
    diag.tags = [DiagnosticTag.Unnecessary];
  }
  if (d.origin) {
    diag.relatedInformation = [{
      location: {
        uri,
        range: lspDiagnosticRange(
          { line: d.origin.line, column: d.origin.column },
          { line: d.origin.line, column: d.origin.column },
          lengths,
        ),
      },
      message: "value originates here",
    }];
  }
  return diag;
}

/** CLI 与 LSP 共用的相对 require 解析（service defaultLoadModule） */
export function lspLoadModule(spec: string, fromFile: string): string | undefined {
  return defaultLoadModule(spec, fromFile);
}

/**
 * A4：侧车未保存 buffer 优先。
 * openText(filePath) 返回编辑器内未落盘文本；命中则覆盖磁盘内容。
 */
export function makeBufferAwareLoadModule(
  openText: (filePath: string) => string | undefined,
): (spec: string, fromFile: string) => string | undefined {
  const tryOpen = (p: string): string | undefined => {
    const open = openText(p);
    return open;
  };
  return (spec: string, fromFile: string) => {
    try {
      // 只在解析结果等于候选路径时用 buffer；禁止「任意 .nudo.js spec → 父侧车」
      // （否则 @nudo:import ./std.nudo.js 会串到打开中的 lib.nudo.js）
      const candidates: string[] = [];
      if (spec.startsWith(".")) {
        const abs = resolvePath(dirname(fromFile), spec);
        candidates.push(abs, `${abs}.js`, `${abs}.mjs`, `${abs}.ts`);
        if (!/\.(js|mjs|ts)$/.test(abs)) {
          candidates.push(`${abs}.nudo.js`, `${abs}.nudo.ts`);
        }
      }
      const sidecar = sidecarPathOf(fromFile);
      const leaf = `./${sidecar.slice(sidecar.lastIndexOf("/") + 1)}`;
      if (spec === leaf || spec === sidecar) {
        candidates.push(sidecar);
      } else if (spec.startsWith(".") && resolvePath(dirname(fromFile), spec) === sidecar) {
        candidates.push(sidecar);
      }
      for (const c of candidates) {
        const open = tryOpen(c);
        if (open !== undefined) return open;
      }
    } catch {
      /* fall through to disk */
    }
    return defaultLoadModule(spec, fromFile);
  };
}

/**
 * IDE 面 generalize/checkSource 共用的模块图（与 CLI `buildCheckInjection`
 * 同源）：不传图时跨模块 import 不可解析 → 调用塌缩 unknown
 * （hover `(_p0: A1) => unknown`、inlay 空、check 假红 unproven-return）。
 *
 * `evalAbsModuleGraph` 走 abs-modules-graph 内容缓存（stat 自愈失效），
 * 同一 (source, deps) 重复调用廉价。cycle → 不注入（fail-closed，
 * 与 CLI hasCycle 分支同语义：宁缺图不注入环）。
 */
export function evalAnalysisModules(
  filePath: string,
  source: string,
): Record<string, AbsModuleExports | Record<string, unknown>> | undefined {
  try {
    const graph = evalAbsModuleGraph(source, filePath);
    if (graph.issues.some((i) => i.kind === "cycle")) return undefined;
    return graph.modules;
  } catch {
    return undefined;
  }
}

/**
 * check 通道 issue → LSP Diagnostic 的**唯一转换点**（Bug 778 / 779）：
 * - **severity（档）与 range（位置）在同一处算出**；env 通道复用同一函数
 *   ⇒ 与主通道**同档同 range**；
 * - info 级**不在此处砍掉**：档位取舍归 `filterCheckLspByLevel`
 *   （`verbose` 才放行 info）。砍在转换之前 ⇒ 下游档位过滤器永远看不到
 *   info ⇒ `nudo.analysis.diagnostics: "verbose"` 对 check 诊断是**空操作**，
 *   且 `nudo:assume-relied` / `nudo:invariant-relied` / `nudo:opaque-result`
 *   永不上屏（Bug 779）。
 */
function checkIssueToLspDiagnostic(i: CheckIssue, lengths?: number[]): LspDiagnostic {
  // core check issue 的 line 是 1 基源码行；无锚点时回落第 1 行，
  // 换算到 LSP 的 0 基后钳位 ≥ 0（Position.line 是 uinteger）——由
  // lspDiagnosticRange 统一算（与 eval 通道同源）。
  const line = i.line ?? 1;
  const column = i.column ?? 0;
  const parts = [i.message];
  if (i.actual) parts.push(`actual: ${i.actual}`);
  if (i.expected) parts.push(`expected: ${i.expected}`);
  if (i.suggestion) parts.push(i.suggestion);
  return {
    severity: severityMap[i.severity],
    range: lspDiagnosticRange({ line, column }, { line, column: column + 1 }, lengths),
    message: parts.join(" · "),
    source: "nudo-check",
    code: i.code,
    data: {
      actual: i.actual,
      expected: i.expected,
      fn: i.fn,
      suggestion: i.suggestion,
      suggestions: i.suggestion ? [i.suggestion] : [],
      reason: i.reason,
      actions: i.actions,
    },
  } satisfies LspDiagnostic;
}

/**
 * Abs check → LSP diagnostics（主通道：约束蕴含，非 TS assignability）。
 */
export function checkToLspDiagnostics(
  filePath: string,
  source: string,
  loadModule?: (spec: string, fromFile: string) => string | undefined,
  /** G7：错误脱敏根（LSP server 注入 workspaceRoots；缺省回落 cwd） */
  workspaceRoots?: string[],
): LspDiagnostic[] {
  try {
    // package.json#nudo.contract.autoBind 与 nudo.check（L2）覆盖 LSP 执法路径
    // —— 与 CLI runCheck 同源（design-cli-semantics §3.4）
    const proj = findProjectConfig(dirname(filePath));
    const autoBind = interfaceConfig(proj?.config).autoBind;
    const cCfg = checkConfig(proj?.config);
    // ignoreThrows 走**配置面解析**（裸字符串 / 数组内逗号都认）⇒ 与 CLI
    // `nudo check` 同口径（service checkConfig 的严格 `string[]` 会把
    // `"TypeError"` / `["TypeError,RangeError"]` 静默丢成空表 ⇒ CLI 绿 / IDE 红）。
    const ignoreThrows = configIgnoreThrows(proj?.config);
    // 模块图：缺图时跨模块调用 unknown → unproven-return 假红（CLI 有图同文件绿）
    const analysisModules = evalAnalysisModules(filePath, source);
    // Bug 634：注入包（modules + mocks + env 全局 + replace/as）——与 CLI
    // `buildCheckInjection` 同源同口径（`buildLspInjection` 是本包的唯一
    // 装配点，agent 工具面复用同一份）。此前本面只传 `modules` ⇒
    // `@nudo:mock` / `@nudo:as` / `@nudo:replace` / env 全局**全部缺席**
    // ⇒ 被 mock 掉的依赖退化成未知全局 ⇒ 报 `nudo:entry-may-throw`（假红）。
    const inject = buildLspInjection(filePath, source, {
      loadModule: loadModule ?? lspLoadModule,
      modules: analysisModules,
    });
    const report = checkSource(filePath, source, pTrue, {
      loadModule: loadModule ?? lspLoadModule,
      fromFile: filePath,
      ...(autoBind === false ? { autoBind: false } : {}),
      ...(proj?.projectDir ? { projectDir: proj.projectDir } : {}),
      entryThrows: cCfg.entryThrows,
      ...(ignoreThrows.length > 0 ? { ignoreThrows } : {}),
      skips: collectSkipReturns(source),
      // 与 CLI `checkSource(..., { modules: inject.modules, inject })` 同形：
      // `modules` 走**并入 env / mock-module 覆盖后**的表（`evalAnalyzeOpts`
      // 取 `opts.modules ?? inject.modules` ⇒ 两者必须同源，否则 env 模块
      // 被未并入的旧表顶掉）。
      ...(Object.keys(inject).length > 0
        ? { modules: inject.modules as never, inject }
        : {}),
    });
    const issues: CheckIssue[] = [...report.issues];
    // D1: 指令文法诊断（nudo:directive-syntax）——与 check CLI 同口径。
    // 显式通道：诊断直接落局部数组（不碰模块级 buffer，无 seq 锚 / 在途窃取窗口）。
    const dirDiags: DirectiveDiag[] = [];
    extractDirectives(parse(source), { diags: dirDiags });
    for (const d of dirDiags) {
      issues.push({
        severity: "warning",
        code: d.code,
        message: d.message,
        suggestion: DIRECTIVE_SYNTAX_HINT,
      });
    }
    // 三档（error / warning / info）**全部保留**——档位取舍交给
    // filterCheckLspByLevel（push / pull 共用同一 helper）。
    const lengths = lineLengthsOf(source);
    return issues.map((i) => checkIssueToLspDiagnostic(i, lengths));
  } catch (err) {
    // 不得静默 `return []` 把门禁通道整段丢掉（constraint-violated 等会无端消失）——
    // 失败本身变成一条 Error 诊断，与 push 的 Analysis error 同口径
    return [
      {
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message: `Check error: ${sanitizeErrorMessage((err as Error).message, workspaceRoots)}`,
        source: "nudo-check",
        code: DIAG.internal,
      },
    ];
  }
}

/**
 * path env 加载失败（import 失败或文件缺失）→ `nudo:env-unresolved` warning。
 * 与 CLI check/test 同源：service `getPathEnvLoadErrors`，消息格式
 * `path env failed to load: <path> — <error>`，从不影响其它诊断。
 *
 * live 瞬态：每轮 validate 现场收集、不随 analysisCache 缓存——分析缓存命中轮
 * analyzeFileAsync 不再 preload，这里显式补一轮（幂等：ESM import 有模块缓存，
 * 常态开销仅 statSync）。只报本轮 env 名单解析出的路径：env 项从配置移除后，
 * 进程级错误表里的陈旧条目不得继续误报。
 *
 * 两类条目（service 侧 env-loader 的记录口径）：
 * - **path 形**：记录的 path = `resolvePath(baseDir, name)`（缺失文件 /
 *   import 失败 / defineEnv 契约违约）——按解析后路径匹配。
 * - **按名字形**：记录的 path = **名字本身**（未知 env 名 `bogus` /
 *   `nodejs`…、非字符串 env 项的 JSON 渲染）——此前只按解析后路径过滤，
 *   这类条目永远匹配不上 ⇒ 在 IDE 里被整条吃掉（#470 / #937）。
 *   按**本文件自己的 env 名单**匹配 ⇒ 同目录别的文件的无 path 诊断
 *   不会误吸进来（`getPathEnvLoadErrors(baseDir)` 已按 baseDir 收窄）。
 *
 * **导出面**（族 26 前置件，给 server.ts 的 pull 诊断面用）：本函数此前是
 * 模块私有的 ⇒ pull handler 拿不到 env 通道（Bug 781 / 992：push 面与
 * CLI 都报 `nudo:env-unresolved`，pull 面静默）。语义不变：
 * `envUnresolvedDiags(filePath, source) → Promise<LspDiagnostic[]>`——
 * live 瞬态收集（不随 analysisCache 缓存）、按本文件 env 名单过滤、
 * 每条都是 `nudo:env-unresolved` warning（与 check 主通道**同档同 range**，
 * 转换走同一个 checkIssueToLspDiagnostic）。
 */
export async function envUnresolvedDiags(
  filePath: string,
  source: string,
): Promise<LspDiagnostic[]> {
  let envNames: string[];
  try {
    envNames = collectEnvNames(filePath, source, true);
  } catch {
    return [];
  }
  if (envNames.length === 0) return [];
  const baseDir = dirname(filePath);
  try {
    await preloadPathEnvs(envNames, baseDir);
  } catch {
    /* preload 自身抛出（stat 竞态等）不拖垮诊断发布 */
  }
  // preloadPathEnvs 记录的 path = resolvePath(baseDir, name)——同式过滤陈旧条目
  const candidates = new Set(envNames.map((n) => resolvePath(baseDir, n)));
  // 按名字发的诊断：记录 path = 名字本身（未知名）/ JSON 渲染（非法 env 项）
  const byName = new Set<string>(envNames);
  for (const raw of envNames as unknown[]) {
    if (typeof raw === "string") continue;
    const rendered = JSON.stringify(raw);
    if (typeof rendered === "string") byName.add(rendered);
  }
  const lengths = lineLengthsOf(source);
  return getPathEnvLoadErrors(baseDir)
    .filter((e) => candidates.has(e.path) || byName.has(e.path))
    // 与 check 主通道**同一个转换点**（同档 = warning，同 range = 无锚点
    // 形态 0:0→0:1）——不得在这里另起一套 range/severity 口径。
    .map((e) =>
      checkIssueToLspDiagnostic(
        {
          severity: "warning",
          code: DIAG.envUnresolved,
          message: `path env failed to load: ${e.path} — ${e.error}`,
        },
        lengths,
      ),
    );
}

/**
 * Analyze one document (async so path-based `@nudo:env` files preload),
 * publish diagnostics, refresh the analysis cache, and — when `propagate` —
 * revalidate open dependents of the changed file once. Propagation-triggered
 * revalidations pass propagate=false, so dirt never cascades further.
 */
export async function validateText(
  filePath: string,
  uri: string,
  text: string,
  version: number,
  deps: ValidateTextDeps,
  propagate = false,
  /** 脏传播：源码未变但依赖变了，必须重算，不可用源码指纹短路 */
  force = false,
): Promise<void> {
  // collector 作用域（幂等）：一次 validate 的完整生命周期（含 analyzeFileAsync
  // 的 preload await 与发布前检查）——交错 validate 各开各的 store，
  // await 窗口不再互相偷诊断/collector（runWithCollectorScope 见 core）。
  return runWithCollectorScope(async () => {
    // A8：编辑风暴取消——同文件新一轮 validate 启动后，旧 await 不得发布陈旧诊断
    const key = cacheKey(filePath);
    const gen = bumpValidateGeneration(key);
    // BUG-021/S5-003：generation 只在 validate 启动 / didClose 时 bump，
    // 文档内容变更（didChange）不 bump——慢分析 + 防抖窗口内旧结果会
    // 发布到已更新的 buffer（squiggle 错位 / 幽灵报错）。补文档
    // version 门：打开中的文档当前 version 必须等于本次启动时的
    // version（宿主未提供文档跟踪时回落 generation-only 旧口径）。
    const stillCurrent = (): boolean =>
      validateGeneration.get(key) === gen &&
      (deps.getOpenDocumentByPath?.(key)?.version ?? version) === version;

    // 零注解文件 gate 放行例外：磁盘上存在同名侧车（interface 档主场景——
    // emit 后的 generated 段 + drift/domain-exceeds 诊断都以侧车为契约源）。
    // autoBind=false 或 node_modules 下不例外（侧车 ambient 整体停用）。
    const sidecarPath = sidecarPathOf(filePath);
    const hasSidecar =
      interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind &&
      !isNodeModulesPath(sidecarPath) &&
      existsSync(sidecarPath);
    if (deps.isNudoUri && !deps.isNudoUri(uri) && !hasSidecar) {
      if (stillCurrent()) deps.sendDiagnostics({ uri, diagnostics: [], version });
      return;
    }

    // B2：内容未变（undo/redo）且非脏传播 → 复用上次 AnalysisResult。
    // activeCases 必须进指纹：selectCase 不 bump 文档 version，只比 sourceHash
    // 会复用上一 case 的诊断/lens。
    // depsHash / 项目配置维：与 getCachedOrAnalyze 同口径，避免 source 未变时
    // 吃陈旧 autoBind/env/diagnostics 结果。
    const activeCases = deps.getActiveCases?.(uri);
    const casesHash = casesFingerprint(activeCases);
    const fp = sourceFingerprint(text);
    // 文档逐行字符数（Bug 778）：诊断 range 夹到行尾用——本轮只算一次
    const lengths = lineLengthsOf(text);
    const cfgHash = projectConfigFingerprint(filePath);
    const depHash = depsFingerprint(filePath, text, deps.loadModule);
    const prev = analysisCache.get(key);
    /** 指纹全中：条目的 lazy 附属产物（checkDiags）仍有效，跨 set 保留 */
    const prevFingerprintHit =
      prev?.sourceHash === fp &&
      prev.casesHash === casesHash &&
      prev.depsHash === depHash &&
      prev.cfgHash === cfgHash;
    let result: AnalysisResult;
    if (
      !force &&
      prevFingerprintHit &&
      prev.result
    ) {
      result = prev.result;
    } else {
      try {
        // E5：deps.loadModule（buffer-aware）传入 analyzeFileAsync——未保存
        // 侧车与 validate/hover/check 同源可见。惰性 case：默认 none / selectCase 后 selected
        const caseMode =
          activeCases && activeCases.size > 0 ? ("selected" as const) : ("none" as const);
        result = await analyzeFileAsync(
          filePath,
          text,
          activeCases,
          undefined,
          deps.loadModule,
          caseMode,
        );
      } catch (err) {
        if (!stillCurrent()) return;
        deps.sendDiagnostics({
          uri,
          version,
          diagnostics: [{
            severity: DiagnosticSeverity.Error,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            message: `Analysis error: ${sanitizeErrorMessage((err as Error).message, deps.workspaceRoots)}`,
            source: "nudo",
          }],
        });
        return;
      }
    }
    // await 期间有更新一轮 validate → 本轮作废（防抖已合并；不发布陈旧结果）
    if (!stillCurrent()) return;

    if (fileCap() > 0) {
      analysisCache.set(key, {
        version,
        result,
        sourceHash: fp,
        casesHash,
        depsHash: depHash,
        cfgHash,
        lineLengths: lineLengthsOf(text),
        ...(prevFingerprintHit && prev?.checkDiags ? { checkDiags: prev.checkDiags } : {}),
      });
      lruTrim(analysisCache, fileCap());
    }
    knownFilesAdd(key);
    registerNudoImportDeps(filePath, text);

    // Abs check 主通道 + evaluator 诊断（A3：按 analysis.diagnostics 档过滤）
    // off：显示路径全静音（与 errors 档区分）。check 门禁 CLI `nudo check` /
    // checkSource 独立，不受 off 影响。
    // P2：与 pull（server.languages.diagnostics）共用同一 helper；经条目缓存
    // （getCachedCheckDiags）——防抖重复 push 不再每次全量 checkSource。
    const checkDiags = getCachedCheckDiags(filePath, text, deps.loadModule, deps.workspaceRoots);
    const level = diagnosticsLevelForFile(filePath);
    const evalJs = filterDiagnosticsByLevel(result.diagnostics, level);
    // range 夹到行尾（Bug 778）：源码在本轮手里 ⇒ 传进去，行长表只算一次
    const evalDiags = evalJs.map((d) => toLspDiagnosticWithLengths(d, uri, lengths));
    // path env 加载失败/缺失：live 瞬态 warning（与 CLI check/test 同源），走
    // check 通道口径（source=nudo-check）并按 analysis.diagnostics 档过滤
    const envDiags = filterCheckLspByLevel(await envUnresolvedDiags(filePath, text), level);
    // 指令文法诊断可能同时出现在 check 通道（checkToLspDiagnostics 显式
    // extract）与 analyzer 通道（analyzeFileUncachedInner drain）——按
    // code+message 去重，避免双报（env 告警并入同一去重键空间）
    const seenCheck = new Set(
      [...checkDiags, ...envDiags].map((d) => `${d.code ?? ""}\0${d.message}`),
    );
    const dedupedEval = evalDiags.filter((d) => !seenCheck.has(`${d.code ?? ""}\0${d.message}`));
    // 发布前再确认 generation + 文档 version，避免 check 路径上的
    // await 竞态覆盖更新 push（BUG-021/S5-003）
    if (!stillCurrent()) return;
    deps.sendDiagnostics({ uri, version, diagnostics: [...checkDiags, ...envDiags, ...dedupedEval] });

    if (!propagate || !deps.getOpenDocumentByPath) return;

    const selfKey = cacheKey(filePath);
    let dependents: Map<string, Set<string>>;
    try {
      // 传入会话级 moduleGraphCache：未变文件仅 stat 比对即复用边集，跳过重读重解析
      ({ dependents } = buildModuleGraph([...knownFiles], moduleGraphCache));
    } catch {
      return;
    }
    // 边目标（resolveModuleFile fs 原生形态）与 knownFiles（cacheKey 形态）跨形态
    // 查找会漏边（Windows）——统一过 cacheKey 再算脏集，并用同一 selfKey 跳过自身。
    for (const dirtyPath of computeDirtySet(cacheKeyGraph(dependents), selfKey)) {
      if (dirtyPath === selfKey) continue;
      const doc = deps.getOpenDocumentByPath(dirtyPath);
      if (!doc) continue;
      // 依赖内容变了但父文件源码未变：整文件 AnalysisResult / evaluator / fn-cache 键不含 dep 指纹
      evictEvalCacheForFiles([dirtyPath]);
      evictAnalysisFileCacheForFiles([dirtyPath]);
      evictFnAnalysisCacheForFiles([dirtyPath]);
      // path-env 全局工厂须清（防投毒）；abs-module 中间模块条目的正确性由其
      // 子树内容指纹复核兜住（DESIGN-002，docs/design/cache-invalidation.md）——
      // 这里只逐出变更文件自身的条目（内存回收 + 同 size/同 mtime 残余缺口）。
      clearPathEnvCaches();
      evictAbsModuleCacheFiles([filePath]);
      await validateText(dirtyPath, doc.uri, doc.getText(), doc.version, deps, false, true);
    }
  });
}
