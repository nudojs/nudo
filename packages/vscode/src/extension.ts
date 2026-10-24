import * as path from "path";
import {
  type ExtensionContext,
  workspace,
  window,
  StatusBarAlignment,
  commands,
  type CodeLens,
  type DecorationOptions,
  type Event,
  type FileSystemWatcher,
  type TextEditorDecorationType,
  type Uri,
  Range,
  Position,
  type OutputChannel,
  ConfigurationTarget,
} from "vscode";
import {
  LanguageClient,
  State,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
  DidChangeConfigurationNotification,
} from "vscode-languageclient/node";
import {
  toInitializationOptions,
  toDidChangeConfigurationParams,
} from "./extension-config.ts";
import { computeCaseDecorationSpans } from "./case-decorations.ts";

let client: LanguageClient | undefined;
let output: OutputChannel | undefined;
let activeCaseDecorationType: TextEditorDecorationType | undefined;
/** deactivate() sets this so state-change handlers stay quiet during clean shutdown. */
let shuttingDown = false;

const activeCaseState = new Map<string, Map<string, { caseIndex: number; caseName: string }>>();

/** Agent tool / executeCommand results are `{ content: [{ type, text }] }`. */
function extractToolText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  const r = result as { content?: Array<{ text?: string }>; text?: string };
  if (Array.isArray(r.content)) {
    return r.content.map((c) => c?.text ?? "").join("\n");
  }
  return r.text ?? JSON.stringify(result, null, 2);
}

/**
 * Agent tool errors carry MCP-style `isError: true`. The `Error:` text prefix is
 * only a fallback for older/odd payloads — never the primary contract.
 */
function isToolError(result: unknown): boolean {
  if (
    result != null &&
    typeof result === "object" &&
    (result as { isError?: boolean }).isError === true
  ) {
    return true;
  }
  return extractToolText(result).startsWith("Error:");
}

function showNudoOutput(label: string, text: string): void {
  if (!output) output = window.createOutputChannel("Nudo");
  output.clear();
  output.appendLine(`# ${label}`);
  output.appendLine(text);
  output.show(true);
}

function showRequestError(method: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  void window.showErrorMessage(`Nudo: ${method} failed: ${message}`);
}

/**
 * sendRequest with a user-visible error surface. Resolves `undefined` on
 * transport/server failure so callers can bail without an unhandled rejection.
 */
async function sendNudoRequest<R>(method: string, params: unknown): Promise<R | undefined> {
  const c = client;
  if (!c) return undefined;
  try {
    return await c.sendRequest<R>(method, params);
  } catch (err) {
    showRequestError(method, err);
    return undefined;
  }
}

function isNodeModulesUri(uri: Uri): boolean {
  return /(^|[\\/])node_modules([\\/]|$)/.test(uri.fsPath);
}

function filterUriEvent(event: Event<Uri>): Event<Uri> {
  return (listener, thisArgs, disposables) =>
    event(
      (uri) => {
        if (isNodeModulesUri(uri)) return;
        if (thisArgs === undefined) listener(uri);
        else listener.call(thisArgs, uri);
      },
      undefined,
      disposables,
    );
}

/**
 * LSP synchronize watcher. Recursive string globs already honor
 * `files.watcherExclude` (default excludes most of `node_modules`); the event
 * filter additionally drops `node_modules` paths so dependency churn never
 * reaches `workspace/didChangeWatchedFiles`, even if the user cleared that
 * setting.
 */
function createSourceFileWatcher(pattern: string): FileSystemWatcher {
  const inner = workspace.createFileSystemWatcher(pattern);
  return {
    ignoreCreateEvents: inner.ignoreCreateEvents,
    ignoreChangeEvents: inner.ignoreChangeEvents,
    ignoreDeleteEvents: inner.ignoreDeleteEvents,
    onDidCreate: filterUriEvent(inner.onDidCreate),
    onDidChange: filterUriEvent(inner.onDidChange),
    onDidDelete: filterUriEvent(inner.onDidDelete),
    dispose: () => inner.dispose(),
  };
}

function openCoexistenceGuide(): void {
  void commands.executeCommand(
    "vscode.open",
    "https://nudojs.github.io/nudo/docs/guides/coexistence",
  );
}

