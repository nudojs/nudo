import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
  type CompletionItem as LspCompletionItem,
  CompletionItemKind,
  MarkupKind,
  type CodeLens,
  CodeLensRefreshRequest,
  FileChangeType,
  type FileEvent,
  type InlayHint,
  InlayHintKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { typeValueToString } from "@nudojs/core";
import {
  getTypeAtPosition,
  getCompletionsAtPosition,
  getCasesForFile,
} from "@nudojs/service";
import { parse } from "@nudojs/parser";
import { buildSymbolTable, findDefinition, findReferences, findIdentifierAtPosition } from "./symbols.ts";
import { TOKEN_TYPES, TOKEN_MODIFIERS } from "./semantic-tokens.ts";
import {
  analysisCache,
  evictModuleGraphCacheEntries,
  forgetValidatedFile,
  getCachedOrAnalyze,
  hasNudoDirectives,
  toLspDiagnostic,
  uriToFilePath,
  validateText,
  type ValidateTextDeps,
} from "./validation.ts";
import {
  normalizeFilePath,
  suggestCase,
  trace,
  whatIf,
  type AgentToolDeps,
  type AgentToolResult,
} from "./agent-tools.ts";

const NUDO_COMMANDS = [
  "nudo.whatIf",
  "nudo.suggestCase",
  "nudo.trace",
  "nudo.selectCase",
  "nudo.getActiveCases",
] as const;

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
    executeCommandProvider: {
      commands: [...NUDO_COMMANDS],
    },
    diagnosticProvider: {
      interFileDependencies: false,
      workspaceDiagnostics: false,
    },
  },
}));

let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// 打开即验证：didOpen 不会触发 onDidChangeContent，若不在此主动验证，
// 新打开的文件要等到首次编辑（300ms 防抖后）或客户端 pull 诊断才有结果。
// propagate=true 与编辑防抖路径同语义（含对打开依赖项的一次脏传播）。
documents.onDidOpen((event) => {
  nudoFileCache.delete(event.document.uri);
  validateDocument(event.document, true).catch(() => {});
});

documents.onDidChangeContent((change) => {
  const uri = change.document.uri;
  nudoFileCache.delete(uri);
  const existing = debounceTimers.get(uri);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    uri,
    setTimeout(() => {
      debounceTimers.delete(uri);
      validateDocument(change.document, true).catch(() => {});
    }, 300),
  );
});

