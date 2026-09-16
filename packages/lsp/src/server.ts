#!/usr/bin/env node
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
  type CompletionItem as LspCompletionItem,
  CompletionItemKind,
  SymbolKind as LspSymbolKind,
  type DocumentSymbol,
  type SymbolInformation,
  MarkupKind,
  type CodeLens,
  CodeLensRefreshRequest,
  FileChangeType,
  type FileEvent,
  type InlayHint,
  InlayHintKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { typeValueToString, sidecarPathOf } from "@nudojs/core";
import {
  getTypeAtPosition,
  getHoverAtPosition,
  getCompletionsAtPosition,
  buildSemanticTokens,
  isNudoTargetPath,
  collectAbsInlays,
  findProjectConfig,
  interfaceConfig,
} from "@nudojs/service";
import { parse } from "@nudojs/parser";
import { documentSymbols, findIdentifierAtPosition, resolveDefinition, resolveReferences, type DocumentSymbolItem } from "./symbols.ts";
import { TOKEN_TYPES, TOKEN_MODIFIERS } from "./semantic-tokens.ts";
import {
  analysisCache,
  knownFiles,
  evictModuleGraphCacheEntries,
  forgetValidatedFile,
  getCachedOrAnalyze,
  handleNudoDepFileChanged,
  hasNudoDirectives,
  lspLoadModule,
  registerNudoImportDeps,
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
  checkTool,
  hoverTool,
  inferTool,
  interfaceTool,
  interfaceEmitTool,
  interfacePositionalArgs,
  interfaceEmitPositionalArgs,
  computeInterfaceLenses,
  type AgentToolDeps,
  type AgentToolResult,
} from "./agent-tools.ts";

const NUDO_COMMANDS = [
  "nudo.whatIf",
  "nudo.suggestCase",
  "nudo.trace",
  "nudo.check",
  "nudo.hover",
  "nudo.infer",
  "nudo.interface",
  "nudo.interfaceEmit",
  "nudo.interface.emit",
  "nudo.selectCase",
  "nudo.getActiveCases",
] as const;

// Default to stdio when the host did not pick a transport (Zed, MCP bridges,
// `nudo-lsp` with no args). VS Code passes --node-ipc via vscode-languageclient.
if (
  !process.argv.some(
    (a) => a === "--stdio" || a === "--node-ipc" || a.startsWith("--socket="),
  )
) {
  process.argv.push("--stdio");
}

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

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoots = (params.workspaceFolders ?? [])
    .map((w) => uriToFilePath(w.uri))
    .filter(Boolean);
  if (workspaceRoots.length === 0 && params.rootUri) {
    const root = uriToFilePath(params.rootUri);
    if (root) workspaceRoots = [root];
  }
  return {
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
    documentSymbolProvider: true,
    workspaceSymbolProvider: true,
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
  };
});

/** LSP client workspace folders（emit 路径边界用） */
let workspaceRoots: string[] = [];

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
  activeCases.delete(event.document.uri);
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
function isNudoDepPath(filePath: string): boolean {
  return /\.nudo\.(js|mjs|ts)$/.test(filePath);
}

