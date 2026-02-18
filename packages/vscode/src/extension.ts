import * as path from "path";
import { type ExtensionContext, workspace, window, StatusBarAlignment } from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(
    path.join("..", "lsp", "src", "server.ts"),
  );

  const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--import", "tsx"] },
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { ...debugOptions, execArgv: [...debugOptions.execArgv, "--import", "tsx"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "justscript" },
      { scheme: "file", language: "javascript", pattern: "**/*.just.js" },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.just.js"),
    },
  };

  client = new LanguageClient(
    "justscript",
    "JustScript Language Server",
    serverOptions,
    clientOptions,
  );

  const statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  statusBar.text = "$(symbol-type-parameter) JustScript";
  statusBar.tooltip = "JustScript Type Inference Engine";
  statusBar.show();
  context.subscriptions.push(statusBar);

  client.start();
}

export function deactivate(): Promise<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}
