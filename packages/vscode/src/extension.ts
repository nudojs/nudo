import * as path from "path";
import {
  type ExtensionContext,
  workspace,
  window,
  StatusBarAlignment,
  commands,
  type DecorationOptions,
  Range,
  Position,
  type OutputChannel,
} from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;
let output: OutputChannel | undefined;

const activeCaseDecorationType = window.createTextEditorDecorationType({
  backgroundColor: "rgba(255, 200, 50, 0.15)",
  isWholeLine: true,
  overviewRulerColor: "rgba(255, 200, 50, 0.5)",
  borderWidth: "0 0 0 3px",
  borderStyle: "solid",
  borderColor: "rgba(255, 200, 50, 0.6)",
});

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

function showNudoOutput(label: string, text: string): void {
  if (!output) output = window.createOutputChannel("Nudo");
  output.clear();
  output.appendLine(`# ${label}`);
  output.appendLine(text);
  output.show(true);
}

export function activate(context: ExtensionContext): void {
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

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "javascript" },
      { scheme: "file", language: "typescript" },
    ],
    synchronize: {
      // 源码 + 侧车：*.nudo.js 命中 .js，*.nudo.ts 命中 .ts；.mjs 入口一并覆盖
      fileEvents: workspace.createFileSystemWatcher("**/*.{js,mjs,ts}"),
    },
  };

  client = new LanguageClient(
    "nudo",
    "Nudo Language Server",
    serverOptions,
    clientOptions,
  );

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
        if (!client) return;

        const fileState = getFileState(uri);
        fileState.set(functionName, { caseIndex, caseName });

        updateHighlights();

        await client.sendRequest("nudo/selectCase", { uri, functionName, caseIndex });
      },
    ),
  );

  context.subscriptions.push(
    commands.registerCommand("nudo.interface", async (uri?: string, functionName?: string) => {
      if (!client) return;
      const file = uri ?? window.activeTextEditor?.document.uri.toString();
      if (!file) {
        void window.showWarningMessage("Nudo: open a JS file or pass a URI");
        return;
      }
      const result = await client.sendRequest("nudo/interface", {
        file,
        ...(functionName ? { functionName } : {}),
      });
      showNudoOutput(`interface ${functionName ?? file}`, extractToolText(result));
    }),
  );

  context.subscriptions.push(
    commands.registerCommand(
      "nudo.interface.draft",
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
        const preview = await client.sendRequest("nudo/interface.draft", params);
        showNudoOutput(`draft ${functionName ?? file}`, extractToolText(preview));

        const pick = await window.showInformationMessage(
          "Nudo draft ready (review in Output). Write *.nudo.draft.js / *.nudo.draft.ts?",
          "Write draft file",
          "Dismiss",
        );
        if (pick === "Write draft file") {
          const written = await client.sendRequest("nudo/interface.draft", {
            ...params,
            write: true,
          });
          showNudoOutput(`draft write ${functionName ?? file}`, extractToolText(written));
        }
      },
    ),
  );

  context.subscriptions.push(
    commands.registerCommand(
      "nudo.interfaceEmit",
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
        const preview = await client.sendRequest("nudo/interface.emit", {
          ...params,
          dryRun: true,
        });
        const previewText = extractToolText(preview);
        showNudoOutput(`persist dry-run preview ${functionName}`, previewText);
        // dry-run 失败（入参/门禁）时不提供写盘选项，避免用户确认后二次失败
        const previewIsError =
          previewText.startsWith("Error:") ||
          (preview as { isError?: boolean } | null)?.isError === true;
        if (previewIsError) return;
        const pick = await window.showInformationMessage(
          `Nudo: persist contract for ${functionName}? (review dry-run in Output — no sidecar written yet)`,
          "Write sidecar",
          "Dismiss",
        );
        if (pick !== "Write sidecar") return;
        const result = await client.sendRequest("nudo/interface.emit", params);
        showNudoOutput(`persist ${functionName}`, extractToolText(result));
      },
    ),
  );

  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(() => updateHighlights()),
  );

  client.start();
}

function getFileState(uri: string): Map<string, { caseIndex: number; caseName: string }> {
  const existing = activeCaseState.get(uri);
  if (existing) return existing;
  const map = new Map<string, { caseIndex: number; caseName: string }>();
  activeCaseState.set(uri, map);
  return map;
}

function updateHighlights(): void {
  const editor = window.activeTextEditor;
  if (!editor) return;

  const uri = editor.document.uri.toString();
  const fileState = activeCaseState.get(uri);
  if (!fileState || fileState.size === 0) {
    editor.setDecorations(activeCaseDecorationType, []);
    return;
  }

  const text = editor.document.getText();
  const decorations = findCaseCommentDecorations(text, fileState);
  editor.setDecorations(activeCaseDecorationType, decorations);
}

function findCaseCommentDecorations(
  text: string,
  fileState: Map<string, { caseIndex: number; caseName: string }>,
): DecorationOptions[] {
  const lines = text.split("\n");
  const decorations: DecorationOptions[] = [];

  type FnBlock = { functionName: string; caseLines: { name: string; lineIndex: number }[] };
  const fnBlocks: FnBlock[] = [];
  let pendingCases: { name: string; lineIndex: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const caseMatch = line.match(/@nudo:case\s+"([^"]+)"/);
    if (caseMatch) {
      pendingCases.push({ name: caseMatch[1], lineIndex: i });
      continue;
    }

    const fnMatch = line.match(/(?:async\s+)?function\s+(\w+)/);
    if (fnMatch && pendingCases.length > 0) {
      fnBlocks.push({ functionName: fnMatch[1], caseLines: pendingCases });
      pendingCases = [];
    } else if (!line.match(/^\s*\*/) && !line.match(/^\s*\/\//) && line.trim() !== "") {
      pendingCases = [];
    }
  }

  for (const block of fnBlocks) {
    const state = fileState.get(block.functionName);
    if (!state) continue;

    for (const cl of block.caseLines) {
      if (cl.name === state.caseName) {
        const line = lines[cl.lineIndex];
        decorations.push({
          range: new Range(new Position(cl.lineIndex, 0), new Position(cl.lineIndex, line.length)),
        });
      }
    }
  }

  return decorations;
}

export function deactivate(): Promise<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}
