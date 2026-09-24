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
  DiagnosticRefreshRequest,
  FileChangeType,
  type FileEvent,
  type InlayHint,
  InlayHintKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { sidecarPathOf } from "@nudojs/core";
import {
  getTypeAtPosition,
  getHoverAtPosition,
  getCompletionsAtPosition,
  buildSemanticTokens,
  isNudoTargetPath,
  shouldAnalyzeFile,
  collectAbsInlays,
  findProjectConfig,
  interfaceConfig,
  isSidecarPath,
  isProjectConfigPath,
  isWatchRelevantPath,
} from "@nudojs/service";
import { parse } from "@nudojs/parser";
import {
  documentSymbols,
  findIdentifierAtPosition,
  resolveDefinition,
  resolveDefinitionLocations,
  resolveReferences,
  renameTargetAt,
  collectMethodReferences,
  buildRenameEdits,
  type DocumentSymbolItem,
} from "./symbols.ts";
import { findFnContractInsertPos } from "./sidecar-insert.ts";
import { buildSignatureHelp } from "./signature-help.ts";
import { TOKEN_TYPES, TOKEN_MODIFIERS } from "./semantic-tokens.ts";
import {
  analysisCache,
  knownFiles,
  evictModuleGraphCacheEntries,
  forgetValidatedFile,
  getCachedOrAnalyze,
  handleNudoDepFileChanged,
  lspLoadModule,
  makeBufferAwareLoadModule,
  registerNudoImportDeps,
  toLspDiagnostic,
  uriToFilePath,
  validateText,
  filterDiagnosticsByLevel,
  diagnosticsLevelForFile,
  checkToLspDiagnostics,
  filterCheckLspByLevel,
  bumpValidateGeneration,
  type ValidateTextDeps,
} from "./validation.ts";
import {
  normalizeFilePath,
  suggestCase,
  trace,
  whatIf,
  checkTool,
  hoverTool,
  testTool,
  contractTool,
  contractDraftTool,
  contractEmitTool,
  contractPositionalArgs,
  contractEmitPositionalArgs,
  computeInterfaceLenses,
  computeObservationLenses,
  type AgentToolDeps,
  type AgentToolResult,
} from "./agent-tools.ts";
import { extractToWorkspaceEdit, fullDocumentRange } from "./extract-function.ts";
import { inlineVariableAt, makeParamOptionalAt } from "./refactor-b2.ts";
import { NUDO_EXECUTE_COMMANDS, NUDO_AGENT_TOOL_NAMES } from "./public-api.ts";

const NUDO_COMMANDS = NUDO_EXECUTE_COMMANDS;

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