/**
 * Client command ids the extension handles **itself**.
 *
 * 972: the LSP server advertises these ids in
 * `executeCommandProvider.commands` (`@nudojs/lsp`'s `NUDO_EXECUTE_COMMANDS`
 * — a stable inventory) ⇒ `vscode-languageclient` registers them as VS Code
 * commands **by itself**, on the client-initialization path ⇒ registering
 * the same ids again through `vscode.commands.registerCommand` throws
 * `command '<id>' already exists` ⇒ the whole language client dies (no
 * diagnostics / hover / CodeLens / inlay hints).
 *
 * ⇒ The extension must NOT register these ids. It intercepts them through
 * `LanguageClientOptions.middleware.executeCommand` instead and keeps its
 * own behaviour (local highlight, Output preview, write gates) — the
 * server-side auto registration would only forward to the server.
 */
export const NUDO_CLIENT_COMMAND_IDS = [
  "nudo.selectCase",
  "nudo.selectContract",
  "nudo.trace",
  "nudo.contract",
  "nudo.contract.draft",
  "nudo.contract.emit",
] as const;

/** Extension-side handler signature (the middleware passes the raw args). */
type NudoCommandHandler = (...args: any[]) => unknown;

/**
 * Structured failure carried by a **result** payload.
 *
 * `nudo/selectCase` answers `{ success: false, error, isError: true }` as a
 * normal result (not a JSON-RPC error) ⇒ the `catch` branch never fires ⇒
 * the failure has to be surfaced explicitly (953).
 */
function structuredErrorMessage(result: unknown): string | undefined {
  if (result == null || typeof result !== "object") return undefined;
  const r = result as { success?: unknown; error?: unknown; isError?: unknown };
  if (r.isError !== true && r.success !== false) return undefined;
  if (typeof r.error === "string" && r.error.length > 0) return r.error;
  return "unknown error";
}

/**
 * `nudo.selectCase` —— activate one `@nudo:case` of a function.
 *
 * Call shapes:
 *   - CodeLens: `(uri, functionName, caseIndex, caseName)` — all present.
 *   - Command palette: **no arguments at all** (953) ⇒ `uri` falls back to
 *     the active editor, and the missing case parameters are reported
 *     instead of being shipped to the server as `undefined` (which used to
 *     leave a junk `undefined` entry in the local case table).
 */
async function handleSelectCase(
  uri?: string,
  functionName?: string,
  caseIndex?: number,
  caseName?: string,
): Promise<void> {
  const c = client;
  if (!c) return;

  const file = uri ?? window.activeTextEditor?.document.uri.toString();
  if (!file) {
    void window.showWarningMessage(
      "Nudo: select case needs an open file (use the CodeLens)",
    );
    return;
  }
  if (typeof functionName !== "string" || functionName.length === 0) {
    void window.showWarningMessage(
      "Nudo: select case needs a function name (use the CodeLens)",
    );
    return;
  }
  if (typeof caseIndex !== "number" || !Number.isInteger(caseIndex)) {
    void window.showWarningMessage(
      "Nudo: select case needs a case index (use the CodeLens)",
    );
    return;
  }

  // Optimistic local highlight, rolled back if the server rejects.
  const fileState = getFileState(file);
  const previous = fileState.get(functionName);
  fileState.set(functionName, { caseIndex, caseName: caseName ?? "" });
  updateHighlights();
  const rollback = (): void => {
    if (previous) fileState.set(functionName, previous);
    else fileState.delete(functionName);
    updateHighlights();
  };

  try {
    const result = await c.sendRequest<unknown>("nudo/selectCase", {
      uri: file,
      functionName,
      caseIndex,
    });
    // The server answers with a **result** ⇒ `catch` does not fire ⇒ the
    // structured failure has to be surfaced (and the highlight rolled back).
    const failure = structuredErrorMessage(result);
    if (failure) {
      rollback();
      void window.showErrorMessage(`Nudo: select case failed: ${failure}`);
    }
  } catch (err) {
    rollback();
    showRequestError("nudo/selectCase", err);
  }
}

