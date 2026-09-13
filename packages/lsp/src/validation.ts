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
  clearAbsModuleCache,
  evictAbsModuleCacheFiles,
  type AnalysisResult,
  type Diagnostic as JsDiagnostic,
  type DiagnosticSeverity as JsDiagSeverity,
  type ModuleGraphCache,
} from "@nudojs/service";
import {
  checkSource,
  pTrue,
  resetGeneralizeMemo,
  evictGeneralizeMemoForPaths,
  extractNudoImports,
} from "@nudojs/core";
import {
  DiagnosticSeverity,
  DiagnosticTag,
  type Diagnostic as LspDiagnostic,
} from "vscode-languageserver/node";

/** Per-file analysis cache; version comes from TextDocument.version. */
export const analysisCache = new Map<string, { version: number; result: AnalysisResult }>();

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

function normPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** 每次 validate 后刷新：parent 的全部 @nudo:import 边 */
export function registerNudoImportDeps(filePath: string, source: string): void {
  const parent = normPath(resolvePath(filePath));
  for (const set of nudoDepParents.values()) {
    set.delete(parent);
  }
  const imports = extractNudoImports(source);
  for (const imp of imports) {
    if (!imp.spec.startsWith(".") && !imp.spec.startsWith("/")) continue;
    const dep = normPath(resolvePath(dirname(filePath), imp.spec));
    let set = nudoDepParents.get(dep);
    if (!set) {
      set = new Set();
      nudoDepParents.set(dep, set);
    }
    set.add(parent);
  }
}

/**
 * `*.nudo.js` 创建/变更：定向逐出 L0 memo 中依赖该文件的条目，
 * 并重检打开中的父文件（propagate=false，不级联）。
 */
export async function handleNudoDepFileChanged(
  nudoPath: string,
  deps: ValidateTextDeps,
): Promise<void> {
  const p = normPath(resolvePath(nudoPath));
  evictGeneralizeMemoForPaths([p]);
  const parents = nudoDepParents.get(p);
  if (!parents || parents.size === 0) return;
  for (const parent of [...parents]) {
    const doc = deps.getOpenDocumentByPath?.(parent);
    if (!doc) continue;
    await validateText(
      parent,
      doc.uri,
      doc.getText(),
      doc.version,
      deps,
      false,
    );
  }
}

/** Test hook — resets module-level session state. */
export function clearValidationState(): void {
  analysisCache.clear();
  knownFiles.clear();
  moduleGraphCache.clear();
  nudoDepParents.clear();
  clearAbsModuleCache();
  resetGeneralizeMemo();
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
  return /@nudo:(case|mock|pure|skip|sample|refine|import|env|mock-module|as|replace)\b/.test(source);
}

export function uriToFilePath(uri: string): string {
  return uri.startsWith("file://") ? decodeURIComponent(uri.slice(7)) : uri;
}

/**
 * Cache-aware sync analysis for high-frequency handlers: returns the cached
 * result when the document version matches, otherwise falls back to sync
 * analyzeFile (path-based `@nudo:env` files degrade here — the async preload
 * only runs on the validation path).
 */
export function getCachedOrAnalyze(
  filePath: string,
  source: string,
  version: number,
  activeCases?: Map<string, number>,
): AnalysisResult {
  const cached = analysisCache.get(filePath);
  if (cached && cached.version === version) return cached.result;
  const result = analyzeFile(filePath, source, activeCases);
  analysisCache.set(filePath, { version, result });
  return result;
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
 * Abs check → LSP diagnostics（主通道：约束蕴含，非 TS assignability）。
 */
export function checkToLspDiagnostics(
  filePath: string,
  source: string,
  loadModule?: (spec: string, fromFile: string) => string | undefined,
): LspDiagnostic[] {
  try {
    const report = checkSource(filePath, source, pTrue, {
      loadModule: loadModule ?? lspLoadModule,
      fromFile: filePath,
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
): Promise<void> {
  if (deps.isNudoUri && !deps.isNudoUri(uri)) {
    deps.sendDiagnostics({ uri, diagnostics: [] });
    return;
  }

  let result: AnalysisResult;
  try {
    result = await analyzeFileAsync(filePath, text, deps.getActiveCases?.(uri));
  } catch (err) {
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

  analysisCache.set(filePath, { version, result });
  knownFiles.add(filePath);
  registerNudoImportDeps(filePath, text);

  // Abs check 主通道 + evaluator 诊断
  const checkDiags = checkToLspDiagnostics(filePath, text);
  const evalDiags = result.diagnostics.map((d) => toLspDiagnostic(d, uri));
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
    await validateText(dirtyPath, doc.uri, doc.getText(), doc.version, deps, false);
  }
}
