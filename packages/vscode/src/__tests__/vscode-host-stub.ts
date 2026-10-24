/**
 * Shared VS Code host stub for the extension-side regression pins.
 *
 * The `vscode` module does not exist outside the extension host ⇒ the pins
 * mock it (and `vscode-languageclient/node`) and drive the **real**
 * `packages/vscode/src/extension.ts` through `activate()`.
 *
 * The stub mirrors the host semantics the pins depend on:
 *   - `commands.registerCommand` throws `command '<id>' already exists` on a
 *     duplicate id (VS Code 1.91 `extHostCommands` semantics — the mechanism
 *     behind Bug 972),
 *   - the command palette invokes a command **without arguments**,
 *   - `window.showWarningMessage` / `showErrorMessage` / `showInformationMessage`
 *     / `showQuickPick` are recorded (that is the whole user-visible surface
 *     the palette paths were missing),
 *   - `editor.setDecorations` records the active-case highlight ranges.
 *
 * The fake `LanguageClient` keeps the `middleware` the extension configured
 * and answers `sendRequest` from `state.responses` (the server side is stubbed
 * so the pins stay hermetic — no `@nudojs/lsp` dependency in this package).
 */

export type DocChangeEvent = {
  document: { uri: { toString(): string } };
};

export type DecorationRange = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

export type HostState = {
  /** VS Code command registry (id → handler). */
  registered: Map<string, (...args: unknown[]) => unknown>;
  warnings: string[];
  errors: string[];
  infos: string[];
  outputLines: string[];
  /** `editor.setDecorations` calls (one entry per call). */
  decorations: DecorationRange[][];
  /** `client.sendRequest` calls. */
  requests: { method: string; params: unknown }[];
  quickPickCalls: unknown[];
  /** `workspace.onDidChangeTextDocument` subscribers. */
  docListeners: ((e: DocChangeEvent) => void)[];
  /** Stubbed server answers: method → payload (or a function of the params). */
  responses: Map<string, unknown>;
  /** Answer the next `showInformationMessage` with. */
  infoAnswer: string | undefined;
  /** Answer the next `showQuickPick` with. */
  quickPickAnswer: unknown;
  /** Text the stubbed editor reports. */
  editorText: string;
  /** URI the stubbed editor reports. */
  editorUri: string;
  /** `vscode.executeCodeLensProvider` answer. */
  codeLens: unknown[];
  reset(): void;
};

export type Host = {
  state: HostState;
  /** The mocked `vscode` module. */
  vscodeModule: Record<string, unknown>;
  /** The mocked `vscode-languageclient/node` module. */
  languageClientModule: Record<string, unknown>;
  /** The middleware the extension configured on the client options. */
  middleware: {
    executeCommand?: (
      command: string,
      args: unknown[],
      next: (command: string, args: unknown[]) => unknown,
    ) => unknown;
  };
  /** Register a command the way the language client would (duplicate ⇒ throw). */
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): void;
  /** Invoke a client command the way VS Code does (palette ⇒ no args). */
  invokeCommand(id: string, args?: unknown[]): Promise<void>;
  /** Fire the `workspace.onDidChangeTextDocument` subscribers. */
  fireDocumentChange(uri: string): void;
};

