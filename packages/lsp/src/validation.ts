/**
 * Core validation + analysis-cache logic for the LSP server, extracted from
 * server.ts so it can be exercised directly in tests without a live LSP
 * connection. server.ts wires these functions to `connection` / `documents`;
 * tests wire them to fakes.
 */
import {
  analyzeFile,
  analyzeFileAsync,
  buildModuleGraph,
  computeDirtySet,
  type AnalysisResult,
  type Diagnostic as JsDiagnostic,
  type DiagnosticSeverity as JsDiagSeverity,
} from "@nudojs/service";
import {
  DiagnosticSeverity,
  DiagnosticTag,
  type Diagnostic as LspDiagnostic,
} from "vscode-languageserver/node";

/** Per-file analysis cache; version comes from TextDocument.version. */
export const analysisCache = new Map<string, { version: number; result: AnalysisResult }>();

/** Every file analyzed successfully in this session (import-graph nodes for dirty propagation). */
export const knownFiles = new Set<string>();

/** Test hook — resets module-level session state. */
export function clearValidationState(): void {
  analysisCache.clear();
  knownFiles.clear();
}

export function hasNudoDirectives(source: string): boolean {
  return /@nudo:(case|mock|pure|skip|sample|returns|env|mock-module|as|replace)\b/.test(source);
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
  deps.sendDiagnostics({ uri, diagnostics: result.diagnostics.map((d) => toLspDiagnostic(d, uri)) });

  if (!propagate || !deps.getOpenDocumentByPath) return;

  let dependents: Map<string, Set<string>>;
  try {
    ({ dependents } = buildModuleGraph([...knownFiles]));
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
