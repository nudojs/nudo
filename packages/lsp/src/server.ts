import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
  type Diagnostic as LspDiagnostic,
  DiagnosticSeverity,
  type CompletionItem as LspCompletionItem,
  CompletionItemKind,
  MarkupKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { typeValueToString } from "@justscript/core";
import {
  analyzeFile,
  getTypeAtPosition,
  getCompletionsAtPosition,
  type DiagnosticSeverity as JsDiagSeverity,
} from "@justscript/service";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

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
  },
}));

let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

documents.onDidChangeContent((change) => {
  const uri = change.document.uri;
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
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

function validateDocument(document: TextDocument): void {
  const uri = document.uri;
  if (!isJustFile(uri)) {
    connection.sendDiagnostics({ uri, diagnostics: [] });
    return;
  }

  const filePath = uriToFilePath(uri);
  const source = document.getText();

  try {
    const result = analyzeFile(filePath, source);
    const diagnostics: LspDiagnostic[] = result.diagnostics.map((d) => ({
      severity: severityMap[d.severity],
      range: {
        start: { line: d.range.start.line - 1, character: d.range.start.column },
        end: { line: d.range.end.line - 1, character: d.range.end.column },
      },
      message: d.message,
      source: "justscript",
    }));
    connection.sendDiagnostics({ uri, diagnostics });
  } catch (err) {
    connection.sendDiagnostics({
      uri,
      diagnostics: [
        {
          severity: DiagnosticSeverity.Error,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: `Analysis error: ${(err as Error).message}`,
          source: "justscript",
        },
      ],
    });
  }
}

connection.onHover((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  if (!isJustFile(params.textDocument.uri)) return null;

  const filePath = uriToFilePath(params.textDocument.uri);
  const source = document.getText();
  const line = params.position.line + 1;
  const column = params.position.character;

  try {
    const tv = getTypeAtPosition(filePath, source, line, column);
    if (!tv) return null;

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `\`\`\`justscript\n${typeValueToString(tv)}\n\`\`\``,
      },
    };
  } catch {
    return null;
  }
});

connection.onCompletion((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isJustFile(params.textDocument.uri)) return [];

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

function isJustFile(uri: string): boolean {
  return uri.endsWith(".just.js") || uri.endsWith(".just.ts");
}

function uriToFilePath(uri: string): string {
  return uri.startsWith("file://") ? decodeURIComponent(uri.slice(7)) : uri;
}

documents.listen(connection);
connection.listen();