/**
 * `nudo.selectContract` —— switch a function back to contract observation
 * (drops its activated case).
 *
 * The CodeLens always passes `(uri, functionName)`; the palette path passes
 * nothing (same shape as before the 972 rework — see the S2 report's
 * out-of-scope findings).
 */
async function handleSelectContract(
  uri?: string,
  functionName?: string,
): Promise<void> {
  const c = client;
  if (!c) return;

  // 服务端把契约激活记为「取消该函数激活 case」——
  // 本地 case 高亮同步清除（重检后透镜刷新由服务端
  // CodeLens/refresh 驱动）；请求失败不回滚（幂等）。
  const fileState = getFileState(uri as string);
  if (fileState.size > 0) {
    fileState.clear();
    updateHighlights();
  }
  try {
    await c.sendRequest("nudo/selectContract", { uri, functionName });
  } catch (err) {
    showRequestError("nudo/selectContract", err);
  }
}

/**
 * `nudo.trace` —— observation lens (`entry@` / `call@`).
 *
 * The CodeLens passes `(uri, functionName)`; the palette path falls back to
 * the active editor and reports the missing function name.
 */
async function handleTrace(
  uri?: string,
  functionName?: string,
): Promise<void> {
  if (!client) return;
  const file = uri ?? window.activeTextEditor?.document.uri.toString();
  if (!file || !functionName) {
    void window.showWarningMessage(
      "Nudo: trace needs a file and a function name (use the CodeLens)",
    );
    return;
  }
  const result = await sendNudoRequest("nudo/trace", { file, functionName });
  if (result === undefined) return;
  showNudoOutput(`trace ${functionName}`, extractToolText(result));
}

/** `nudo.contract` — show the effective contract of a file / function. */
async function handleContract(
  uri?: string,
  functionName?: string,
): Promise<void> {
  if (!client) return;
  const file = uri ?? window.activeTextEditor?.document.uri.toString();
  if (!file) {
    void window.showWarningMessage("Nudo: open a JS file or pass a URI");
    return;
  }
  const result = await sendNudoRequest("nudo/contract", {
    file,
    ...(functionName ? { functionName } : {}),
  });
  if (result === undefined) return;
  showNudoOutput(`contract ${functionName ?? file}`, extractToolText(result));
}

/**
 * `nudo.contract.draft` — draft a contract sidecar (preview → confirm → write).
 */
async function handleContractDraft(
  uri?: string,
  functionName?: string,
): Promise<void> {
  if (!client) return;
  const file = uri ?? window.activeTextEditor?.document.uri.toString();
  if (!file) {
    void window.showWarningMessage("Nudo: open a JS file or pass a URI");
    return;
  }
  const params = {
    file,
    ...(functionName ? { functionName } : {}),
  };
  const preview = await sendNudoRequest("nudo/contract.draft", params);
  if (preview === undefined) return;
  showNudoOutput(`draft ${functionName ?? file}`, extractToolText(preview));

  const pick = await window.showInformationMessage(
    "Nudo draft ready (review in Output). Write *.nudo.draft.js / *.nudo.draft.ts?",
    "Write draft file",
    "Dismiss",
  );
  if (pick === "Write draft file") {
    const written = await sendNudoRequest("nudo/contract.draft", {
      ...params,
      write: true,
    });
    if (written === undefined) return;
    showNudoOutput(`draft write ${functionName ?? file}`, extractToolText(written));
  }
}

/**
 * Persist targets of a file = the `nudo.contract.emit` CodeLens the server
 * produces for it (one per exported function whose interface can be
 * persisted, with the `add` / `update` mode).
 */
async function collectPersistTargets(
  uri: string,
): Promise<Array<{ fn: string; mode: "add" | "update" }>> {
  let lenses: CodeLens[] | undefined;
  try {
    lenses = await commands.executeCommand<CodeLens[] | undefined>(
      "vscode.executeCodeLensProvider",
      uri,
    );
  } catch {
    return [];
  }
  if (!Array.isArray(lenses)) return [];
  const targets: Array<{ fn: string; mode: "add" | "update" }> = [];
  for (const lens of lenses) {
    const cmd = lens.command;
    if (!cmd || cmd.command !== "nudo.contract.emit") continue;
    const args = cmd.arguments ?? [];
    const fn = args[1];
    if (typeof fn !== "string" || fn.length === 0) continue;
    const mode = args[2] === "update" ? "update" : "add";
    if (targets.some((t) => t.fn === fn)) continue;
    targets.push({ fn, mode });
  }
  return targets;
}

