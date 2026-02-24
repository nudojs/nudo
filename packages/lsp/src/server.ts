import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
  type Diagnostic as LspDiagnostic,
  DiagnosticSeverity,
  DiagnosticTag,
  type CompletionItem as LspCompletionItem,
  CompletionItemKind,
  MarkupKind,
  type CodeLens,
  CodeLensRefreshRequest,
  type InlayHint,
  InlayHintKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { typeValueToString } from "@nudo/core";
import {
  analyzeFile,
  getTypeAtPosition,
  getCompletionsAtPosition,
  getCasesForFile,
  type DiagnosticSeverity as JsDiagSeverity,
} from "@nudo/service";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const activeCases = new Map<string, Map<string, number>>();

function getActiveCasesForUri(uri: string): Map<string, number> {
  const existing = activeCases.get(uri);
  if (existing) return existing;
  const map = new Map<string, number>();
  activeCases.set(uri, map);
  return map;
}

const severityMap: Record<JsDiagSeverity, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
};

connection.onInitialize((_params: InitializeParams): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Full,
    hoverProvider: true,
    completionProvider: {
      triggerCharacters: ["."],
      resolveProvider: false,
    },
    codeLensProvider: {
      resolveProvider: false,
    },
    inlayHintProvider: true,
  },
}));

let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

documents.onDidChangeContent((change) => {
  const uri = change.document.uri;
  nudoFileCache.delete(uri);
  const existing = debounceTimers.get(uri);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    uri,
    setTimeout(() => {
      debounceTimers.delete(uri);
      validateDocument(change.document);
    }, 300),
  );
});

documents.onDidClose((event) => {
  const timer = debounceTimers.get(event.document.uri);
  if (timer) clearTimeout(timer);
  debounceTimers.delete(event.document.uri);
  nudoFileCache.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

function validateDocument(document: TextDocument): void {
  const uri = document.uri;
  if (!isNudoFile(uri)) {
    connection.sendDiagnostics({ uri, diagnostics: [] });
    return;
  }

  const filePath = uriToFilePath(uri);
  const source = document.getText();
  const cases = getActiveCasesForUri(uri);

  try {
    const result = analyzeFile(filePath, source, cases);
    const diagnostics: LspDiagnostic[] = result.diagnostics.map((d) => {
      const diag: LspDiagnostic = {
        severity: severityMap[d.severity],
        range: {
          start: { line: d.range.start.line - 1, character: d.range.start.column },
          end: { line: d.range.end.line - 1, character: d.range.end.column },
        },
        message: d.message,
        source: "nudo",
      };
      if (d.tags?.includes("unnecessary")) {
        diag.tags = [DiagnosticTag.Unnecessary];
      }
      return diag;
    });
    connection.sendDiagnostics({ uri, diagnostics });
  } catch (err) {
    connection.sendDiagnostics({
      uri,
      diagnostics: [
        {
          severity: DiagnosticSeverity.Error,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: `Analysis error: ${(err as Error).message}`,
          source: "nudo",
        },
      ],
    });
  }
}

connection.onHover((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  if (!isNudoFile(params.textDocument.uri)) return null;

  const filePath = uriToFilePath(params.textDocument.uri);
  const source = document.getText();
  const line = params.position.line + 1;
  const column = params.position.character;
  const cases = getActiveCasesForUri(params.textDocument.uri);

  try {
    const tv = getTypeAtPosition(filePath, source, line, column, cases);
    if (!tv) return null;

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `\`\`\`nudo\n${typeValueToString(tv)}\n\`\`\``,
      },
    };
  } catch {
    return null;
  }
});

connection.onCompletion((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  const filePath = uriToFilePath(params.textDocument.uri);
  const source = document.getText();
  const line = params.position.line + 1;
  const column = params.position.character;

  try {
    const items = getCompletionsAtPosition(filePath, source, line, column);
    return items.map((item): LspCompletionItem => ({
      label: item.label,
      kind: item.kind === "method"
        ? CompletionItemKind.Method
        : item.kind === "property"
          ? CompletionItemKind.Property
          : CompletionItemKind.Variable,
      detail: item.detail,
    }));
  } catch {
    return [];
  }
});

connection.onCodeLens((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  const filePath = uriToFilePath(params.textDocument.uri);
  const source = document.getText();
  const cases = getActiveCasesForUri(params.textDocument.uri);

  try {
    const fnCases = getCasesForFile(filePath, source);
    const lenses: CodeLens[] = [];

    for (const fn of fnCases) {
      if (fn.cases.length === 0) continue;
      const activeIdx = cases.get(fn.functionName) ?? 0;

      for (const c of fn.cases) {
        const isActive = c.index === activeIdx;
        const title = isActive ? `● case "${c.name}"` : `○ case "${c.name}"`;
        lenses.push({
          range: {
            start: { line: fn.loc.start.line - 1, character: 0 },
            end: { line: fn.loc.start.line - 1, character: 0 },
          },
          command: {
            title,
            command: "nudo.selectCase",
            arguments: [params.textDocument.uri, fn.functionName, c.index, c.name],
          },
        });
      }
    }

    return lenses;
  } catch {
    return [];
  }
});

connection.languages.inlayHint.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  const filePath = uriToFilePath(params.textDocument.uri);
  const source = document.getText();
  const cases = getActiveCasesForUri(params.textDocument.uri);
  const lines = source.split("\n");

  try {
    const result = analyzeFile(filePath, source, cases);
    const hints: InlayHint[] = [];

    for (const hint of result.caseHints) {
      const lineIdx = hint.line - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) continue;
      const lineLen = lines[lineIdx].length;

      hints.push({
        position: { line: lineIdx, character: lineLen },
        label: `  ${hint.label}`,
        kind: InlayHintKind.Type,
        paddingLeft: true,
      });
    }

    return hints;
  } catch {
    return [];
  }
});

connection.onRequest("nudo/selectCase", (params: { uri: string; functionName: string; caseIndex: number }) => {
  const cases = getActiveCasesForUri(params.uri);
  cases.set(params.functionName, params.caseIndex);

  const document = documents.get(params.uri);
  if (document) {
    validateDocument(document);
  }

  connection.sendRequest(CodeLensRefreshRequest.type).catch(() => {});

  return { success: true };
});

connection.onRequest("nudo/getActiveCases", (params: { uri: string }) => {
  const cases = getActiveCasesForUri(params.uri);
  const result: Record<string, number> = {};
  for (const [fn, idx] of cases) {
    result[fn] = idx;
  }
  return result;
});

const nudoFileCache = new Map<string, boolean>();

function isNudoFile(uri: string): boolean {
  if (!uri.endsWith(".js") && !uri.endsWith(".ts") && !uri.endsWith(".mjs")) return false;
  const cached = nudoFileCache.get(uri);
  if (cached !== undefined) return cached;
  const doc = documents.get(uri);
  if (!doc) return false;
  const result = hasNudoDirectives(doc.getText());
  nudoFileCache.set(uri, result);
  return result;
}

function hasNudoDirectives(source: string): boolean {
  return /@nudo:(case|mock|pure|skip|sample|returns)\b/.test(source);
}

function uriToFilePath(uri: string): string {
  return uri.startsWith("file://") ? decodeURIComponent(uri.slice(7)) : uri;
}

documents.listen(connection);
connection.listen();
