import * as path from "path";
import {
  type ExtensionContext,
  workspace,
  window,
  StatusBarAlignment,
  commands,
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

  context.subscriptions.push(
    commands.registerCommand(
      "nudo.selectCase",
      async (uri: string, functionName: string, caseIndex: number, caseName: string) => {
        const c = client;
        if (!c) return;

        // Optimistic local highlight, rolled back if the server rejects.
        const fileState = getFileState(uri);
        const previous = fileState.get(functionName);
        fileState.set(functionName, { caseIndex, caseName });
        updateHighlights();

        try {
          await c.sendRequest("nudo/selectCase", { uri, functionName, caseIndex });
        } catch (err) {
          if (previous) fileState.set(functionName, previous);
          else fileState.delete(functionName);
          updateHighlights();
          showRequestError("nudo/selectCase", err);
        }
      },
    ),
  );

  context.subscriptions.push(
    commands.registerCommand("nudo.contract", async (uri?: string, functionName?: string) => {
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
    }),
  );

  context.subscriptions.push(
    commands.registerCommand(
      "nudo.contract.draft",
      async (uri?: string, functionName?: string) => {
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
      },
    ),
  );

  context.subscriptions.push(
    commands.registerCommand(
      "nudo.contract.emit",
      async (uri?: string, functionName?: string, mode?: string) => {
        if (!client) return;
        const file = uri ?? window.activeTextEditor?.document.uri.toString();
        if (!file || !functionName) {
          void window.showWarningMessage("Nudo: persist needs a function name (use CodeLens)");
          return;
        }
        const params = {
          file,
          functionName,
          mode: mode === "update" ? "update" : "add",
        };
        // 先 dry-run 预览，确认后再写盘（与 draft 同门禁体验）。
        // 服务端 dryRun:true 只分析不写盘；响应含 [dry-run] would update / 诊断。
        const preview = await sendNudoRequest("nudo/contract.emit", {
          ...params,
          dryRun: true,
        });
        if (preview === undefined) return;
        const previewText = extractToolText(preview);
        showNudoOutput(`persist dry-run preview ${functionName}`, previewText);
        // dry-run 失败（入参/门禁）时不提供写盘选项，避免用户确认后二次失败。
        // 契约面以 isError 为准，`Error:` 前缀只作旧载荷兜底。
        if (isToolError(preview)) return;
        const pick = await window.showInformationMessage(
          `Nudo: persist contract for ${functionName}? (review dry-run in Output — no sidecar written yet)`,
          "Write sidecar",
          "Dismiss",
        );
        if (pick !== "Write sidecar") return;
        const result = await sendNudoRequest("nudo/contract.emit", params);
        if (result === undefined) return;
        showNudoOutput(`persist ${functionName}`, extractToolText(result));
      },
    ),
  );

  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(() => updateHighlights()),
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