/** Interactive pick of the function to persist (palette path, 1057). */
async function pickPersistTarget(
  uri: string,
): Promise<{ fn: string; mode: "add" | "update" } | undefined> {
  const targets = await collectPersistTargets(uri);
  if (targets.length === 0) return undefined;
  const picked = await window.showQuickPick(
    targets.map((t) => ({
      label: t.fn,
      description:
        t.mode === "update" ? "update @generated" : "add @generated",
      target: t,
    })),
    {
      placeHolder:
        "Nudo: pick the function to persist (@generated contract)",
    },
  );
  return picked?.target;
}

/**
 * `nudo.contract.emit` — persist a contract into the sidecar's
 * `@generated` section.
 *
 * Call shapes:
 *   - CodeLens: `(uri, functionName, mode)` — all present.
 *   - Command palette: **no arguments** (1057) ⇒ `uri` falls back to the
 *     active editor and the function is picked interactively (the server
 *     needs a concrete `functionName`).
 *
 * The three-step gate (dry-run → Output preview → confirm → write) is the
 * same on both paths: the interactive pick only fills the missing
 * `functionName`, it never skips a gate.
 */
async function handleContractEmit(
  uri?: string,
  functionName?: string,
  mode?: string,
): Promise<void> {
  if (!client) return;
  const file = uri ?? window.activeTextEditor?.document.uri.toString();
  if (!file) {
    void window.showWarningMessage("Nudo: open a JS file or pass a URI");
    return;
  }

  let target = functionName;
  let targetMode: "add" | "update" = mode === "update" ? "update" : "add";
  if (!target) {
    // 1057: the palette path has no function name ⇒ pick it from the
    // file's persist targets (the server's own `nudo.contract.emit` lenses).
    const picked = await pickPersistTarget(file);
    if (!picked) {
      void window.showWarningMessage(
        "Nudo: no persistable function found in this file (use the ⚡ persist interface CodeLens)",
      );
      return;
    }
    target = picked.fn;
    targetMode = picked.mode;
  }

  const params = {
    file,
    functionName: target,
    mode: targetMode,
  };
  // 先 dry-run 预览，确认后再写盘（与 draft 同门禁体验）。
  // 服务端 dryRun:true 只分析不写盘；响应含 [dry-run] would update / 诊断。
  const preview = await sendNudoRequest("nudo/contract.emit", {
    ...params,
    dryRun: true,
  });
  if (preview === undefined) return;
  const previewText = extractToolText(preview);
  showNudoOutput(`persist dry-run preview ${target}`, previewText);
  // dry-run 失败（入参/门禁）时不提供写盘选项，避免用户确认后二次失败。
  // 契约面以 isError 为准，`Error:` 前缀只作旧载荷兜底。
  if (isToolError(preview)) return;
  const pick = await window.showInformationMessage(
    `Nudo: persist contract for ${target}? (review dry-run in Output — no sidecar written yet)`,
    "Write sidecar",
    "Dismiss",
  );
  if (pick !== "Write sidecar") return;
  const result = await sendNudoRequest("nudo/contract.emit", params);
  if (result === undefined) return;
  showNudoOutput(`persist ${target}`, extractToolText(result));
}

/** Extension-side handlers for the client commands (see NUDO_CLIENT_COMMAND_IDS). */
const NUDO_CLIENT_COMMAND_HANDLERS: Record<string, NudoCommandHandler> = {
  "nudo.selectCase": handleSelectCase,
  "nudo.selectContract": handleSelectContract,
  "nudo.trace": handleTrace,
  "nudo.contract": handleContract,
  "nudo.contract.draft": handleContractDraft,
  "nudo.contract.emit": handleContractEmit,
};

