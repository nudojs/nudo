/**
 * Core validation + analysis-cache logic for the LSP server, extracted from
 * server.ts so it can be exercised directly in tests without a live LSP
 * connection. server.ts wires these functions to `connection` / `documents`;
 * tests wire them to fakes.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath, join } from "node:path";
import {
  analyzeFile,
  analyzeFileAsync,
  buildModuleGraph,
  computeDirtySet,
  defaultLoadModule,
  clearAnalysisSessionCaches,
  evictAbsModuleCacheFiles,
  evictBPathCacheForFiles,
  evictAnalysisFileCacheForFiles,
  evictFnAnalysisCacheForFiles,
  findProjectConfig,
  interfaceConfig,
  checkConfig,
  collectSkipReturns,
  filterDiagnosticsByLevel,
  diagnosticsLevelForFile,
  isProjectConfigPath,
  isNudoTargetPath,
  type AnalysisResult,
  type Diagnostic as JsDiagnostic,
  type DiagnosticSeverity as JsDiagSeverity,
  type ModuleGraphCache,
} from "@nudojs/service";

export { filterDiagnosticsByLevel, diagnosticsLevelForFile };
import {
  checkSource,
  pTrue,
  evictGeneralizeMemoForPaths,
  evictCheckSourceMemoForPaths,
  extractAllLoadSpecs,
  extractNudoImports,
  isNodeModulesPath,
  resolveDepPath,
  sidecarPathOf,
  sidecarSpecsOf,
} from "@nudojs/core";
import { createHash } from "node:crypto";

function sourceFingerprint(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

/**
 * 项目配置指纹：analysis.mode / diagnostics / autoBind / env / callSiteBudget /
 * evalMissingSlot 变更必须 miss analysisCache（与 CLI force-full 同口径）。
 */