/** A4：打开中的侧车 buffer 优先于磁盘（未保存编辑即时生效） */
const activeLoadModule = makeBufferAwareLoadModule((filePath: string) => {
  const doc = documents.all().find((d) => uriToFilePath(d.uri) === filePath);
  return doc?.getText();
});

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
      // `.` 成员；`@` 指令（Helix 等弱 UI 也可在注释里触发）
      triggerCharacters: [".", "@"],
      resolveProvider: false,
    },
    codeLensProvider: {
      resolveProvider: false,
    },
    inlayHintProvider: true,
    definitionProvider: true,
    referencesProvider: true,
    renameProvider: { prepareProvider: true },
    documentSymbolProvider: true,
    workspaceSymbolProvider: true,
    codeActionProvider: {
      codeActionKinds: ["quickfix", "refactor.extract", "refactor.inline", "refactor.rewrite"],
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
/** pull 诊断客户端：依赖/侧车变更后广播 workspace/diagnostic/refresh */
function refreshPullDiagnostics(): void {
  connection
    .sendRequest(DiagnosticRefreshRequest.type)
    .catch(() => {});
}

documents.onDidOpen((event) => {
  nudoFileCache.delete(event.document.uri);
  const openPath = uriToFilePath(event.document.uri);
  // A4：打开侧车（含新建 buffer）→ 立即尝试重检已登记 parent
  if (isNudoDepPath(openPath)) {
    void handleNudoDepFileChanged(openPath, validationDeps())
      .then(() => refreshPullDiagnostics())
      .catch(() => {});
  }
  validateDocument(event.document, true).catch(() => {});
});

documents.onDidChangeContent((change) => {
  const uri = change.document.uri;
  const filePath = uriToFilePath(uri);
  nudoFileCache.delete(uri);
  const existing = debounceTimers.get(uri);
  if (existing) clearTimeout(existing);

  // A8：大文件拉长防抖，避免编辑风暴排队爆炸；取消由 validateGeneration 保证
  const len = change.document.getText().length;
  const delay = len > 200_000 ? 800 : len > 50_000 ? 400 : 300;

  debounceTimers.set(
    uri,
    setTimeout(() => {
      debounceTimers.delete(uri);
      // A4：buffer 内编辑侧车 → 定向逐出 + 重检打开中的 parent
      // （activeLoadModule 会让 parent 分析读到未保存侧车内容）
      if (isNudoDepPath(filePath)) {
        void handleNudoDepFileChanged(filePath, validationDeps())
          .then(() => refreshPullDiagnostics())
          .catch(() => {});
      }
      validateDocument(change.document, true).catch(() => {});
    }, delay),
  );
});

documents.onDidClose((event) => {
  const timer = debounceTimers.get(event.document.uri);
  if (timer) clearTimeout(timer);
  debounceTimers.delete(event.document.uri);
  nudoFileCache.delete(event.document.uri);
  const filePath = uriToFilePath(event.document.uri);
  analysisCache.delete(filePath);
  activeCases.delete(event.document.uri);
  // P2：关闭即 bump validateGeneration——在途 validate 的 stillCurrent 门
  // 失效，陈旧结果不会在文件已关闭后再 publish
  bumpValidateGeneration(filePath);
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
  // 与 CLI watch 同口径：侧车 + 项目配置 + env 模板 + 分析目标
  // （外部改 import 依赖也必须让打开中的 parent 失效）
  return isWatchRelevantPath(filePath);
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
      void handleNudoDepFileChanged(p, deps)
        .then(() => refreshPullDiagnostics())
        .catch(() => {});
    }
  }
  return gone;
}

