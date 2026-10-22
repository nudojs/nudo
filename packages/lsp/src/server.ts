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
  ErrorCodes,
  ResponseError,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  envUnresolvedDiags,
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
  tracePositionalArgs,
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

/** 设置树节点：普通对象（可深合并）/ 标量。 */
type SettingsTree = Record<string, unknown>;

function isSettingsObject(value: unknown): value is SettingsTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 设置树**深合并**（Bug 777）：新载荷里出现的键覆盖旧值；**未出现的键保留
 * 旧值**；`null` = 显式重置（删掉该键 ⇒ 回落默认）。
 *
 * 此前 server 把 `params.settings.nudo.*` 当整棵子树读，未提及的键直接被
 * 抹成 `undefined` ⇒ 一次**部分**或**无关**的设置变更就把宿主的
 * `nudo.analysis.mode` 默认值清掉（分析范围静默收缩、hover 变 null）。
 */
function mergeSettingsTree(base: SettingsTree, patch: SettingsTree): SettingsTree {
  const out: SettingsTree = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
      continue;
    }
    if (isSettingsObject(value) && isSettingsObject(out[key])) {
      out[key] = mergeSettingsTree(out[key] as SettingsTree, value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * 设置载荷的**路径展开**（Bug 777）：客户端可能用扁平键
 * （`"nudo.analysis.mode": "all"`）而不是嵌套树（`{ nudo: { analysis: … } }`）
 * 发送 ⇒ 扁平键按点号拆成嵌套路径；嵌套树原样保留（同名时嵌套优先）。
 */
function flattenSettingsPatches(settings: SettingsTree | undefined): SettingsTree {
  if (!isSettingsObject(settings)) return {};
  const flat: SettingsTree = {};
  const nested: SettingsTree = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!key.includes(".")) {
      nested[key] = value;
      continue;
    }
    const parts = key.split(".");
    let cursor = flat;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i] as string;
      if (!isSettingsObject(cursor[part])) cursor[part] = {};
      cursor = cursor[part] as SettingsTree;
    }
    cursor[parts[parts.length - 1] as string] = value;
  }
  return mergeSettingsTree(flat, nested);
}