export async function activate(context: ExtensionContext): Promise<void> {
  // Bundled by scripts/bundle-server.mjs from @nudojs/lsp dist (self-contained vsix).
  const serverModule = context.asAbsolutePath(path.join("server", "server.js"));

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const fileEvents = createSourceFileWatcher(
    "**/{*.js,*.mjs,*.ts,package.json,nudo.json,nudo.config.js,nudo.config.mjs,nudo.config.ts,.nudorc,.nudorc.json}",
  );
  context.subscriptions.push(fileEvents);

  const clientOptions: LanguageClientOptions = {
    // javascriptreact/typescriptreact: parser accepts JSX; VS Code classifies
    // .jsx/.tsx (and some .js-with-JSX) as these languages.
    documentSelector: [
      { scheme: "file", language: "javascript" },
      { scheme: "file", language: "javascriptreact" },
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "typescriptreact" },
    ],
    synchronize: {
      // 源码 + 侧车 + 项目配置：package.json#nudo.* / nudo.json 变更也要进 LSP
      fileEvents,
    },
    // VS Code `nudo.*` 设置 → 服务端默认值（项目 package.json#nudo.* 显式值优先；
    // 优先级同时写在 package.json 配置 description 里）
    initializationOptions: toInitializationOptions(workspace.getConfiguration("nudo")),
    // 972：服务端广告的 id 由 languageclient **自动**注册成 VS Code 命令 ⇒
    // 扩展若再用 `commands.registerCommand` 注册同名 id，客户端初始化期直接抛
    // `command '<id>' already exists` ⇒ 整个 language client 起不来。
    // ⇒ 扩展侧的自有行为（本地高亮 / Output 预览 / 写盘门禁）改由 middleware
    // 拦截，其余 id 原样转发给服务端。
    middleware: {
      executeCommand: (command, args, next) => {
        const handler = NUDO_CLIENT_COMMAND_HANDLERS[command];
        if (!handler) return next(command, args);
        return handler(...args);
      },
    },
  };

  client = new LanguageClient(
    "nudo",
    "Nudo Language Server",
    serverOptions,
    clientOptions,
  );

  activeCaseDecorationType = window.createTextEditorDecorationType({
    backgroundColor: "rgba(255, 200, 50, 0.15)",
    isWholeLine: true,
    overviewRulerColor: "rgba(255, 200, 50, 0.5)",
    borderWidth: "0 0 0 3px",
    borderStyle: "solid",
    borderColor: "rgba(255, 200, 50, 0.6)",
  });
  context.subscriptions.push(activeCaseDecorationType);

  output = window.createOutputChannel("Nudo");
  context.subscriptions.push(output);

  const statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  statusBar.text = "$(symbol-type-parameter) Nudo";
  statusBar.tooltip = "Nudo Type Inference Engine";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // 972：以下 6 个命令 id **不再**用 `commands.registerCommand` 注册——
  // 服务端把它们广告在 `executeCommandProvider.commands` 里，languageclient
  // 会自动注册成 VS Code 命令；扩展再注册一次 ⇒ 客户端初始化期抛
  // `command '<id>' already exists` ⇒ 整个 language client 起不来。
  // ⇒ 改由 `clientOptions.middleware.executeCommand` 拦截（见
  // `NUDO_CLIENT_COMMAND_HANDLERS`），扩展侧行为（本地高亮 / Output 预览 /
  // 写盘门禁）原样保留。

  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(() => updateHighlights()),
  );

  // 1019：active-case 高亮是**基于文本快照算出的绝对行号区间** ⇒ 文档一改，
  // 高亮就会整体漂移到别的代码上（只挂在 `onDidChangeActiveTextEditor` 上
  // ⇒ 不切换编辑器的编辑完全不重算）。⇒ 订阅文档变更并重算。
  context.subscriptions.push(
    workspace.onDidChangeTextDocument((event) => {
      const editor = window.activeTextEditor;
      if (!editor) return;
      if (event.document.uri.toString() !== editor.document.uri.toString()) {
        return;
      }
      updateHighlights();
    }),
  );

  // LSP-G4：共存配方一键写入 workspace settings（不静默改用户配置）。
  // suggestMuteTsValidation=false（扩展侧消费，不进 server）：不再弹 tsserver
  // 静音建议，只留指南入口。
  context.subscriptions.push(
    commands.registerCommand("nudo.coexistence.apply", async () => {
      const suggestMute = workspace
        .getConfiguration("nudo.coexistence")
        .get<boolean>("suggestMuteTsValidation", true);
      if (!suggestMute) {
        const guide = await window.showInformationMessage(
          "Nudo: tsserver mute suggestions are disabled (nudo.coexistence.suggestMuteTsValidation).",
          "Open coexistence guide",
        );
        if (guide === "Open coexistence guide") openCoexistenceGuide();
        return;
      }
      const pick = await window.showInformationMessage(
        "Nudo coexistence: mute built-in JS validation on nudo-managed workspaces to avoid stacked tsserver diagnostics?",
        "Apply to workspace",
        "Open coexistence guide",
        "Dismiss",
      );
      if (pick === "Apply to workspace") {
        const cfg = workspace.getConfiguration();
        await cfg.update(
          "javascript.validate.enable",
          false,
          ConfigurationTarget.Workspace,
        );
        void window.showInformationMessage(
          "Nudo: javascript.validate.enable=false (workspace). Re-enable if you still want tsserver on plain JS.",
        );
      } else if (pick === "Open coexistence guide") {
        openCoexistenceGuide();
      }
    }),
  );

  // 设置转发：nudo.* 变更 → workspace/didChangeConfiguration（其余段不推，
  // 避免噪声）。服务端把 settings.nudo 当项目配置缺失时的默认值。
  context.subscriptions.push(
    workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("nudo")) return;
      const c = client;
      if (!c) return;
      void c.sendNotification(
        DidChangeConfigurationNotification.type,
        toDidChangeConfigurationParams(workspace.getConfiguration("nudo")),
      );
    }),
  );

  const startLanguageClient = async (c: LanguageClient): Promise<void> => {
    try {
      await c.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void window.showErrorMessage(
        `Nudo: failed to start language server: ${message}`,
      );
    }
  };

  // Register state hooks before start so crashes after a live session are seen.
  const startedClient = client;
  context.subscriptions.push(
    startedClient.onDidChangeState(({ oldState, newState }) => {
      if (shuttingDown) return;
      // Crash / unexpected stop after a live session. The default LSP error
      // handler may auto-restart; surface it either way and offer a manual retry.
      // Start failures are toasted by startLanguageClient's catch.
      if (newState === State.Stopped && oldState === State.Running) {
        void window
          .showErrorMessage("Nudo: language server stopped unexpectedly.", "Restart")
          .then((pick) => {
            if (pick !== "Restart" || shuttingDown) return;
            const c = client;
            if (c && c.needsStart()) void startLanguageClient(c);
          });
      }
    }),
  );

  await startLanguageClient(startedClient);
}

