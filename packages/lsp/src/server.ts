#!/usr/bin/env node
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
  CodeLensRefreshRequest,
  DiagnosticRefreshRequest,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { sidecarPathOf } from "@nudojs/core";
import {
  isNudoTargetPath,
  shouldAnalyzeFile,
  findProjectConfig,
  interfaceConfig,
} from "@nudojs/service";
import {
  analysisCache,
  knownFiles,
  evictModuleGraphCacheEntries,
  forgetValidatedFile,
  getCachedOrAnalyze,
  handleNudoDepFileChanged,
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
  type AgentToolDeps,
  type AgentToolResult,
} from "./agent-tools.ts";
import { NUDO_EXECUTE_COMMANDS, NUDO_AGENT_TOOL_NAMES } from "./public-api.ts";
import { TOKEN_TYPES, TOKEN_MODIFIERS } from "./semantic-tokens.ts";
import {
  watchedFilesListeners,
  registerWatchedFilesListener,
  attachWatchedFiles,
  isNudoDepPath,
  type WatchDeps,
} from "./server-watch.ts";
import {
  makeHandleSelectCase,
  makeHandleGetActiveCases,
  makeHandleContractEmit,
  type CommandDeps,
} from "./server-commands.ts";
import { attachNavigation, type NavigationDeps } from "./server-navigation.ts";
import { attachCodeActions, type CodeActionDeps } from "./server-code-actions.ts";
import {
  attachHover,
  attachCompletion,
  attachCodeLens,
  attachInlayHint,
  attachSignatureHelp,
  attachSemanticTokens,
  type IdeDeps,
} from "./server-ide.ts";

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

const watchDeps: WatchDeps = {
  sendDiagnostics: (params) => connection.sendDiagnostics(params),
  isDocumentOpen: (uri) => documents.get(uri) !== undefined,
  activeCases,
  nudoFileCache,
  validationDeps,
  refreshPullDiagnostics,
  onDidChangeWatchedFiles: (handler) => {
    connection.onDidChangeWatchedFiles((event) => handler(event));
  },
};
attachWatchedFiles(watchDeps);

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

// agentToolDeps 依赖 workspaceRoots getter，先建 ref 再回填
const agentToolDepsRef: { current?: AgentToolDeps } = {};

const ideDeps: IdeDeps = {
  connection,
  getDocument: (uri) => documents.get(uri),
  listDocuments: () => documents.all(),
  isNudoFile,
  getActiveCases: getActiveCasesForUri,
  activeLoadModule,
  get agentToolDeps() {
    return agentToolDepsRef.current!;
  },
};

attachHover(ideDeps);
attachCompletion(ideDeps);
attachCodeLens(ideDeps);
attachInlayHint(ideDeps);
attachSignatureHelp(ideDeps);
attachSemanticTokens(ideDeps);

const navigationDeps: NavigationDeps = {
  connection,
  getDocument: (uri) => documents.get(uri),
  listDocuments: () => documents.all(),
  isNudoFile,
  knownFiles,
};
attachNavigation(navigationDeps);

const codeActionDeps: CodeActionDeps = {
  connection,
  getDocument: (uri) => documents.get(uri),
  isNudoFile,
  get agentToolDeps() {
    return agentToolDepsRef.current!;
  },
};
attachCodeActions(codeActionDeps);

const commandDeps: CommandDeps = {
  connection,
  getDocument: (uri) => documents.get(uri),
  listDocuments: () => documents.all(),
  getActiveCases: getActiveCasesForUri,
  validateDocument: (doc) => validateDocument(doc),
  validationDeps,
  refreshPullDiagnostics,
  get agentToolDeps() {
    return agentToolDepsRef.current!;
  },
};

const handleSelectCase = makeHandleSelectCase(commandDeps);
const handleGetActiveCases = makeHandleGetActiveCases(commandDeps);
const handleContractEmit = makeHandleContractEmit(commandDeps);

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

agentToolDepsRef.current = agentToolDeps;

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

documents.listen(connection);
connection.listen();