/** 按路径读设置树；缺任一段 ⇒ undefined。 */
function readSettingsPath(tree: SettingsTree, path: readonly string[]): unknown {
  let cursor: unknown = tree;
  for (const key of path) {
    if (!isSettingsObject(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

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

  /**
   * 宿主设置的**合并树**（Bug 777）：`workspace/didChangeConfiguration` 的载荷
   * 只带**变更部分**（或与 nudo 无关的整棵树）⇒ 直接整棵读会把未提及的键
   * 抹成 undefined。此处保留累积树，配置变更按**深合并**叠加：
   * 新载荷出现的键覆盖旧值，未出现的键保留旧值；`null` = 显式重置。
   */
  let clientSettingsTree: Record<string, unknown> = {};

  let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * 畸形 URI 容错（Bug 784）：`uriToFilePath` 对非法百分号转义抛 `URIError`
   * （裸 `decodeURIComponent`）⇒ 一个畸形 URI 会让**整个 initialize 抛出去**，
   * 客户端拿不到 capabilities ⇒ 整个语言服务器会话起不来。
   * 这里逐个 folder 兜底：跳过畸形项 + 记一条可读告警，其余照常。
   */
  function safeUriToFilePath(uri: string | null | undefined): string | undefined {
    if (!uri) return undefined;
    try {
      const p = uriToFilePath(uri);
      return p ? p : undefined;
    } catch (err) {
      connection.console.warn(
        `[nudo-lsp] ignoring malformed workspace uri (${uri}): ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  /**
   * 工作区根集合更新（Bug 783）：`workspace/didChangeWorkspaceFolders` 到达时
   * 增删根（realpath 归一，与 `assertEmitTargetAllowed` 的根口径一致）。
   * 根集合同时是「agent 写盘边界的授权根」与「错误消息的脱敏根」⇒ 必须随
   * 客户端的增删同步，否则新加入的目录被误拒、已移出的目录仍被授权。
   */
  function updateWorkspaceRoots(added: readonly string[], removed: readonly string[]): void {
    // 归一口径与 `assertEmitTargetAllowed` 的 `resolvedWorkspaceRoots` 同款
    // （resolve + realpath）⇒ 增删用的键与写盘边界的比较口径一致。
    const norm = (p: string): string => {
      const abs = resolve(p);
      try {
        return realpathSync(abs);
      } catch {
        return abs;
      }
    };
    const roots = new Set(workspaceRoots.map(norm));
    for (const r of removed) roots.delete(norm(r));
    for (const r of added) roots.add(norm(r));
    workspaceRoots = [...roots];
  }

  connection.onInitialize((params: InitializeParams): InitializeResult => {
    workspaceRoots = (params.workspaceFolders ?? [])
      .map((w) => safeUriToFilePath(w.uri))
      .filter((p): p is string => p !== undefined);
    if (workspaceRoots.length === 0 && params.rootUri) {
      const root = safeUriToFilePath(params.rootUri);
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
    // 初始化值进合并树：后续 `didChangeConfiguration` 的**部分**载荷不得把
    // initializationOptions 带来的默认值抹掉（Bug 777）。
    clientSettingsTree = mergeSettingsTree(
      {},
      {
        nudo: {
          analysis: { mode: clientDefaultAnalysisMode },
          inlayHints: { parameters: clientDefaultInlayParams },
        },
      },
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
      // Bug 783：声明工作区文件夹变更通知——客户端只在 server 声明
      // `changeNotifications` 时才会发 `workspace/didChangeWorkspaceFolders`
      // ⇒ 不声明 = 订阅了也收不到。
      workspace: {
        workspaceFolders: {
          supported: true,
          changeNotifications: true,
        },
      },
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
    },
    };
  });

  /**
   * 工作区文件夹变更订阅（Bug 783）。
   *
   * 此前 server **从不订阅** `workspace/didChangeWorkspaceFolders` ⇒
   * `workspaceRoots` 在 `initialize` 之后**永久冻结**（三个写入点全在
   * `onInitialize` 里）⇒ 新加入的目录被写盘边界误拒、已移出的目录仍被授权。
   *
   * `connection.workspace` 是可选特性面（测试用的内存 mock 可能没有）⇒
   * 缺失时静默跳过，不得让 server 起不来。
   */
  const workspaceFoldersFeature = connection.workspace as unknown as
    | {
        onDidChangeWorkspaceFolders?: (
          h: (e: {
            added: readonly { uri: string; name: string }[];
            removed: readonly { uri: string; name: string }[];
          }) => void,
        ) => unknown;
      }
    | undefined;
  workspaceFoldersFeature?.onDidChangeWorkspaceFolders?.((event) => {
    const added = (event.added ?? [])
      .map((w) => safeUriToFilePath(w.uri))
      .filter((p): p is string => p !== undefined);
    const removed = (event.removed ?? [])
      .map((w) => safeUriToFilePath(w.uri))
      .filter((p): p is string => p !== undefined);
    if (added.length === 0 && removed.length === 0) return;
    updateWorkspaceRoots(added, removed);
    // 根集合变了 ⇒ 授权边界与脱敏根都变了：新纳入的已打开文档重检一次
    // （新纳入 → 出诊断；新排除 → 清诊断），并让客户端重拉 pull 诊断。
    nudoFileCache.clear();
    for (const doc of documents.all()) {
      const fp = uriToFilePath(doc.uri);
      if (!fp || !isNudoTargetPath(fp)) continue;
      void validateText(fp, doc.uri, doc.getText(), doc.version, validationDeps());
    }
    refreshPullDiagnostics();
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

  /**
   * 已发布诊断的去重指纹（Bug 776）：按 uri 记最近一次 publish 的
   * (version, 诊断内容) 指纹 ⇒ **同版本同内容**的重复 publish 被吞掉。
   *
   * 重复来源：`vscode-languageserver` 的 `TextDocuments.listen()` 在
   * `didOpen` 时**同时** fire `onDidChangeContent`（textDocuments.js）⇒
   * 编辑防抖路径对**同一内容**再跑一遍完整校验并再 publish 一次。
   * 去重按**内容**而非仅按版本：同版本但诊断内容变了（侧车/依赖变更后的
   * force 重检）仍必须发出去。
   */
  const publishedFingerprints = new Map<string, string>();

  /** 最近一次已受理校验的文档指纹（version + 内容）——按 uri 记（Bug 776）。 */
  const validatedFingerprints = new Map<string, string>();

  function publishDiagnostics(params: {
    uri: string;
    diagnostics: unknown[];
    version?: number;
  }): void {
    const fingerprint = `${params.version ?? ""}\0${JSON.stringify(params.diagnostics)}`;
    if (publishedFingerprints.get(params.uri) === fingerprint) return;
    publishedFingerprints.set(params.uri, fingerprint);
    connection.sendDiagnostics(params as Parameters<Connection["sendDiagnostics"]>[0]);
  }

  function documentFingerprint(document: TextDocument): string {
    return `${document.version}\0${document.getText()}`;
  }

  documents.onDidOpen((event) => {
    nudoFileCache.delete(event.document.uri);
    // didOpen 的内容已被本处理器受理 ⇒ 记录指纹，随后的 onDidChangeContent
    // 回声（同一 version + 同一内容）不再重复跑一遍校验（Bug 776）。
    validatedFingerprints.set(event.document.uri, documentFingerprint(event.document));
    const openPath = uriToFilePath(event.document.uri);
    // A4：打开侧车（含新建 buffer）→ 立即尝试重检已登记 parent
    if (isNudoDepPath(openPath)) {
      void handleNudoDepFileChanged(openPath, validationDeps())
        .then(() => refreshPullDiagnostics())
        .catch((err) => {
          // 契约/依赖重检失败必须可见：静默吞掉会让该文件永远没有诊断且无迹可查
          console.error(`[nudo-lsp] dep file revalidate failed (${openPath}):`, err);
        });
    }
    validateDocument(event.document, true).catch((err) => {
      // analyzer 对坏侧车/坏 mock 抛错时若无日志，「打开文件无诊断」不可排查
      console.error(`[nudo-lsp] validateDocument failed (didOpen ${event.document.uri}):`, err);
    });
  });

  documents.onDidChangeContent((change) => {
    const uri = change.document.uri;
    // didOpen 回声：同一 version + 同一内容 ⇒ 已由 onDidOpen 受理过，
    // 不再排一次防抖校验（否则同版本同内容的诊断被 publish 两次）（Bug 776）。
    if (validatedFingerprints.get(uri) === documentFingerprint(change.document)) return;
    validatedFingerprints.set(uri, documentFingerprint(change.document));
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
            .catch((err) => {
              console.error(`[nudo-lsp] dep file revalidate failed (${filePath}):`, err);
            });
        }
        validateDocument(change.document, true).catch((err) => {
          console.error(
            `[nudo-lsp] validateDocument failed (didChange ${change.document.uri}):`,
            err,
          );
        });
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
    // 清诊断面**必须**送达（不走去重：去重键含内容，清空面与上一次的
    // 内容不同，但仍直接发以免「关文件后诊断没撤掉」）。
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
    // 重新打开同一 uri 时诊断要能再发一次 ⇒ 丢掉去重指纹
    publishedFingerprints.delete(event.document.uri);
    validatedFingerprints.delete(event.document.uri);
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
   *
   * **项目侧与宿主侧同一个归一化函数**（Bug 790）：此前项目侧**原样返回**
   * 原始值 ⇒ 字符串 `"false"` 是真值 ⇒ 反而**开启**参数 inlay，而宿主侧
   * 同一个 `"false"` 走 `parseInlayParams` ⇒ **关闭** ⇒ 同一个键两套规则、
   * 行为完全相反。非法值按 `config.md` 的口径**回落默认**（关）。
   */
  function inlayParamsEnabled(filePath: string): boolean {
    const projectValue = findProjectConfig(dirname(filePath))?.config
      ?.inlayHints?.parameters;
    const projectEnabled = parseInlayParams(projectValue);
    if (projectEnabled !== undefined) return projectEnabled;
    if (projectValue !== undefined) {
      // 非法值：回落默认（关）并留一条可读告警（config.md：非法值回落默认）
      warnInvalidInlayParams(projectValue);
    }
    return clientDefaultInlayParams ?? false;
  }

  /** 已告警过的非法取值（同一值只告警一次，避免每次 inlay 请求都刷屏）。 */
  const warnedInlayParams = new Set<string>();

  function warnInvalidInlayParams(value: unknown): void {
    const key = JSON.stringify(value) ?? String(value);
    if (warnedInlayParams.has(key)) return;
    warnedInlayParams.add(key);
    connection.console.warn(
      `[nudo-lsp] invalid nudo.inlayHints.parameters value ${key}; falling back to default (off)`,
    );
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
    // **深合并**（Bug 777）：载荷只带**变更部分**（或与 nudo 无关的整棵树）
    // ⇒ 未提及的键必须保留旧值 / 默认值，不能被整棵读抹成 undefined。
    // 扁平键（`"nudo.analysis.mode"`）等价于嵌套路径，一并识别。
    clientSettingsTree = mergeSettingsTree(
      clientSettingsTree,
      flattenSettingsPatches(params.settings as Record<string, unknown> | undefined),
    );
    const next = parseAnalysisMode(
      readSettingsPath(clientSettingsTree, ["nudo", "analysis", "mode"]),
    );
    const nextInlayParams = parseInlayParams(
      readSettingsPath(clientSettingsTree, ["nudo", "inlayHints", "parameters"]),
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
    sendDiagnostics: (params) => publishDiagnostics(params),
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
      sendDiagnostics: (params) => publishDiagnostics(params),
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
        // 940：未声明的命令名必须走**协议层错误**出口——返回 null 会让
        // 「无此命令」与「跑了但无输出」在协议层同形（JSON-RPC 成功 + 空结果）。
        throw new ResponseError(
          ErrorCodes.MethodNotFound,
          `Unknown command: ${command}`,
        );
    }
  }

  connection.onExecuteCommand((params) => {
    // 940：命令名先过白名单（advertise 面与执行面同源）——未声明的命令名
    // 走协议层错误（MethodNotFound），不再返回 result:null 的假成功。
    if (!(NUDO_COMMANDS as readonly string[]).includes(params.command)) {
      throw new ResponseError(
        ErrorCodes.MethodNotFound,
        `Unknown command: ${params.command}`,
      );
    }
    const args = params.arguments ?? [];
    // CodeLens (and some clients) pass selectCase positionally:
    //   [uri, functionName, caseIndex, caseName]
    // Agent bridges pass a single object: { uri|file, functionName, caseIndex }.
    // 位置形态只要第一个参数是 uri 串就走位置桥（缺项由 handler 自己报形态
    // 错误）⇒ 兜底分支的「参数不是对象」检查不会误伤位置形态。
    if (
      params.command === "nudo.selectCase" &&
      args.length >= 1 &&
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
      args.length >= 1 &&
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
    // CodeLens 的 `entry@` / `call@` 观察透镜位置参数：[uri, functionName]
    // （Bug 780）。此前 `nudo.trace` **没有**位置参数桥 ⇒ 落到下面的兜底
    // 分支，把 uri 字符串当「参数对象」传下去 ⇒ 工具 100% 失败。
    if (params.command === "nudo.trace") {
      const bridged = tracePositionalArgs(args);
      if (bridged) return trace(bridged, agentToolDeps);
    }
    // 兜底：参数必须是**对象**。把字符串当对象传下去会让工具拿到
    // `params.file === undefined` ⇒ 每次点击观察透镜只得到一个错误
    // （Bug 780）⇒ 参数形态不对时直接报**协议层参数错误**。
    const first = args[0];
    if (first !== undefined && (typeof first !== "object" || first === null || Array.isArray(first))) {
      throw new ResponseError(
        ErrorCodes.InvalidParams,
        `Invalid arguments for ${params.command}: expected an object argument, got ${typeof first}`,
      );
    }
    return dispatchNudoCommand(params.command, (first as Record<string, unknown>) ?? {});
  });

  connection.onRequest("nudo/selectCase", handleSelectCase);
  connection.onRequest("nudo/selectContract", handleSelectContract);

  // 结果面：成功 { fn: index }，失败 = 结构化工具错误（isError: true，955）。
  // 协议层的 onRequest 字符串重载只接受单一结果类型 ⇒ 注册处标 unknown
  // （运行时返回体不变）。
  connection.onRequest("nudo/getActiveCases", (params: { uri?: string; file?: string }): unknown => handleGetActiveCases(params));

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

  connection.languages.diagnostics.on(async (params) => {
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
      // path env 通道（Bug 781 / Bug 992）：push 侧（validateText）会把
      // `@nudo:env` 指向的 path env 加载失败/缺失作为 `nudo:env-unresolved`
      // 告警发出去；pull 侧此前**完全没有**这一通道 ⇒ 同一文件 push 有、
      // pull 没有 ⇒ 两个诊断面互相打脸（IDE 与 CI 结论不一致）。
      // 这里与 push 同源同档过滤（filterCheckLspByLevel + 同一 level）。
      for (const d of filterCheckLspByLevel(
        await envUnresolvedDiags(filePath, text),
        level,
      )) {
        seen.add(`${d.code ?? ""}\0${d.message}`);
        items.push(d);
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
  // 进程级兜底：任何未被 handler 捕获的异步异常默认会直接终止进程
  // （Node ≥15 unhandledRejections=throw），客户端只看到 "server shut down"
  // 且无任何 stderr 留痕——改为记录后继续运行，把「无日志的静默死亡」
  // 变成可排查的日志事件。
  process.on("unhandledRejection", (reason) => {
    console.error(`[nudo-lsp] unhandled rejection:`, reason);
  });
  process.on("uncaughtException", (err) => {
    console.error(`[nudo-lsp] uncaught exception:`, err);
  });
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