function getFileState(uri: string): Map<string, { caseIndex: number; caseName: string }> {
  const existing = activeCaseState.get(uri);
  if (existing) return existing;
  const map = new Map<string, { caseIndex: number; caseName: string }>();
  activeCaseState.set(uri, map);
  return map;
}

function updateHighlights(): void {
  const decorationType = activeCaseDecorationType;
  if (!decorationType) return;

  const editor = window.activeTextEditor;
  if (!editor) return;

  const uri = editor.document.uri.toString();
  const fileState = activeCaseState.get(uri);
  if (!fileState || fileState.size === 0) {
    editor.setDecorations(decorationType, []);
    return;
  }

  const text = editor.document.getText();
  const decorations = findCaseCommentDecorations(text, fileState);
  editor.setDecorations(decorationType, decorations);
}

function findCaseCommentDecorations(
  text: string,
  fileState: Map<string, { caseIndex: number; caseName: string }>,
): DecorationOptions[] {
  // 解析主体单源 @nudojs/parser（与服务端同一 @nudo:case 文法）；此处只做
  // 纯数据 → vscode.Range 的薄映射。
  return computeCaseDecorationSpans(text, fileState).map((span) => ({
    range: new Range(
      new Position(span.startLine, span.startChar),
      new Position(span.endLine, span.endChar),
    ),
  }));
}

export function deactivate(): Promise<void> | undefined {
  shuttingDown = true;
  if (!client) return undefined;
  return client.stop();
}