documents.onDidClose((event) => {
  const timer = debounceTimers.get(event.document.uri);
  if (timer) clearTimeout(timer);
  debounceTimers.delete(event.document.uri);
  nudoFileCache.delete(event.document.uri);
  analysisCache.delete(uriToFilePath(event.document.uri));
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

/**
 * watched-files 删除事件监听器：接收「被删除且不在打开集」的 uri 列表。
 * 缓存逐出等后续逻辑通过 registerWatchedFilesListener 挂到这里。
 */
export const watchedFilesListeners: Array<(uris: string[]) => void> = [];

/** 注册 watched-files 监听器，返回注销函数。 */
export function registerWatchedFilesListener(listener: (uris: string[]) => void): () => void {
  watchedFilesListeners.push(listener);
  return () => {
    const idx = watchedFilesListeners.indexOf(listener);
    if (idx >= 0) watchedFilesListeners.splice(idx, 1);
  };
}

/**
 * watched-files 事件核心：对 Deleted 且不在打开集的文件清理会话登记项
 * （knownFiles/analysisCache 走 forgetValidatedFile，activeCases/nudoFileCache 按 uri），
 * 清空其已发布诊断，并把被清理的 uri 列表广播给监听器。
 * 打开中的文件跳过——其内容由编辑流负责，外部删除会被编辑器以 didOpen/didChange 覆盖。
 */
function handleWatchedFilesChanges(changes: readonly FileEvent[], isOpen: (uri: string) => boolean): string[] {
  const gone: string[] = [];
  for (const change of changes) {
    if (change.type !== FileChangeType.Deleted) continue;
    if (isOpen(change.uri)) continue;
    gone.push(change.uri);
    forgetValidatedFile(uriToFilePath(change.uri));
    activeCases.delete(change.uri);
    nudoFileCache.delete(change.uri);
    connection.sendDiagnostics({ uri: change.uri, diagnostics: [] });
  }
  if (gone.length > 0) {
    // 拷贝后再遍历：监听器内注销自身不应影响本轮广播
    for (const listener of [...watchedFilesListeners]) {
      try {
        listener(gone);
      } catch {
        // 单个监听器异常不阻断其余监听器的缓存逐出
      }
    }
  }
  return gone;
}

connection.onDidChangeWatchedFiles((event) =>
  handleWatchedFilesChanges(event.changes, (uri) => documents.get(uri) !== undefined),
);

// 模块图边缓存逐出：收到被清理 uri 时逐出 moduleGraphCache 对应 filePath 的条目。
// 会话级常驻注册，无需持有注销函数。
registerWatchedFilesListener(evictModuleGraphCacheEntries);

function validationDeps(): ValidateTextDeps {
  return {
    sendDiagnostics: (params) => connection.sendDiagnostics(params),
    isNudoUri: (uri) => isNudoFile(uri),
    getActiveCases: (uri) => getActiveCasesForUri(uri),
    getOpenDocumentByPath: (filePath) =>
      documents.all().find((doc) => uriToFilePath(doc.uri) === filePath),
  };
}

function validateDocument(document: TextDocument, propagate = false): Promise<void> {
  return validateText(
    uriToFilePath(document.uri),
    document.uri,
    document.getText(),
    document.version,
    validationDeps(),
    propagate,
  );
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
    const result = getCachedOrAnalyze(filePath, source, document.version, cases);
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

/** Resolve a `uri`- or `file`-identified target to the uri key used by activeCases/documents. */
function uriForFileOrUri(params: { uri?: string; file?: string }): string {
  if (params.uri) return params.uri;
  const filePath = normalizeFilePath(params.file ?? "");
  const doc = documents.all().find((d) => uriToFilePath(d.uri) === filePath);
  return doc ? doc.uri : `file://${filePath}`;
}

async function handleSelectCase(params: { uri?: string; file?: string; functionName: string; caseIndex: number }) {
  const uri = uriForFileOrUri(params);
  const cases = getActiveCasesForUri(uri);
  cases.set(params.functionName, params.caseIndex);

  const document = documents.get(uri);
  if (document) {
    await validateDocument(document);
  }

  connection.sendRequest(CodeLensRefreshRequest.type).catch(() => {});

  return { success: true };
}

function handleGetActiveCases(params: { uri?: string; file?: string }) {
  const cases = getActiveCasesForUri(uriForFileOrUri(params));
  const result: Record<string, number> = {};
  for (const [fn, idx] of cases) {
    result[fn] = idx;
  }
  return result;
}

const agentToolDeps: AgentToolDeps = {
  getOpenText: (filePath) => {
    const doc = documents.all().find((d) => uriToFilePath(d.uri) === filePath);
    return doc ? { text: doc.getText() } : undefined;
  },
};

/**
 * One dispatch table shared by the executeCommand commands (`nudo.*`) and the
 * custom request aliases (`nudo/…`) — both channels run the same handlers.
 */
function dispatchNudoCommand(command: string, arg: Record<string, unknown>) {
  switch (command) {
    case "nudo.whatIf":
      return whatIf(arg as Parameters<typeof whatIf>[0], agentToolDeps);
    case "nudo.suggestCase":
      return suggestCase(arg as Parameters<typeof suggestCase>[0], agentToolDeps);
    case "nudo.trace":
      return trace(arg as Parameters<typeof trace>[0], agentToolDeps);
    case "nudo.selectCase":
      return handleSelectCase(arg as Parameters<typeof handleSelectCase>[0]);
    case "nudo.getActiveCases":
      return handleGetActiveCases(arg as Parameters<typeof handleGetActiveCases>[0]);
    default:
      return null;
  }
}

connection.onExecuteCommand((params) =>
  dispatchNudoCommand(params.command, (params.arguments?.[0] as Record<string, unknown>) ?? {}),
);

connection.onRequest("nudo/selectCase", handleSelectCase);

connection.onRequest("nudo/getActiveCases", handleGetActiveCases);

/** Request aliases share the command handlers; the pinned return type keeps onRequest overload inference happy. */
function dispatchAgentRequest(command: string, params: Record<string, unknown>): AgentToolResult {
  return dispatchNudoCommand(command, params) as AgentToolResult;
}

connection.onRequest("nudo/whatIf", (params: Record<string, unknown>) => dispatchAgentRequest("nudo.whatIf", params));
connection.onRequest("nudo/suggestCase", (params: Record<string, unknown>) => dispatchAgentRequest("nudo.suggestCase", params));
connection.onRequest("nudo/trace", (params: Record<string, unknown>) => dispatchAgentRequest("nudo.trace", params));

connection.languages.diagnostics.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return { kind: "full", items: [] };
  if (!isNudoFile(params.textDocument.uri)) return { kind: "full", items: [] };

  try {
    const filePath = uriToFilePath(document.uri);
    const result = getCachedOrAnalyze(filePath, document.getText(), document.version, getActiveCasesForUri(document.uri));
    return {
      kind: "full",
      items: result.diagnostics.map((d) => toLspDiagnostic(d, document.uri)),
    };
  } catch {
    return { kind: "full", items: [] };
  }
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

documents.listen(connection);
connection.listen();