connection.onDidChangeWatchedFiles((event) => {
  void handleWatchedFilesChanges(event.changes, (uri) => documents.get(uri) !== undefined);
});

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
    listOpenDocuments: () => documents.all().map((doc) => ({
      uri: doc.uri,
      version: doc.version,
      getText: () => doc.getText(),
    })),
    onProjectConfigChanged: () => {
      // analysis.mode 等 gate 结果失效；诊断档也随配置重算
      nudoFileCache.clear();
    },
    loadModule: activeLoadModule,
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
  const autoBind = interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind;

  try {
    // A7：interface 档与 CodeLens 同源——default 走 symbolic + entryReqs；
    // 选 case 时 body 仍走 activeCases 重放，interface 标注不变
    const hover = getHoverAtPosition(filePath, source, line, column, cases, {
      loadModule: activeLoadModule,
      ...(autoBind === false ? { autoBind: false } : {}),
    });
    if (!hover) return null;

    const lines: string[] = [];
    // 与 CodeLens `● interface / <source>` 同源首行（A7 验收）
    if (hover.interfaceSource) {
      lines.push(`● interface / ${hover.interfaceSource}`);
      if (hover.interfaceDisplay && hover.interfaceSource !== "implicit") {
        lines.push("```nudo", hover.interfaceDisplay, "```");
      }
    }
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

/** LSP-G7：`@nudo:` 指令补全（注释上下文 / `@` 触发） */
const NUDO_DIRECTIVE_COMPLETIONS: Array<{ label: string; detail: string; insert?: string }> = [
  { label: "@nudo:refine", detail: "L1 contract — param / return refinement", insert: "@nudo:refine " },
  { label: "@nudo:interface", detail: "Alias of @nudo:refine", insert: "@nudo:interface " },
  { label: "@nudo:case", detail: "Debug witness (nudo test / LSP only)", insert: '@nudo:case "' },
  { label: "@nudo:as", detail: "Override next statement type", insert: "@nudo:as " },
  { label: "@nudo:replace", detail: "Replace sub-expression type", insert: "@nudo:replace " },
  { label: "@nudo:mock", detail: "Mock dependency implementation", insert: "@nudo:mock " },
  { label: "@nudo:mock-module", detail: "Replace imported module with mocks", insert: "@nudo:mock-module " },
  { label: "@nudo:pure", detail: "Memoize pure function evaluation", insert: "@nudo:pure" },
  { label: "@nudo:skip", detail: "Skip inference; use declared type", insert: "@nudo:skip " },
  { label: "@nudo:sample", detail: "Control loop iteration sampling", insert: "@nudo:sample " },
  { label: "@nudo:import", detail: "Import constraint templates from *.nudo.js", insert: "@nudo:import " },
  { label: "@nudo:env", detail: "Declare runtime env (es / web / node)", insert: "@nudo:env " },
];

connection.onCompletion((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  const filePath = uriToFilePath(params.textDocument.uri);
  const source = document.getText();
  const line = params.position.line + 1;
  const column = params.position.character;

  // 指令面优先：光标在注释 / `@nudo` 前缀内
  const curLine = source.split("\n")[params.position.line] ?? "";
  const before = curLine.slice(0, params.position.character);
  if (/(\/\/|\/\*|\*|\/\*\*)\s*@?n?u?d?o?:?$/.test(before) || /@nudo:?[\w-]*$/.test(before)) {
    const prefix = /@nudo:?[\w-]*$/.exec(before)?.[0] ?? "";
    return NUDO_DIRECTIVE_COMPLETIONS.filter(
      (d) => !prefix || d.label.startsWith(prefix) || d.label.includes(prefix),
    ).map((d): LspCompletionItem => ({
      label: d.label,
      kind: CompletionItemKind.Keyword,
      detail: d.detail,
      insertText: d.insert ?? d.label,
    }));
  }

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
      loadModule: activeLoadModule,
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
          // 只读打印当前 contract（点击即 `nudo.contract`，无写盘）
          command: {
            title: `● interface / ${lens.source}`,
            command: "nudo.contract",
            arguments: [params.textDocument.uri, lens.fn],
          },
        });
      } else if (lens.kind === "emit") {
        lenses.push({
          range,
          command: {
            title: lens.mode === "add" ? "⚡ persist interface" : "↻ update interface",
            command: "nudo.contract.emit",
            arguments: [params.textDocument.uri, lens.fn, lens.mode],
          },
        });
      } else if (lens.kind === "draft") {
        lenses.push({
          range,
          command: {
            title: "⚡ draft interface",
            command: "nudo.contract.draft",
            arguments: [params.textDocument.uri, lens.fn],
          },
        });
      } else if (lens.kind === "case") {
        lenses.push({
          range,
          command: {
            title: lens.active ? `● case "${lens.caseName}"` : `○ case "${lens.caseName}"`,
            command: "nudo.selectCase",
            arguments: [params.textDocument.uri, lens.fn, lens.caseIndex, lens.caseName],
          },
        });
      } else if (lens.kind === "callsite" || lens.kind === "entry") {
        lenses.push({
          range,
          command: {
            title: lens.title,
            command: "nudo.trace",
            arguments: [params.textDocument.uri, lens.fn],
          },
        });
      }
    }

    // 合成 call@ / entry@ 观察层（CLI `nudo test` 的源码内投影）
    for (const lens of computeObservationLenses(source, filePath)) {
      lenses.push({
        range: {
          start: { line: lens.line - 1, character: 0 },
          end: { line: lens.line - 1, character: 0 },
        },
        command: {
          title: lens.title,
          command: "nudo.trace",
          arguments: [params.textDocument.uri, lens.fn],
        },
      });
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
  const autoBind = interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind;

  try {
    const result = getCachedOrAnalyze(
      filePath,
      source,
      document.version,
      cases,
      activeLoadModule,
    );
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
    // A7：default 走 symbolic + entryReqs；与 CodeLens interface 档同源
    try {
      for (const abs of collectAbsInlays(source, {
        loadModule: activeLoadModule,
        fromFile: filePath,
        ...(autoBind === false ? { autoBind: false } : {}),
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

    // LSP-G2：CodeLens 不可见的客户端（Helix 等）用 inlay 投影同源 interface 档
    // （`● interface / handwritten|generated|implicit`，与 CodeLens 同 computeInterfaceLenses）
    try {
      for (const lens of computeInterfaceLenses(source, filePath, {
        loadModule: activeLoadModule,
        activeCases: cases,
        ...(autoBind === false ? { autoBind: false } : {}),
      })) {
        if (lens.kind !== "interface") continue;
        const lineIdx = lens.line - 1;
        if (lineIdx < 0 || lineIdx >= lines.length) continue;
        const lineLen = (lines[lineIdx] ?? "").length;
        hints.push({
          position: { line: lineIdx, character: lineLen },
          label: `  ● interface / ${lens.source}`,
          kind: InlayHintKind.Type,
          paddingLeft: true,
        });
      }
    } catch {
      // interface inlay 失败不影响 case/Abs inlay
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
  // A5：侧车契约文件本身也可导航（打开的 *.nudo.js / *.nudo.ts）
  const uriPath = params.textDocument.uri;
  if (!isNudoFile(uriPath) && !isSidecarPath(uriToFilePath(uriPath))) {
    return null;
  }

  const source = document.getText();
  const filePath = uriToFilePath(params.textDocument.uri);
  const line = params.position.line + 1;
  const column = params.position.character;

  try {
    const ast = parse(source);
    const identAtPos = findIdentifierAtPosition(ast, line, column);
    if (!identAtPos) return null;

    // A5：本地声明 + 侧车契约一起返回（Peek 可见契约边）
    const defs = resolveDefinitionLocations(filePath, source, identAtPos, {
      extraFiles: navigationExtraFiles(filePath),
      workspaceFallback: true,
    });
    if (defs.length === 0) return null;
    return defs.map((def) => ({
      uri: filePathToUri(def.filePath),
      range: {
        start: { line: def.loc.start.line - 1, character: def.loc.start.column },
        end: { line: def.loc.end.line - 1, character: def.loc.end.column },
      },
    }));
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
      at: { line, column },
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

    const target = renameTargetAt(source, line, column);
    if (target && "error" in target) return null;

    // B1：方法 / getter / setter —— 文件内同名 key + 成员访问
    if (target && "kind" in target && target.kind === "method") {
      const hits = collectMethodReferences(ast, target.name);
      const locations = hits.map((h) => ({
        uri: params.textDocument.uri,
        loc: h.loc,
      }));
      // 跨文件：extraFiles 里同名 method 定义/成员也改（name-based）
      for (const extra of navigationExtraFiles(filePath)) {
        try {
          const extraSrc = readFileSync(extra, "utf-8");
          const extraAst = parse(extraSrc);
          for (const h of collectMethodReferences(extraAst, target.name)) {
            locations.push({ uri: filePathToUri(extra), loc: h.loc });
          }
        } catch {
          /* skip unreadable */
        }
      }
      const changes = buildRenameEdits(params.newName, locations);
      if (Object.keys(changes).length === 0) return null;
      return { changes };
    }

    // 跨文件：definition + references 一起改（同绑定）
    const def = resolveDefinition(filePath, source, identAtPos);
    const refs = resolveReferences(filePath, source, identAtPos, {
      extraFiles: navigationExtraFiles(filePath),
      at: { line, column },
    });

    const locations: Array<{ uri: string; loc: { start: { line: number; column: number }; end: { line: number; column: number } } }> = [];
    if (def) {
      locations.push({ uri: filePathToUri(def.filePath), loc: def.loc });
    }
    for (const ref of refs) {
      locations.push({
        uri: ref.uri ? filePathToUri(ref.uri) : params.textDocument.uri,
        loc: ref.loc,
      });
    }
    const changes = buildRenameEdits(params.newName, locations);
    if (Object.keys(changes).length === 0) return null;
    return { changes };
  } catch {
    return null;
  }
});

connection.onPrepareRename((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  if (!isNudoFile(params.textDocument.uri)) return null;
  const source = document.getText();
  const line = params.position.line + 1;
  const column = params.position.character;
  const target = renameTargetAt(source, line, column);
  if (!target) return null;
  // 非绑定：返回 null = 不可改名（property key / member prop 等）
  if ("error" in target) return null;
  return {
    range: {
      start: { line: target.loc.start.line - 1, character: target.loc.start.column },
      end: { line: target.loc.end.line - 1, character: target.loc.end.column },
    },
    placeholder: target.name,
  };
});

connection.onCodeAction((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  const actions = [];
  const source = document.getText();
  const lines = source.split("\n");
  const filePath = uriToFilePath(params.textDocument.uri);

  // Extract function（非空选区）
  const sel = params.range;
  const nonEmpty =
    sel.start.line !== sel.end.line || sel.start.character !== sel.end.character;
  if (nonEmpty) {
    try {
      const extracted = extractToWorkspaceEdit(source, sel, { name: "extracted" });
      if (extracted.ok) {
        actions.push({
          title: extracted.title,
          kind: "refactor.extract",
          edit: {
            changes: {
              [params.textDocument.uri]: [
                {
                  range: fullDocumentRange(source),
                  newText: extracted.newText,
                },
              ],
            },
          },
        });
      }
    } catch {
      /* extract is best-effort */
    }
  }

  // B2：内联变量（光标落在声明/init）
  try {
    const line = params.range.start.line + 1;
    const column = params.range.start.character;
    const inl = inlineVariableAt(source, line, column);
    if (inl && "edits" in inl) {
      actions.push({
        title: inl.title,
        kind: "refactor.inline",
        edit: { changes: { [params.textDocument.uri]: inl.edits } },
      });
    }
    const sig = makeParamOptionalAt(source, line, column);
    if (sig && "edits" in sig) {
      actions.push({
        title: sig.title,
        kind: "refactor.rewrite",
        edit: { changes: { [params.textDocument.uri]: sig.edits } },
      });
    }
  } catch {
    /* B2 is best-effort */
  }

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
    // A6：缺 slot → 调用点插字段 + 侧车 shape 补字段
    if (diag.code === "nudo:constraint-violated" || diag.code === "nudo:missing-slot") {
      const data = (diag.data ?? {}) as {
        expected?: string;
        actual?: string;
        suggestions?: string[];
        fn?: string;
      };
      const missing = typeof data.expected === "string"
        ? data.expected.match(/missing field\s+([\w.$]+)/) ?? data.expected.match(/([\w.$]+)\s*∈/)
        : null;
      if (missing) {
        const fieldPath = missing[1]!;
        const field = fieldPath.split(".").pop() ?? fieldPath;
        const line = diag.range.start.line;
        const lineText = lines[line] ?? "";
        // 调用点：单 `{` 行插入 field: undefined
        const braceCount = (lineText.match(/\{/g) ?? []).length;
        const braceCol = lineText.indexOf("{");
        if (braceCol >= 0 && braceCount === 1) {
          const insertAt = { line, character: braceCol + 1 };
          const snippet = lineText.slice(braceCol + 1).trimStart().startsWith("}")
            ? ` ${field}: undefined `
            : ` ${field}: undefined, `;
          actions.push({
            title: `Add missing field '${field}' to call`,
            kind: "quickfix",
            diagnostics: [diag],
            edit: {
              changes: {
                [params.textDocument.uri]: [{
                  range: { start: insertAt, end: insertAt },
                  newText: snippet,
                }],
              },
            },
          });
        }
        // A6：侧车 shape 补字段（同文件 *.nudo.js）
        const sidecarUri = filePathToUri(sidecarPathOf(filePath));
        const sidecarText = agentToolDeps.getOpenText?.(sidecarPathOf(filePath))?.text
          ?? (() => {
            try {
              return readFileSync(sidecarPathOf(filePath), "utf-8");
            } catch {
              return undefined;
            }
          })();
        if (sidecarText !== undefined) {
          const scLines = sidecarText.split("\n");
          // A6：只在目标 fn 自身的 `fn(` 调用括号内插入契约 `{`（P1）
          const fnName = typeof data.fn === "string" && data.fn ? data.fn : undefined;
          if (fnName) {
            const pos = findFnContractInsertPos(scLines, fnName);
            if (pos) {
              const t = scLines[pos.line]!;
              const insert = t.slice(pos.character).trimStart().startsWith("}")
                ? ` ${field}: undefined `
                : ` ${field}: undefined, `;
              actions.push({
                title: `Add '${field}' to ${fnName} contract shape`,
                kind: "quickfix",
                diagnostics: [diag],
                edit: {
                  changes: {
                    [sidecarUri]: [{
                      range: {
                        start: { line: pos.line, character: pos.character },
                        end: { line: pos.line, character: pos.character },
                      },
                      newText: insert,
                    }],
                  },
                },
              });
            }
          }
        } else {
          actions.push({
            title: `Create sidecar draft with field '${field}'`,
            kind: "quickfix",
            diagnostics: [diag],
            command: {
              title: "nudo draft",
              command: "nudo.contract.draft",
              arguments: [params.textDocument.uri],
            },
          });
        }
      }

      // A6：refine 违例 → 放宽侧车契约（仅 constraint 类诊断 + suggestion 命中）
      const sug = data.suggestions?.[0] ?? "";
      const loosen = sug.match(
        /Loosen the handwritten contract for\s+(\w+)\s*\((\w+):\s*([^)]+)\)/i,
      ) ?? sug.match(/放宽\s+(\w+)\s*的前置/) ?? sug.match(/改用满足\s+(.+?)\s*的/);
      const relaxableCodes = new Set([
        "nudo:constraint-violated",
        "nudo:refine-violated",
        "nudo:domain-exceeds",
        "nudo:interface-domain-exceeds",
        "constraint-violated",
        "refine",
      ]);
      // missing-slot 只补字段，不挂「放宽侧车」——避免剥掉无关数值谓词
      const codeStr = String(diag.code ?? "");
      const isMissingSlot =
        codeStr === "nudo:missing-slot" || codeStr === "missing-slot";
      const canRelax =
        !isMissingSlot &&
        (loosen !== null ||
          (typeof data.fn === "string" &&
            data.fn.length > 0 &&
            (relaxableCodes.has(codeStr) ||
              /constraint|refine|contract/i.test(
                codeStr + String((data as { suggestions?: string[] }).suggestions?.join(" ") ?? ""),
              ))));
      if (canRelax && (loosen || data.fn)) {
        const fnName = data.fn ?? (loosen?.[1] || undefined);
        const param = loosen?.[2];
        const constraintText = loosen?.[3]?.trim();
        const sidecarPath = sidecarPathOf(filePath);
        const scText = agentToolDeps.getOpenText?.(sidecarPath)?.text
          ?? (() => {
            try {
              return readFileSync(sidecarPath, "utf-8");
            } catch {
              return undefined;
            }
          })();
        if (scText !== undefined && fnName) {
          const relaxed = relaxSidecarConstraint(scText, fnName, param, constraintText);
          if (relaxed && relaxed !== scText) {
            const scUri = filePathToUri(sidecarPath);
            const scLines = scText.split("\n");
            const last = scLines.length - 1;
            actions.push({
              title: `Relax sidecar contract for ${fnName}${param ? `.${param}` : ""}`,
              kind: "quickfix",
              diagnostics: [diag],
              edit: {
                changes: {
                  [scUri]: [{
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: last, character: scLines[last]?.length ?? 0 },
                    },
                    newText: relaxed,
                  }],
                },
              },
            });
          }
        }
      }
    }
  }

  return actions;
});

import { relaxSidecarConstraint } from "./a6-relax.ts";

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

    const fnAbs = getTypeAtPosition(filePath, source, callInfo.calleeLine, callInfo.calleeCol, cases);
    return fnAbs ? buildSignatureHelp(fnAbs, callInfo.currentParamIndex) : null;
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
    const autoBind = interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind;
    // A7：export 函数绑定带 contract/generated/derived modifier，与 CodeLens 同源
    return {
      data: buildSemanticTokens(filePath, document.getText(), {
        loadModule: activeLoadModule,
        ...(autoBind === false ? { autoBind: false } : {}),
      }),
    };
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
 * `nudo.contract.emit`：与 CLI `nudo contract --emit` 同一写盘器固化单个
 * 导出（design-refine-derivation §7.5）。`dryRun: true` 时只预览（与 CLI
 * `--dry-run` 同源），不写盘、不跑写盘后的失效链。
 * 真实写盘后：
 * 1. 重登记隐式侧车边（新建侧车在上次验证时不存在，边未登记）并定向
 *    逐出依赖 memo、重检打开中的父文件（handleNudoDepFileChanged）；
 * 2. 该文件若打开则重验证（validateDocument，侧车新内容进诊断/缓存）；
 * 3. 广播 CodeLensRefresh（固化后 persist → update 档切换）。
 */
async function handleContractEmit(params: {
  uri?: string;
  file?: string;
  functionName: string;
  mode: "add" | "update";
  dryRun?: boolean;
}): Promise<AgentToolResult> {
  const filePath = params.uri
    ? uriToFilePath(params.uri)
    : normalizeFilePath(params.file ?? "");
  const dryRun = params.dryRun === true;
  // 必须传 agentToolDeps：workspaceRoots 来自 onInitialize 注入，emit 写盘
  // 边界（assertEmitTargetAllowed）依赖它。漏传会让边界静默失效。
  const toolResult = await contractEmitTool(
    {
      file: filePath,
      functionName: params.functionName,
      mode: params.mode,
      ...(dryRun ? { dryRun: true } : {}),
    },
    agentToolDeps,
  );

  // emit 失败（入参校验 / 写盘异常）：不进入失效链路——侧车并未写入，
  // 「sidecar written but cache invalidation failed」会撒谎并叠加二次异常
  const emitText = toolResult.content[0]?.text ?? "";
  if (emitText.startsWith("Error:")) {
    connection.sendRequest(CodeLensRefreshRequest.type).catch(() => {});
    return toolResult;
  }

  // dry-run：侧车未写盘 → 跳过失效/重验证；结果文本已是 [dry-run] 预览
  if (dryRun) {
    return toolResult;
  }

  // 侧车写盘/新建后的缓存失效与重验证（agent 面按路径调用时文件可能未打开）
  let invalidateError: string | undefined;
  try {
    const openDoc = documents.all().find((d) => uriToFilePath(d.uri) === filePath);
    registerNudoImportDeps(filePath, openDoc ? openDoc.getText() : readFileSync(filePath, "utf-8"));
    await handleNudoDepFileChanged(sidecarPathOf(filePath), validationDeps());
    refreshPullDiagnostics();
    if (openDoc) {
      analysisCache.delete(filePath); // version 键未变，逐出防 getCachedOrAnalyze 命中陈旧结果
      await validateDocument(openDoc);
    }
  } catch (e) {
    // 写盘已成功；失效/重验证失败须可见——否则用户看到 written 但诊断/lens 仍是旧契约
    invalidateError = e instanceof Error ? e.message : String(e);
    connection.console.error(`nudo.contract.emit: sidecar written but cache invalidation failed: ${invalidateError}`);
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
  // E5：与 validate/hover 同一 buffer-aware 侧车装载，未保存 *.nudo.js 对 agent 可见
  loadModule: activeLoadModule,
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
    case "nudo.test":
      return testTool(arg as Parameters<typeof testTool>[0], agentToolDeps);
    case "nudo.contract":
      return contractTool(arg as Parameters<typeof contractTool>[0], agentToolDeps);
    case "nudo.contract.draft":
      return contractDraftTool(arg as Parameters<typeof contractDraftTool>[0], agentToolDeps);
    case "nudo.contract.emit":
      return handleContractEmit(arg as Parameters<typeof handleContractEmit>[0]);
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
  // CodeLens passes contract print positionally: [uri, functionName?]
  if (params.command === "nudo.contract") {
    const bridged = contractPositionalArgs(args);
    if (bridged) return contractTool(bridged, agentToolDeps);
  }
  // CodeLens ⚡ draft contract: [uri, functionName]
  if (params.command === "nudo.contract.draft") {
    if (typeof args[0] === "string") {
      return contractDraftTool(
        {
          file: args[0],
          ...(typeof args[1] === "string" ? { functionName: args[1] } : {}),
        },
        agentToolDeps,
      );
    }
  }
  // CodeLens passes contract.emit positionally: [uri, functionName, mode]
  if (params.command === "nudo.contract.emit") {
    const bridged = contractEmitPositionalArgs(args);
    if (bridged) {
      return handleContractEmit({
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
// Names come from the public-api freeze inventory (A7) — no second hardcoded list.
for (const name of NUDO_AGENT_TOOL_NAMES) {
  const command = `nudo.${name}`;
  const handler = (params: Record<string, unknown>) => dispatchAgentRequest(command, params);
  connection.onRequest(`nudo/${name}`, handler);
  connection.onRequest(command, handler);
}

connection.languages.diagnostics.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return { kind: "full", items: [] };
  // 与 push 同门禁：零注解 + 磁盘同名侧车（autoBind）也应出诊断
  const filePath = uriToFilePath(document.uri);
  const sidecarPath = sidecarPathOf(filePath);
  const hasSidecar =
    interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind &&
    !sidecarPath.replace(/\\/g, "/").includes("/node_modules/") &&
    existsSync(sidecarPath);
  if (!isNudoFile(params.textDocument.uri) && !hasSidecar) {
    return { kind: "full", items: [] };
  }

  try {
    const text = document.getText();
    const level = diagnosticsLevelForFile(filePath);
    const items: ReturnType<typeof toLspDiagnostic>[] = [];
    // Abs check 通道（与 push checkToLspDiagnostics 同源）
    try {
      const checkDiags = checkToLspDiagnostics(filePath, text, validationDeps().loadModule);
      // P2：与 push（validateText）同一档过滤 helper，避免 pull/push 诊断面不一致
      for (const d of filterCheckLspByLevel(checkDiags, level)) {
        items.push(d);
      }
    } catch {
      /* check 通道失败不影响 evaluator 面 */
    }
    const result = getCachedOrAnalyze(
      filePath,
      text,
      document.version,
      getActiveCasesForUri(document.uri),
      validationDeps().loadModule,
    );
    const filtered = filterDiagnosticsByLevel(result.diagnostics, level);
    for (const d of filtered) {
      items.push(toLspDiagnostic(d, document.uri));
    }
    return { kind: "full", items, version: document.version };
  } catch {
    return { kind: "full", items: [], version: document?.version };
  }
});

const nudoFileCache = new Map<string, boolean>();

function isNudoFile(uri: string): boolean {
  // 路径目标 + analysis.mode（design-cli-semantics §7）：directives=今日行为；
  // exports/all 由 package.json#nudo.analysis 打开无指令分析
  if (!isNudoTargetPath(uriToFilePath(uri))) return false;
  const filePath = uriToFilePath(uri);
  const cached = nudoFileCache.get(uri);
  if (cached !== undefined) return cached;
  const doc = documents.get(uri);
  if (!doc) return false;
  const result = shouldAnalyzeFile(filePath, doc.getText());
  nudoFileCache.set(uri, result);
  return result;
}

documents.listen(connection);
connection.listen();
