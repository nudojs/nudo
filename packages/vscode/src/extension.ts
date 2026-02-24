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
} from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

const activeCaseDecorationType = window.createTextEditorDecorationType({
  backgroundColor: "rgba(255, 200, 50, 0.15)",
  isWholeLine: true,
  overviewRulerColor: "rgba(255, 200, 50, 0.5)",
  borderWidth: "0 0 0 3px",
  borderStyle: "solid",
  borderColor: "rgba(255, 200, 50, 0.6)",
});

const activeCaseState = new Map<string, Map<string, { caseIndex: number; caseName: string }>>();

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
      { scheme: "file", language: "javascript" },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.js"),
    },
  };

  client = new LanguageClient(
    "nudo",
    "Nudo Language Server",
    serverOptions,
    clientOptions,
  );

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
  const decorations: DecorationOptions[] = [];
  const lines = text.split("\n");

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
    } else if (!line.match(/^\s*\*/) && !line.match(/^\s*\//) && line.trim() !== "") {
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
