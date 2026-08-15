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
import { typeValueToString } from "@nudojs/core";
import {
  analyzeFile,
  getTypeAtPosition,
  getCompletionsAtPosition,
  getCasesForFile,
  type DiagnosticSeverity as JsDiagSeverity,
} from "@nudojs/service";
import { parse } from "@nudojs/parser";
import { buildSymbolTable, findDefinition, findReferences, findIdentifierAtPosition } from "./symbols.ts";
import { TOKEN_TYPES, TOKEN_MODIFIERS } from "./semantic-tokens.ts";

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
    definitionProvider: true,
    referencesProvider: true,
    renameProvider: true,
    codeActionProvider: {
      codeActionKinds: ["quickfix"],
    },
    signatureHelpProvider: {
      triggerCharacters: ["(", ","],
    },
    semanticTokensProvider: {
      full: true,
      legend: {
        tokenTypes: [...TOKEN_TYPES],
        tokenModifiers: [...TOKEN_MODIFIERS],
      },
    },
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
        code: d.code,
        data: { ...(d.data as object || {}), suggestions: d.suggestions },
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

connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  if (!isNudoFile(params.textDocument.uri)) return null;

  const source = document.getText();
  const ast = parse(source);
  const table = buildSymbolTable(ast, params.textDocument.uri);

  const line = params.position.line + 1;
  const column = params.position.character;
  const identAtPos = findIdentifierAtPosition(ast, line, column);
  if (!identAtPos) return null;

  const def = findDefinition(table, identAtPos);
  if (!def) return null;

  return {
    uri: params.textDocument.uri,
    range: {
      start: { line: def.loc.start.line - 1, character: def.loc.start.column },
      end: { line: def.loc.end.line - 1, character: def.loc.end.column },
    },
  };
});

connection.onReferences((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  const source = document.getText();
  const ast = parse(source);
  const table = buildSymbolTable(ast, params.textDocument.uri);

  const line = params.position.line + 1;
  const column = params.position.character;
  const identAtPos = findIdentifierAtPosition(ast, line, column);
  if (!identAtPos) return [];

  const refs = findReferences(table, identAtPos);
  return refs.map((ref) => ({
    uri: params.textDocument.uri,
    range: {
      start: { line: ref.loc.start.line - 1, character: ref.loc.start.column },
      end: { line: ref.loc.end.line - 1, character: ref.loc.end.column },
    },
  }));
});

connection.onRenameRequest((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  if (!isNudoFile(params.textDocument.uri)) return null;

  const source = document.getText();
  const ast = parse(source);
  const table = buildSymbolTable(ast, params.textDocument.uri);

  const line = params.position.line + 1;
  const column = params.position.character;
  const identAtPos = findIdentifierAtPosition(ast, line, column);
  if (!identAtPos) return null;

  const def = findDefinition(table, identAtPos);
  const refs = findReferences(table, identAtPos);

  const edits = [];

  if (def) {
    edits.push({
      range: {
        start: { line: def.loc.start.line - 1, character: def.loc.start.column },
        end: { line: def.loc.end.line - 1, character: def.loc.end.column },
      },
      newText: params.newName,
    });
  }

  for (const ref of refs) {
    edits.push({
      range: {
        start: { line: ref.loc.start.line - 1, character: ref.loc.start.column },
        end: { line: ref.loc.end.line - 1, character: ref.loc.end.column },
      },
      newText: params.newName,
    });
  }

  return {
    changes: {
      [params.textDocument.uri]: edits,
    },
  };
});

connection.onCodeAction((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  const actions = [];

  for (const diag of params.context.diagnostics) {
    if (diag.code === "nudo-unreachable") {
      actions.push({
        title: "Remove unreachable code",
        kind: "quickfix",
        diagnostics: [diag],
        edit: {
          changes: {
            [params.textDocument.uri]: [{
              range: diag.range,
              newText: "",
            }],
          },
        },
      });
    }

    if (diag.code === "nudo-assertion-failed") {
      actions.push({
        title: "Update @nudo:returns to match inferred type",
        kind: "quickfix",
        diagnostics: [diag],
        isPreferred: false,
      });
    }
  }

  return actions;
});

connection.onSignatureHelp((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  if (!isNudoFile(params.textDocument.uri)) return null;

  const filePath = uriToFilePath(params.textDocument.uri);
  const source = document.getText();
  const line = params.position.line + 1;
  const column = params.position.character;
  const cases = getActiveCasesForUri(params.textDocument.uri);

  try {
    const ast = parse(source);
    const callInfo = findEnclosingCall(ast, line, column);
    if (!callInfo) return null;

    const fnType = getTypeAtPosition(filePath, source, callInfo.calleeLine, callInfo.calleeCol, cases);
    if (!fnType || fnType.kind !== "function") return null;

    const paramLabels = fnType.params.map((p) => `${p}: unknown`);
    const activeParam = callInfo.currentParamIndex;

    return {
      signatures: [{
        label: `(${paramLabels.join(", ")}) => unknown`,
        parameters: paramLabels.map((label) => ({ label })),
        activeParameter: activeParam,
      }],
      activeSignature: 0,
      activeParameter: activeParam,
    };
  } catch {
    return null;
  }
});

function findEnclosingCall(ast: any, line: number, column: number): { calleeLine: number; calleeCol: number; currentParamIndex: number } | null {
  let result: any = null;

  function visit(node: any): void {
    if (!node || result) return;

    if (node.type === "CallExpression") {
      const loc = node.loc;
      if (loc && loc.start.line <= line && loc.end.line >= line) {
        const calleeLoc = node.callee.loc;
        if (calleeLoc) {
          let paramIndex = 0;
          for (let i = 0; i < node.arguments.length; i++) {
            const argLoc = node.arguments[i].loc;
            if (argLoc) {
              if (argLoc.start.line < line || (argLoc.start.line === line && argLoc.start.column <= column)) {
                paramIndex = i + 1;
              }
            }
          }
          result = {
            calleeLine: calleeLoc.start.line,
            calleeCol: calleeLoc.start.column,
            currentParamIndex: Math.min(paramIndex, node.arguments.length),
          };
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "type" || key === "loc" || key === "start" || key === "end") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && item.type) visit(item);
        }
      } else if (child && typeof child === "object" && child.type) {
        visit(child);
      }
    }
  }

  visit(ast);
  return result;
}

connection.languages.semanticTokens.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return { data: [] };
  if (!isNudoFile(params.textDocument.uri)) return { data: [] };

  // For now, return empty tokens - can be enhanced later
  return { data: [] };
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
  return /@nudo:(case|mock|pure|skip|sample|returns|env|mock-module|as|replace)\b/.test(source);
}

function uriToFilePath(uri: string): string {
  return uri.startsWith("file://") ? decodeURIComponent(uri.slice(7)) : uri;
}

documents.listen(connection);
connection.listen();