function createHost(): Host {
  const state: HostState = {
    registered: new Map(),
    warnings: [],
    errors: [],
    infos: [],
    outputLines: [],
    decorations: [],
    requests: [],
    quickPickCalls: [],
    docListeners: [],
    responses: new Map(),
    infoAnswer: undefined,
    quickPickAnswer: undefined,
    editorText: "",
    editorUri: "file:///workspace/sample.js",
    codeLens: [],
    reset() {
      state.warnings.length = 0;
      state.errors.length = 0;
      state.infos.length = 0;
      state.outputLines.length = 0;
      state.decorations.length = 0;
      state.requests.length = 0;
      state.quickPickCalls.length = 0;
      state.infoAnswer = undefined;
      state.quickPickAnswer = undefined;
    },
  };

  const host: Host = {
    state,
    middleware: {},
    registerCommand(id, handler) {
      if (state.registered.has(id)) {
        throw new Error(`command '${id}' already exists`);
      }
      state.registered.set(id, handler);
    },
    async invokeCommand(id, args = []) {
      const handler = state.registered.get(id);
      if (handler) {
        await handler(...args);
        return;
      }
      const mw = host.middleware.executeCommand;
      if (!mw) throw new Error(`command '${id}' is not reachable`);
      await mw(id, args, async () => undefined);
    },
    fireDocumentChange(uri) {
      for (const listener of state.docListeners) {
        listener({ document: { uri: { toString: () => uri } } });
      }
    },
    vscodeModule: {},
    languageClientModule: {},
  };

  class Position {
    constructor(
      public line: number,
      public character: number,
    ) {}
  }
  class Range {
    constructor(
      public start: Position,
      public end: Position,
    ) {}
  }

  const editor = {
    document: {
      uri: { toString: () => state.editorUri },
      getText: () => state.editorText,
    },
    setDecorations: (_type: unknown, ranges: DecorationRange[]) => {
      state.decorations.push(ranges);
    },  };

  host.vscodeModule = {
    version: "1.104.2",
    commands: {
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
        host.registerCommand(id, handler);
        return { dispose() {} };
      },
      executeCommand: async (command: string, ...args: unknown[]) => {
        if (command === "vscode.executeCodeLensProvider") return state.codeLens;
        return undefined;
      },
      getCommands: async () => [...state.registered.keys()],
    },
    window: {
      createOutputChannel: () => ({
        clear: () => {},
        appendLine: (line: string) => state.outputLines.push(line),
        show: () => {},
        dispose: () => {},
      }),
      createTextEditorDecorationType: () => ({ dispose() {} }),
      createStatusBarItem: () => ({ show() {}, dispose() {} }),
      showWarningMessage: async (message: string) => {
        state.warnings.push(message);
        return undefined;
      },
      showErrorMessage: async (message: string) => {
        state.errors.push(message);
        return undefined;
      },
      showInformationMessage: async (message: string) => {
        state.infos.push(message);
        return state.infoAnswer;
      },
      showQuickPick: async (items: unknown) => {
        state.quickPickCalls.push(items);
        if (state.quickPickAnswer !== undefined) return state.quickPickAnswer;
        const list = items as Array<{ label: string }>;
        return list[0];
      },
      showInputBox: async () => undefined,
      activeTextEditor: editor,
      onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    },
    workspace: {
      getConfiguration: () => ({
        get: <T = unknown>(_section: string): T | undefined => undefined,
        update: async () => undefined,
      }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      onDidChangeTextDocument: (
        listener: (e: DocChangeEvent) => void,
      ) => {
        state.docListeners.push(listener);
        return { dispose() {} };
      },
      workspaceFolders: undefined,
      createFileSystemWatcher: () => ({
        onDidCreate: () => ({ dispose() {} }),
        onDidChange: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        dispose() {},
      }),
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    Position,
    Range,
    Uri: { parse: (value: string) => value },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    CodeLens: class {},
    EventEmitter: class {
      listeners: Array<(e: unknown) => void> = [];
      event = (listener: (e: unknown) => void) => {
        this.listeners.push(listener);
        return { dispose() {} };
      };
      fire(e?: unknown) {
        for (const l of this.listeners) l(e);
      }
      dispose() {}
    },
  };

  class FakeLanguageClient {
    constructor(
      _id: string,
      _name: string,
      _serverOptions: unknown,
      clientOptions: { middleware?: Host["middleware"] },
    ) {
      host.middleware = clientOptions.middleware ?? {};
    }
    async start() {}
    async stop() {}
    onDidChangeState() {
      return { dispose() {} };
    }
    async sendRequest(method: string, params: unknown) {
      state.requests.push({ method, params });
      if (state.responses.has(method)) {
        const answer = state.responses.get(method);
        return typeof answer === "function"
          ? (answer as (p: unknown) => unknown)(params)
          : answer;
      }
      return undefined;
    }
  }

  host.languageClientModule = {
    LanguageClient: FakeLanguageClient,
    State: { Stopped: 3, Starting: 1, Running: 2 },
    TransportKind: {
      stdio: "stdio",
      ipc: "ipc",
      pipe: "pipe",
      socket: "socket",
    },
    DidChangeConfigurationNotification: {
      type: "workspace/didChangeConfiguration",
    },
  };

  return host;
}

/** The singleton host stub shared by the extension-side pins of one file. */
export const host: Host = createHost();

/** Minimal `ExtensionContext` for `activate()`. */
export function makeExtensionContext(): {
  subscriptions: unknown[];
  asAbsolutePath: (relative: string) => string;
} {
  return {
    subscriptions: [],
    asAbsolutePath: (relative: string) => `/nudo-vscode/${relative}`,
  };
}
