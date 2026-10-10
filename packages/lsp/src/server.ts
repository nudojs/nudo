#!/usr/bin/env node
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  type Connection,
  type InitializeParams,
  type InitializeResult,
  CodeLensRefreshRequest,
  DiagnosticRefreshRequest,
  DiagnosticSeverity,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { sanitizeErrorMessage } from "./sanitize.ts";
import { sidecarPathOf } from "@nudojs/core";
import {
  isNudoTargetPath,
  shouldAnalyzeFile,
  findProjectConfig,
  interfaceConfig,
  analysisConfig,
  type AnalysisConfig,
  type AnalysisMode,
} from "@nudojs/service";
import {
  analysisCache,
  knownFiles,
  cacheKey,
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
  getCachedCheckDiags,
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
import { SEMANTIC_TOKEN_TYPES as TOKEN_TYPES, SEMANTIC_TOKEN_MODIFIERS as TOKEN_MODIFIERS } from "./semantic-tokens.ts";
import {
  watchedFilesListeners,
  registerWatchedFilesListener,
  attachWatchedFiles,
  isNudoDepPath,
  type WatchDeps,
} from "./server-watch.ts";
import {
  makeHandleSelectCase,
  makeHandleSelectContract,
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

/** Wiring result: documents store + transport start (bin entry calls listen). */
export type NudoServerHandle = {
  documents: TextDocuments<TextDocument>;
  /** Start the JSON-RPC transport. Not called in tests. */
  listen: () => void;
};

/**
 * Register the full Nudo LSP surface on `connection`.
 * Importable without side effects — the real transport (`createConnection`)
 * is created only by the bin entry below.
 */
export function createNudoServer(connection: Connection): NudoServerHandle {
  const documents = new TextDocuments(TextDocument);

  const activeLoadModule = makeBufferAwareLoadModule((filePath: string) => {
    // cacheKey 比较：open doc 的 uri 形态与 buffer 解析出的 fs 路径形态统一（FIX-J1）
    const doc = documents.all().find((d) => cacheKey(d.uri) === cacheKey(filePath));
    return doc?.getText();
  });

  const activeCases = new Map<string, Map<string, number>>();

  /**
   * Pull 诊断成功面缓存（R2-2-pull-diagnostics-error-clears-all）：
   * 外层 catch 不得 `items: []` 把瞬时分析失败当「文件干净」——保留上次已发布
   * 诊断，无上次则标单条 Analysis error（与 push 的 validateText catch 同口径）。
   */
  const lastPullItems = new Map<string, ReturnType<typeof toLspDiagnostic>[]>();

  function getActiveCasesForUri(uri: string): Map<string, number> {
    const existing = activeCases.get(uri);
    if (existing) return existing;
    const map = new Map<string, number>();
    activeCases.set(uri, map);
    return map;
  }

  /** LSP client workspace folders（emit 路径边界用） */
  let workspaceRoots: string[] = [];

  /**
   * 宿主设置（VS Code `nudo.analysis.mode` 等）提供的默认 analysis.mode。
   * 优先级：项目 package.json#nudo.analysis.mode 显式值赢；此值只在项目
   * 未显式设置该键时作为默认（与 extension 配置 description 同口径）。
   */
  let clientDefaultAnalysisMode: AnalysisMode | undefined;

  /**
   * 宿主设置（VS Code `nudo.inlayHints.parameters` 等）提供的默认值。
   * 优先级同 analysis.mode：项目 package.json#nudo.inlayHints.parameters
   * 显式值赢；此值只在项目未显式设置该键时作为默认；均缺失 → false（关）。
   */
  let clientDefaultInlayParams: boolean | undefined;

  let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  connection.onInitialize((params: InitializeParams): InitializeResult => {
    workspaceRoots = (params.workspaceFolders ?? [])
      .map((w) => uriToFilePath(w.uri))
      .filter(Boolean);
    if (workspaceRoots.length === 0 && params.rootUri) {
      const root = uriToFilePath(params.rootUri);
      if (root) workspaceRoots = [root];
    }
    // initializationOptions（vscode 扩展等宿主转发的工作区设置）：
    // { analysis: { mode } }、{ inlayHints: { parameters } }。作为项目配置
    // 缺失时的默认（项目显式值优先）。
    clientDefaultAnalysisMode = parseAnalysisMode(
      (params.initializationOptions as { analysis?: { mode?: unknown } } | undefined)
        ?.analysis?.mode,
    );
    clientDefaultInlayParams = parseInlayParams(
      (params.initializationOptions as { inlayHints?: { parameters?: unknown } } | undefined)
        ?.inlayHints?.parameters,
    );
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
    lastPullItems.delete(event.document.uri);
    const key = cacheKey(event.document.uri);
    analysisCache.delete(key);
    activeCases.delete(event.document.uri);
    // P2：关闭即 bump validateGeneration——在途 validate 的 stillCurrent 门
    // 失效，陈旧结果不会在文件已关闭后再 publish
    bumpValidateGeneration(key);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  });

  const nudoFileCache = new Map<string, boolean>();

  /** analysis.mode 归一化：非法/缺失 → undefined（回落产品默认 exports）。 */
  function parseAnalysisMode(raw: unknown): AnalysisMode | undefined {
    return raw === "exports" || raw === "directives" || raw === "all" ? raw : undefined;
  }

  /** inlayHints.parameters 归一化：非法/缺失 → undefined（回落默认 false）。 */
  function parseInlayParams(raw: unknown): boolean | undefined {
    return typeof raw === "boolean" ? raw : undefined;
  }

  /**
   * 文件级 AnalysisConfig：项目 package.json#nudo.analysis.mode 显式值优先；
   * 项目未设置该键时用宿主设置（initializationOptions / didChangeConfiguration
   * 转发的 VS Code `nudo.analysis.mode`）作默认 mode。
   */
  function analysisConfigForFile(filePath: string): AnalysisConfig {
    const proj = findProjectConfig(dirname(filePath));
    const cfg = analysisConfig(proj?.config);
    const projectMode = parseAnalysisMode(proj?.config?.analysis?.mode);
    if (projectMode === undefined && clientDefaultAnalysisMode !== undefined) {
      return { ...cfg, mode: clientDefaultAnalysisMode };
    }
    return cfg;
  }

  /**
   * 参数约束 inlay（形参后 `where …`）开关，按文件解析。
   * 优先级：项目 package.json#nudo.inlayHints.parameters 显式值赢；
   * 项目未设置该键时用宿主设置作默认；均缺失 → false（关）。
   */
  function inlayParamsEnabled(filePath: string): boolean {
    const projectValue = findProjectConfig(dirname(filePath))?.config
      ?.inlayHints?.parameters;
    if (projectValue !== undefined) return projectValue;
    return clientDefaultInlayParams ?? false;
  }

  function isNudoFile(uri: string): boolean {
    // 路径目标 + analysis.mode（design-cli-semantics §7）：directives=今日行为；
    // exports/all 由 package.json#nudo.analysis 打开无指令分析
    if (!isNudoTargetPath(uriToFilePath(uri))) return false;
    const filePath = uriToFilePath(uri);
    const cached = nudoFileCache.get(uri);
    if (cached !== undefined) return cached;
    const doc = documents.get(uri);
    if (!doc) return false;
    const result = shouldAnalyzeFile(filePath, doc.getText(), analysisConfigForFile(filePath));
    nudoFileCache.set(uri, result);
    return result;
  }

  connection.onDidChangeConfiguration((params) => {
    const next = parseAnalysisMode(
      (params.settings as { nudo?: { analysis?: { mode?: unknown } } } | undefined)
        ?.nudo?.analysis?.mode,
    );
    const nextInlayParams = parseInlayParams(
      (params.settings as { nudo?: { inlayHints?: { parameters?: unknown } } } | undefined)
        ?.nudo?.inlayHints?.parameters,
    );
    const inlayChanged = nextInlayParams !== clientDefaultInlayParams;
    if (next === clientDefaultAnalysisMode && !inlayChanged) return;
    clientDefaultAnalysisMode = next;
    clientDefaultInlayParams = nextInlayParams;
    // inlay 开关变化（含移除 → 回落项目/默认）：客户端拉取的
    // inlay hints 需刷新重取
    if (inlayChanged) {
      connection.languages.inlayHint.refresh().catch(() => {});
    }
    // gate 结果失效：重检打开文档（新纳入 → 出诊断；新排除 → 清诊断）
    nudoFileCache.clear();
    for (const doc of documents.all()) {
      const fp = uriToFilePath(doc.uri);
      if (!fp || !isNudoTargetPath(fp)) continue;
      void validateText(fp, doc.uri, doc.getText(), doc.version, validationDeps());
    }
    refreshPullDiagnostics();
  });

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
        documents.all().find((doc) => cacheKey(doc.uri) === cacheKey(filePath)),
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
      // G7：错误脱敏用客户端真实工作区根（onInitialize 已捕获），
      // 不落 sanitize 的 cwd 默认——扩展宿主 fork 的 cwd ≠ 工作区根
      workspaceRoots,
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
    inlayParamsEnabled,
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
  const handleSelectContract = makeHandleSelectContract(commandDeps);
  const handleGetActiveCases = makeHandleGetActiveCases(commandDeps);
  const handleContractEmit = makeHandleContractEmit(commandDeps);

  const agentToolDeps: AgentToolDeps = {
    getOpenText: (filePath) => {
      // cacheKey 比较：与 getOpenDocumentByPath 同口径，跨 uri/路径形态命中（FIX-J1）
      const doc = documents.all().find((d) => cacheKey(d.uri) === cacheKey(filePath));
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
      case "nudo.selectContract":
        return handleSelectContract(arg as Parameters<typeof handleSelectContract>[0]);
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
    // CodeLens 契约选项位置参数：[uri, functionName]（selectContract）
    if (
      params.command === "nudo.selectContract" &&
      args.length >= 2 &&
      typeof args[0] === "string"
    ) {
      return handleSelectContract({
        uri: args[0] as string,
        functionName: args[1] as string,
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
  connection.onRequest("nudo/selectContract", handleSelectContract);

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
      const seen = new Set<string>();
      // 先建/命中 analysisCache 条目（与 push validateText 同源），check 通道
      // 才能走条目内 checkDiags 缓存——pull 不再每次全量 checkSource
      const result = getCachedOrAnalyze(
        filePath,
        text,
        document.version,
        getActiveCasesForUri(document.uri),
        validationDeps().loadModule,
      );
      // Abs check 通道（与 push checkToLspDiagnostics 同源）
      try {
        const checkDiags = getCachedCheckDiags(
          filePath,
          text,
          validationDeps().loadModule,
          workspaceRoots,
        );
        // P2：与 push（validateText）同一档过滤 helper，避免 pull/push 诊断面不一致
        for (const d of filterCheckLspByLevel(checkDiags, level)) {
          seen.add(`${d.code ?? ""}\0${d.message}`);
          items.push(d);
        }
      } catch {
        /* check 通道失败不影响 evaluator 面 */
      }
      const filtered = filterDiagnosticsByLevel(result.diagnostics, level);
      for (const d of filtered) {
        const ld = toLspDiagnostic(d, document.uri);
        // 指令文法诊断双通道（check 显式 extract / analyzer drain）去重
        if (seen.has(`${ld.code ?? ""}\0${ld.message}`)) continue;
        items.push(ld);
      }
      lastPullItems.set(params.textDocument.uri, items);
      return { kind: "full", items, version: document.version };
    } catch (err) {
      // 不得 items:[] 把瞬时失败当「文件干净」——保留上次已发布面，或标 Analysis error
      connection.console.error(
        `nudo pull diagnostics failed for ${params.textDocument.uri}: ${(err as Error).message}`,
      );
      const last = lastPullItems.get(params.textDocument.uri);
      const errDiag = {
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message: `Analysis error: ${sanitizeErrorMessage((err as Error).message, workspaceRoots)}`,
        source: "nudo",
      } as ReturnType<typeof toLspDiagnostic>;
      const items = last && last.length > 0 ? last : [errDiag];
      // BUG-021/S5-003：stale 回放（上次成功 items / 错误兜底）
      // 不得标当前 version——宿主据此无法分辨新旧。留空表示
      // 「新鲜度未知」；成功路径才带 document.version。
      return { kind: "full", items, version: undefined };
    }
  });

  documents.listen(connection);
  return {
    documents,
    listen: () => {
      connection.listen();
    },
  };
}

/** True when this file is the process entry (`nudo-lsp` / `node dist/server.js`). */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

// Bin entry: transport selection + createConnection live here so importing
// createNudoServer (tests, embeds) never starts a language server.
if (isMainModule()) {
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
  createNudoServer(connection).listen();
}