function projectConfigFingerprint(filePath: string): string {
  try {
    const proj = findProjectConfig(dirname(filePath));
    const cfg = proj?.config ?? {};
    return sourceFingerprint(
      JSON.stringify({
        autoBind: cfg.contract?.autoBind ?? true,
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
  }
>();

function casesFingerprint(cases?: Map<string, number>): string {
  if (!cases || cases.size === 0) return "-";
  return [...cases.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
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
  const gen = (validateGeneration.get(filePath) ?? 0) + 1;
  validateGeneration.set(filePath, gen);
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
  const ALWAYS_KEEP = new Set([
    "nudo:entry-may-throw",
    "nudo:constraint-violated",
    "nudo:assign-mismatch",
    "nudo:arg-structure",
    "nudo:case-inconsistency",
    "nudo:interface-param-mismatch",
    "nudo:interface-conflict",
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

/** 每次 validate 后刷新：parent 的全部 @nudo:import 边 + autoBind 隐式侧车边
 *  （自身侧车 + 每个依赖文件的侧车——跨文件被调按定义文件路径绑定，
 *   依赖侧车变更同样须重检 parent；与 loadModuleDepsFingerprint 同口径） */
export function registerNudoImportDeps(filePath: string, source: string): void {
  const parent = normPath(resolvePath(filePath));
  for (const set of nudoDepParents.values()) {
    set.delete(parent);
  }
  const imports = extractNudoImports(source);
  for (const imp of imports) {
    if (!imp.spec.startsWith(".") && !imp.spec.startsWith("/")) continue;
    const dep = normPath(resolvePath(dirname(filePath), imp.spec));
    addNudoDepParent(dep, parent);
  }
  registerSidecarClosureFor(parent, parent);
  for (const spec of extractAllLoadSpecs(source)) {
    if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
    const dep = normPath(resolvePath(dirname(filePath), spec));
    // 相对 load-module 本身也是分析依赖：变更必须触发 parent 重检
    // （只登记其侧车不够——实现文件内容进 dep 指纹）
    if (!isNodeModulesPath(dep)) addNudoDepParent(dep, parent);
    registerSidecarClosureFor(dep, parent);
  }
}

function addNudoDepParent(dep: string, parent: string): void {
  let set = nudoDepParents.get(dep);
  if (!set) {
    set = new Set();
    nudoDepParents.set(dep, set);
  }
  set.add(parent);
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
  const p = normPath(resolvePath(nudoPath));
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
  const parents = nudoDepParents.get(p);
  const parentSet = new Set<string>(parents ?? []);
  // 普通 import/实现文件：从 module graph 取 transitive dependents
  // （外部编辑 utils.js 时打开中的 parent 必须失效）
  if (isNudoTargetPath(p)) {
    try {
      const { dependents } = buildModuleGraph([...knownFiles], moduleGraphCache);
      for (const d of computeDirtySet(dependents, p)) {
        parentSet.add(normPath(resolvePath(d)));
      }
    } catch {
      /* graph rebuild failure → fall back to nudoDepParents only */
    }
  }
  if (parentSet.size === 0) return;
  const parentList = [...parentSet];
  // 父文件源码未变但依赖内容变了：整文件 check / B-path / AnalysisResult / fn-cache 都可能陈旧
  evictBPathCacheForFiles(parentList);
  evictAnalysisFileCacheForFiles(parentList);
  evictFnAnalysisCacheForFiles(parentList);
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
  // service+core 会话 memo 全清（B-path / analysis-file / fn-analysis /
  // abs-module / generalize L0 / check 整文件 / nudo-module exec）
  clearAnalysisSessionCaches();
}

/**
 * watched-files Deleted 清理：从会话登记中移除一个文件（knownFiles + analysisCache）。
 * server.ts 的 DidChangeWatchedFiles handler 对「被删除且不在打开集」的文件逐个调用；
 * 仅关闭（文件仍在磁盘上）不走这里，关闭文件仍可作为依赖图节点参与脏传播。
 */
export function forgetValidatedFile(filePath: string): void {
  const parent = normPath(resolvePath(filePath));
  knownFiles.delete(filePath);
  analysisCache.delete(filePath);
  for (const set of nudoDepParents.values()) {
    set.delete(parent);
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
  for (const p of paths) moduleGraphCache.delete(p);
  evictAbsModuleCacheFiles(paths);
}

export function hasNudoDirectives(source: string): boolean {
  return /@nudo:(case|mock|pure|skip|sample|refine|interface|import|env|mock-module|as|replace)\b/.test(source);
}

export function uriToFilePath(uri: string): string {
  return uri.startsWith("file://") ? decodeURIComponent(uri.slice(7)) : uri;
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
  const cached = analysisCache.get(filePath);
  // 版本 + activeCases 指纹同时命中才复用：case 切换不 bump 文档 version，
  // 漏掉 casesHash 会把上一 case 的分析结果/lens 原样吐回（B2）
  const casesHash = casesFingerprint(activeCases);
  const depsHash = depsFingerprint(filePath, loadModule);
  const cfgHash = projectConfigFingerprint(filePath);
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
  analysisCache.set(filePath, {
    version,
    result,
    sourceHash: sourceFingerprint(source),
    casesHash,
    depsHash,
    cfgHash,
  });
  return result;
}

/** 侧车/依赖内容指纹：loadModule 可见的 sidecar 文本 hash */
function depsFingerprint(
  filePath: string,
  loadModule?: (spec: string, fromFile: string) => string | undefined,
): string {
  if (!loadModule) return "-";
  try {
    const sp = sidecarPathOf(filePath);
    const base = normPath(filePath).replace(/\\/g, "/");
    const dir = base.slice(0, base.lastIndexOf("/"));
    const leaf = sp.slice(sp.lastIndexOf("/") + 1);
    const spec = `./${leaf}`;
    const text = loadModule(spec, filePath) ?? loadModule(spec, `${dir}/`);
    return sourceFingerprint(text ?? "");
  } catch {
    return "-";
  }
}

export type OpenDocumentLike = {
  uri: string;
  version: number;
  getText(): string;
};

export type ValidateTextDeps = {
  sendDiagnostics: (params: { uri: string; diagnostics: LspDiagnostic[] }) => void;
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
};

const severityMap: Record<JsDiagSeverity, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
};

export function toLspDiagnostic(d: JsDiagnostic, uri: string): LspDiagnostic {
  const diag: LspDiagnostic = {
    severity: severityMap[d.severity],
    range: {
      start: { line: d.range.start.line - 1, character: d.range.start.column },
      end: { line: d.range.end.line - 1, character: d.range.end.column },
    },
    message: d.message,
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
        range: {
          start: { line: d.origin.line - 1, character: d.origin.column },
          end: { line: d.origin.line - 1, character: d.origin.column },
        },
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
 * Abs check → LSP diagnostics（主通道：约束蕴含，非 TS assignability）。
 */
export function checkToLspDiagnostics(
  filePath: string,
  source: string,
  loadModule?: (spec: string, fromFile: string) => string | undefined,
): LspDiagnostic[] {
  try {
    // package.json#nudo.contract.autoBind 与 nudo.check（L2）覆盖 LSP 执法路径
    // —— 与 CLI runCheck 同源（design-cli-semantics §3.4）
    const proj = findProjectConfig(dirname(filePath));
    const autoBind = interfaceConfig(proj?.config).autoBind;
    const cCfg = checkConfig(proj?.config);
    const report = checkSource(filePath, source, pTrue, {
      loadModule: loadModule ?? lspLoadModule,
      fromFile: filePath,
      ...(autoBind === false ? { autoBind: false } : {}),
      ...(proj?.projectDir ? { projectDir: proj.projectDir } : {}),
      entryThrows: cCfg.entryThrows,
      ...(cCfg.ignoreThrows.length > 0 ? { ignoreThrows: cCfg.ignoreThrows } : {}),
      skips: collectSkipReturns(source),
    });
    return report.issues
      .filter((i) => i.severity === "error" || i.severity === "warning")
      .map((i) => {
        const line = (i.line ?? 1) - 1;
        const col = i.column ?? 0;
        const parts = [i.message];
        if (i.actual) parts.push(`actual: ${i.actual}`);
        if (i.expected) parts.push(`expected: ${i.expected}`);
        if (i.suggestion) parts.push(i.suggestion);
        return {
          severity:
            i.severity === "error"
              ? DiagnosticSeverity.Error
              : i.severity === "warning"
                ? DiagnosticSeverity.Warning
                : DiagnosticSeverity.Information,
          range: {
            start: { line, character: col },
            end: { line, character: col + 1 },
          },
          message: parts.join(" · "),
          source: "nudo-check",
          code: i.code,
          data: {
            actual: i.actual,
            expected: i.expected,
            fn: i.fn,
            suggestions: i.suggestion ? [i.suggestion] : [],
          },
        } satisfies LspDiagnostic;
      });
  } catch {
    return [];
  }
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
  // A8：编辑风暴取消——同文件新一轮 validate 启动后，旧 await 不得发布陈旧诊断
  const gen = bumpValidateGeneration(filePath);
  const stillCurrent = (): boolean => validateGeneration.get(filePath) === gen;

  // 零注解文件 gate 放行例外：磁盘上存在同名侧车（interface 档主场景——
  // emit 后的 generated 段 + drift/domain-exceeds 诊断都以侧车为契约源）。
  // autoBind=false 或 node_modules 下不例外（侧车 ambient 整体停用）。
  const sidecarPath = sidecarPathOf(filePath);
  const hasSidecar =
    interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind &&
    !isNodeModulesPath(sidecarPath) &&
    existsSync(sidecarPath);
  if (deps.isNudoUri && !deps.isNudoUri(uri) && !hasSidecar) {
    if (stillCurrent()) deps.sendDiagnostics({ uri, diagnostics: [] });
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
  const cfgHash = projectConfigFingerprint(filePath);
  const depHash = depsFingerprint(filePath, deps.loadModule);
  const prev = analysisCache.get(filePath);
  let result: AnalysisResult;
  if (
    !force &&
    prev?.sourceHash === fp &&
    prev.casesHash === casesHash &&
    prev.depsHash === depHash &&
    prev.cfgHash === cfgHash &&
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
        diagnostics: [{
          severity: DiagnosticSeverity.Error,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: `Analysis error: ${(err as Error).message}`,
          source: "nudo",
        }],
      });
      return;
    }
  }
  // await 期间有更新一轮 validate → 本轮作废（防抖已合并；不发布陈旧结果）
  if (!stillCurrent()) return;

  analysisCache.set(filePath, {
    version,
    result,
    sourceHash: fp,
    casesHash,
    depsHash: depHash,
    cfgHash,
  });
  knownFiles.add(filePath);
  registerNudoImportDeps(filePath, text);

  // Abs check 主通道 + evaluator 诊断（A3：按 analysis.diagnostics 档过滤）
  // off：显示路径全静音（与 errors 档区分）。check 门禁 CLI `nudo check` /
  // checkSource 独立，不受 off 影响。
  const level = diagnosticsLevelForFile(filePath);
  // P2：与 pull（server.languages.diagnostics）共用同一 helper
  const checkDiags = filterCheckLspByLevel(
    checkToLspDiagnostics(filePath, text, deps.loadModule),
    level,
  );
  const evalJs = filterDiagnosticsByLevel(result.diagnostics, level);
  const evalDiags = evalJs.map((d) => toLspDiagnostic(d, uri));
  // P2：发布前再确认 generation，避免 check 路径上的 await 竞态覆盖更新 push
  if (!stillCurrent()) return;
  deps.sendDiagnostics({ uri, diagnostics: [...checkDiags, ...evalDiags] });

  if (!propagate || !deps.getOpenDocumentByPath) return;

  let dependents: Map<string, Set<string>>;
  try {
    // 传入会话级 moduleGraphCache：未变文件仅 stat 比对即复用边集，跳过重读重解析
    ({ dependents } = buildModuleGraph([...knownFiles], moduleGraphCache));
  } catch {
    return;
  }
  for (const dirtyPath of computeDirtySet(dependents, filePath)) {
    if (dirtyPath === filePath) continue;
    const doc = deps.getOpenDocumentByPath(dirtyPath);
    if (!doc) continue;
    // 依赖内容变了但父文件源码未变：整文件 AnalysisResult / B-path / fn-cache 键不含 dep 指纹
    evictBPathCacheForFiles([dirtyPath]);
    evictAnalysisFileCacheForFiles([dirtyPath]);
    evictFnAnalysisCacheForFiles([dirtyPath]);
    await validateText(dirtyPath, doc.uri, doc.getText(), doc.version, deps, false, true);
  }
}