function handleWatchedFilesChanges(changes: readonly FileEvent[], isOpen: (uri: string) => boolean): string[] {
  const gone: string[] = [];
  const nudoTouched: string[] = [];
  for (const change of changes) {
    const filePath = uriToFilePath(change.uri);
    if (change.type === FileChangeType.Deleted) {
      if (isOpen(change.uri)) continue;
      gone.push(change.uri);
      forgetValidatedFile(filePath);
      activeCases.delete(change.uri);
      nudoFileCache.delete(change.uri);
      connection.sendDiagnostics({ uri: change.uri, diagnostics: [] });
      if (isNudoDepPath(filePath)) nudoTouched.push(filePath);
      continue;
    }
    // Create/Change：契约模板变更 → 定向逐出 L0 + 重检打开中的父文件
    if (isNudoDepPath(filePath)) {
      nudoTouched.push(filePath);
    }
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
  if (nudoTouched.length > 0) {
    const deps = validationDeps();
    for (const p of nudoTouched) {
      void handleNudoDepFileChanged(p, deps).catch(() => {});
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
    const hover = getHoverAtPosition(filePath, source, line, column, cases);
    if (!hover) return null;

    const lines: string[] = [];
    // 无损 Abs 优先（类型即计算本体）
    if (hover.absMultiline) {
      lines.push("```nudo", hover.absMultiline, "```");
    } else if (hover.abs) {
      lines.push("```nudo", hover.abs, "```");
    }
    if (hover.intension && hover.intension !== hover.abs) {
      lines.push("```nudo", hover.intension, "```");
    }
    // 外延 TypeValue 仅作对照，且与内涵不同时才显示
    if (hover.typeText && hover.typeText !== hover.intension && hover.typeText !== hover.abs) {
      lines.push("```nudo", `ext: ${hover.typeText}`, "```");
    }
    if (lines.length === 0) {
      lines.push("```nudo", hover.typeText, "```");
    }
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: lines.join("\n"),
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
  // interface 档的目标场景就是零注解文件（侧车同名绑定，§2.1 主路径），
  // 因此这里放宽为 isNudoTargetPath 而非 isNudoFile——case 副层只依赖
  // 指令，注解文件行为不变；hover/inlayHint/semanticTokens 仍走 isNudoFile。
  if (!isNudoTargetPath(uriToFilePath(params.textDocument.uri))) return [];

  const filePath = uriToFilePath(params.textDocument.uri);
  const source = document.getText();
  const cases = getActiveCasesForUri(params.textDocument.uri);

  try {
    // interface 档在前（默认层 + 固化动作），case 降为 debug 副层跟随其后
    // （design-refine-derivation §8）；标题与命令与既有 case lens 零改动。
    const lenses: CodeLens[] = [];
    const autoBind = interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind;
    for (const lens of computeInterfaceLenses(source, filePath, {
      loadModule: lspLoadModule,
      activeCases: cases,
      ...(autoBind === false ? { autoBind: false } : {}),
    })) {
      const range = {
        start: { line: lens.line - 1, character: 0 },
        end: { line: lens.line - 1, character: 0 },
      };
      if (lens.kind === "interface") {
        lenses.push({
          range,
          // 只读打印当前 interface（点击即 `nudo.interface`，无写盘）
          command: {
            title: `● interface / ${lens.source}`,
            command: "nudo.interface",
            arguments: [params.textDocument.uri, lens.fn],
          },
        });
      } else if (lens.kind === "emit") {
        lenses.push({
          range,
          command: {
            title: lens.mode === "add" ? "⚡ persist interface" : "↻ update interface",
            command: "nudo.interfaceEmit",
            arguments: [params.textDocument.uri, lens.fn, lens.mode],
          },
        });
      } else {
        lenses.push({
          range,
          command: {
            title: lens.active ? `● case "${lens.caseName}"` : `○ case "${lens.caseName}"`,
            command: "nudo.selectCase",
            arguments: [params.textDocument.uri, lens.fn, lens.caseIndex, lens.caseName],
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

    // Abs inlay：参数约束 + 返回 term/pred（类型即计算，无损）
    try {
      for (const abs of collectAbsInlays(source, {
        loadModule: lspLoadModule,
        fromFile: filePath,
      })) {
        const lineIdx = abs.line - 1;
        if (lineIdx < 0 || lineIdx >= lines.length) continue;
        hints.push({
          position: { line: lineIdx, character: abs.character },
          label: abs.label,
          kind:
            abs.kind === "parameter"
              ? InlayHintKind.Parameter
              : InlayHintKind.Type,
          paddingLeft: true,
        });
      }
    } catch {
      // Abs inlay 失败不影响 caseHints
    }

    return hints;
  } catch {
    return [];
  }
});

function filePathToUri(filePath: string): string {
  if (filePath.startsWith("file://")) return filePath;
  // Windows 路径保留盘符；POSIX 直接拼
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.startsWith("/")
    ? `file://${normalized}`
    : `file:///${normalized}`;
}

/** 打开文档 + 会话 knownFiles，供跨文件 references 扫描 */
function navigationExtraFiles(currentPath: string): string[] {
  const open = documents.all().map((d) => uriToFilePath(d.uri));
  const all = new Set<string>([...open, ...knownFiles, currentPath]);
  return [...all];
}

connection.onDocumentSymbol((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  try {
    const ast = parse(document.getText());
    const toLsp = (s: DocumentSymbolItem): DocumentSymbol => ({
      name: s.name,
      detail: s.detail,
      kind: s.kind as LspSymbolKind,
      range: s.range,
      selectionRange: s.selectionRange,
      children: s.children?.map(toLsp),
    });
    return documentSymbols(ast).map(toLsp);
  } catch {
    return [];
  }
});

connection.onWorkspaceSymbol((params) => {
  const query = params.query.toLowerCase();
  const out: SymbolInformation[] = [];
  const files = new Set<string>([...knownFiles]);
  for (const d of documents.all()) files.add(uriToFilePath(d.uri));
  for (const filePath of files) {
    const doc = documents.all().find((d) => uriToFilePath(d.uri) === filePath);
    let source: string | undefined;
    if (doc) {
      source = doc.getText();
    } else {
      try {
        source = readFileSync(filePath, "utf-8");
      } catch {
        source = undefined;
      }
    }
    if (source === undefined) continue;
    try {
      const ast = parse(source);
      const uri = doc?.uri ?? filePathToUri(filePath);
      for (const sym of documentSymbols(ast)) {
        if (query && !sym.name.toLowerCase().includes(query)) continue;
        out.push({
          name: sym.name,
          kind: sym.kind as LspSymbolKind,
          location: {
            uri,
            range: {
              start: { line: sym.selectionRange.start.line, character: sym.selectionRange.start.character },
              end: { line: sym.selectionRange.end.line, character: sym.selectionRange.end.character },
            },
          },
        });
      }
    } catch {
      /* skip unparseable */
    }
  }
  return out;
});

connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  if (!isNudoFile(params.textDocument.uri)) return null;

  const source = document.getText();
  const filePath = uriToFilePath(params.textDocument.uri);
  const line = params.position.line + 1;
  const column = params.position.character;

  try {
    const ast = parse(source);
    const identAtPos = findIdentifierAtPosition(ast, line, column);
    if (!identAtPos) return null;

    const def = resolveDefinition(filePath, source, identAtPos, {
      extraFiles: navigationExtraFiles(filePath),
      workspaceFallback: true,
    });
    if (!def) return null;

    return {
      uri: filePathToUri(def.filePath),
      range: {
        start: { line: def.loc.start.line - 1, character: def.loc.start.column },
        end: { line: def.loc.end.line - 1, character: def.loc.end.column },
      },
    };
  } catch {
    return null;
  }
});

connection.onReferences((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  const source = document.getText();
  const filePath = uriToFilePath(params.textDocument.uri);
  const line = params.position.line + 1;
  const column = params.position.character;

  try {
    const ast = parse(source);
    const identAtPos = findIdentifierAtPosition(ast, line, column);
    if (!identAtPos) return [];

    const refs = resolveReferences(filePath, source, identAtPos, {
      extraFiles: navigationExtraFiles(filePath),
      includeDeclaration: params.context?.includeDeclaration !== false,
    });
    return refs.map((ref) => ({
      uri: ref.uri ? filePathToUri(ref.uri) : params.textDocument.uri,
      range: {
        start: { line: ref.loc.start.line - 1, character: ref.loc.start.column },
        end: { line: ref.loc.end.line - 1, character: ref.loc.end.column },
      },
    }));
  } catch {
    return [];
  }
});

connection.onRenameRequest((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  if (!isNudoFile(params.textDocument.uri)) return null;

  const source = document.getText();
  const filePath = uriToFilePath(params.textDocument.uri);
  const line = params.position.line + 1;
  const column = params.position.character;

  try {
    const ast = parse(source);
    const identAtPos = findIdentifierAtPosition(ast, line, column);
    if (!identAtPos) return null;

    // 跨文件：definition + references 一起改
    const def = resolveDefinition(filePath, source, identAtPos);
    const refs = resolveReferences(filePath, source, identAtPos, {
      extraFiles: navigationExtraFiles(filePath),
    });

    const changes: Record<string, Array<{ range: any; newText: string }>> = {};
    const push = (uri: string, loc: { start: { line: number; column: number }; end: { line: number; column: number } }) => {
      const list = (changes[uri] ??= []);
      list.push({
        range: {
          start: { line: loc.start.line - 1, character: loc.start.column },
          end: { line: loc.end.line - 1, character: loc.end.column },
        },
        newText: params.newName,
      });
    };

    if (def) {
      push(filePathToUri(def.filePath), def.loc);
    }
    for (const ref of refs) {
      push(ref.uri ? filePathToUri(ref.uri) : params.textDocument.uri, ref.loc);
    }

    // 去重（同一 uri 下相同 range）
    for (const uri of Object.keys(changes)) {
      const seen = new Set<string>();
      changes[uri] = changes[uri]!.filter((e) => {
        const key = `${e.range.start.line}:${e.range.start.character}:${e.range.end.line}:${e.range.end.character}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    if (Object.keys(changes).length === 0) return null;
    return { changes };
  } catch {
    return null;
  }
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

  try {
    const filePath = uriToFilePath(document.uri);
    return { data: buildSemanticTokens(filePath, document.getText()) };
  } catch {
    return { data: [] };
  }
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

/**
 * `nudo.interfaceEmit`：与 CLI `nudo interface --emit` 同一写盘器固化单个
 * 导出（design-refine-derivation §7.5）。写盘后：
 * 1. 重登记隐式侧车边（新建侧车在上次验证时不存在，边未登记）并定向
 *    逐出依赖 memo、重检打开中的父文件（handleNudoDepFileChanged）；
 * 2. 该文件若打开则重验证（validateDocument，侧车新内容进诊断/缓存）；
 * 3. 广播 CodeLensRefresh（固化后 persist → update 档切换）。
 */
async function handleInterfaceEmit(params: {
  uri?: string;
  file?: string;
  functionName: string;
  mode: "add" | "update";
}): Promise<AgentToolResult> {
  const filePath = params.uri
    ? uriToFilePath(params.uri)
    : normalizeFilePath(params.file ?? "");
  const toolResult = await interfaceEmitTool({
    file: filePath,
    functionName: params.functionName,
    mode: params.mode,
  });

  // emit 失败（入参校验 / 写盘异常）：不进入失效链路——侧车并未写入，
  // 「sidecar written but cache invalidation failed」会撒谎并叠加二次异常
  const emitText = toolResult.content[0]?.text ?? "";
  if (emitText.startsWith("Error:")) {
    connection.sendRequest(CodeLensRefreshRequest.type).catch(() => {});
    return toolResult;
  }

  // 侧车写盘/新建后的缓存失效与重验证（agent 面按路径调用时文件可能未打开）
  let invalidateError: string | undefined;
  try {
    const openDoc = documents.all().find((d) => uriToFilePath(d.uri) === filePath);
    registerNudoImportDeps(filePath, openDoc ? openDoc.getText() : readFileSync(filePath, "utf-8"));
    await handleNudoDepFileChanged(sidecarPathOf(filePath), validationDeps());
    if (openDoc) {
      analysisCache.delete(filePath); // version 键未变，逐出防 getCachedOrAnalyze 命中陈旧结果
      await validateDocument(openDoc);
    }
  } catch (e) {
    // 写盘已成功；失效/重验证失败须可见——否则用户看到 written 但诊断/lens 仍是旧契约
    invalidateError = e instanceof Error ? e.message : String(e);
    connection.console.error(`nudo.interfaceEmit: sidecar written but cache invalidation failed: ${invalidateError}`);
  }

  connection.sendRequest(CodeLensRefreshRequest.type).catch(() => {});
  if (invalidateError) {
    return {
      content: [
        {
          type: "text" as const,
          text: `${emitText}\n\n[warning] sidecar written but cache invalidation failed (diagnostics/lenses may be stale): ${invalidateError}`,
        },
      ],
    };
  }
  return toolResult;
}

const agentToolDeps: AgentToolDeps = {
  getOpenText: (filePath) => {
    const doc = documents.all().find((d) => uriToFilePath(d.uri) === filePath);
    return doc ? { text: doc.getText() } : undefined;
  },
  get workspaceRoots() {
    return workspaceRoots;
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
    case "nudo.check":
      return checkTool(arg as Parameters<typeof checkTool>[0], agentToolDeps);
    case "nudo.hover":
      return hoverTool(arg as Parameters<typeof hoverTool>[0], agentToolDeps);
    case "nudo.infer":
      return inferTool(arg as Parameters<typeof inferTool>[0], agentToolDeps);
    case "nudo.interface":
      return interfaceTool(arg as Parameters<typeof interfaceTool>[0], agentToolDeps);
    case "nudo.interfaceEmit":
    case "nudo.interface.emit":
      return handleInterfaceEmit(arg as Parameters<typeof handleInterfaceEmit>[0]);
    case "nudo.selectCase":
      return handleSelectCase(arg as Parameters<typeof handleSelectCase>[0]);
    case "nudo.getActiveCases":
      return handleGetActiveCases(arg as Parameters<typeof handleGetActiveCases>[0]);
    default:
      return null;
  }
}

connection.onExecuteCommand((params) => {
  const args = params.arguments ?? [];
  // CodeLens (and some clients) pass selectCase positionally:
  //   [uri, functionName, caseIndex, caseName]
  // Agent bridges pass a single object: { uri|file, functionName, caseIndex }.
  if (
    params.command === "nudo.selectCase" &&
    args.length >= 3 &&
    typeof args[0] === "string"
  ) {
    return handleSelectCase({
      uri: args[0] as string,
      functionName: args[1] as string,
      caseIndex: args[2] as number,
    });
  }
  // CodeLens passes interface print positionally: [uri, functionName?]
  if (params.command === "nudo.interface") {
    const bridged = interfacePositionalArgs(args);
    if (bridged) return interfaceTool(bridged, agentToolDeps);
  }
  // CodeLens passes interfaceEmit positionally: [uri, functionName, mode]
  if (params.command === "nudo.interfaceEmit") {
    const bridged = interfaceEmitPositionalArgs(args);
    if (bridged) {
      return handleInterfaceEmit({
        file: bridged.file,
        functionName: bridged.functionName,
        mode: bridged.mode,
      });
    }
  }
  return dispatchNudoCommand(params.command, (args[0] as Record<string, unknown>) ?? {});
});

connection.onRequest("nudo/selectCase", handleSelectCase);

connection.onRequest("nudo/getActiveCases", handleGetActiveCases);

/** Request aliases share the command handlers; the pinned return type keeps onRequest overload inference happy. */
function dispatchAgentRequest(
  command: string,
  params: Record<string, unknown>,
): AgentToolResult | Promise<AgentToolResult> {
  return dispatchNudoCommand(command, params) as AgentToolResult | Promise<AgentToolResult>;
}

// Request aliases: slash-form (`nudo/check`) is the protocol contract; dot-form
// (`nudo.check`) mirrors the executeCommand command names that MCP-bridge
// clients reuse as request methods. Both spellings route to the same handlers.
for (const name of ["whatIf", "suggestCase", "trace", "check", "hover", "infer", "interface", "interface.emit"] as const) {
  const command = `nudo.${name}`;
  const handler = (params: Record<string, unknown>) => dispatchAgentRequest(command, params);
  connection.onRequest(`nudo/${name}`, handler);
  connection.onRequest(command, handler);
}

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
  // 推断目标判定收敛到 service 层（TaskA 提供）：.js/.mjs/.ts 为目标，
  // .d.ts（类型声明，harvester 输入）与 .tsx/.jsx 等一律排除
  if (!isNudoTargetPath(uriToFilePath(uri))) return false;
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
