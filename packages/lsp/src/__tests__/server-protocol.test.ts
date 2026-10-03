/**
 * JSON-RPC-ish protocol tests for createNudoServer (importable without
 * starting a transport). Uses an in-memory mock Connection that records
 * request handlers — not the real stdio/node-ipc transport.
 *
 * Covered: initialize capabilities inventory, workspace/executeCommand and
 * custom-request dispatch (slash + dot forms), and fail-closed error paths.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { Connection } from "vscode-languageserver/node";
import { createNudoServer } from "../server.ts";
import {
  NUDO_EXECUTE_COMMANDS,
  NUDO_INITIALIZE_CAPABILITIES,
  NUDO_AGENT_TOOL_NAMES,
} from "../public-api.ts";

type AnyHandler = (params: any) => any;

function createMockConnection() {
  const requests = new Map<string, AnyHandler>();
  const notifications = new Map<string, AnyHandler>();
  const sentDiagnostics: any[] = [];
  const sentRequests: any[] = [];
  const consoleErrors: string[] = [];
  let listened = false;

  const register =
    (map: Map<string, AnyHandler>) =>
    (method: string, handler: AnyHandler): { dispose: () => void } => {
      map.set(method, handler);
      return { dispose: () => map.delete(method) };
    };

  const byName = register(requests);

  const mock = {
    onInitialize: (h: AnyHandler) => byName("initialize", h),
    onExecuteCommand: (h: AnyHandler) => byName("workspace/executeCommand", h),
    onRequest: (method: string, h: AnyHandler) => byName(method, h),
    onHover: (h: AnyHandler) => byName("textDocument/hover", h),
    onCompletion: (h: AnyHandler) => byName("textDocument/completion", h),
    onCodeLens: (h: AnyHandler) => byName("textDocument/codeLens", h),
    onSignatureHelp: (h: AnyHandler) => byName("textDocument/signatureHelp", h),
    onCodeAction: (h: AnyHandler) => byName("textDocument/codeAction", h),
    onDefinition: (h: AnyHandler) => byName("textDocument/definition", h),
    onDocumentSymbol: (h: AnyHandler) => byName("textDocument/documentSymbol", h),
    onPrepareRename: (h: AnyHandler) => byName("textDocument/prepareRename", h),
    onReferences: (h: AnyHandler) => byName("textDocument/references", h),
    onRenameRequest: (h: AnyHandler) => byName("textDocument/rename", h),
    onWorkspaceSymbol: (h: AnyHandler) => byName("workspace/symbol", h),
    onDidChangeWatchedFiles: (h: AnyHandler) =>
      register(notifications)("workspace/didChangeWatchedFiles", h),
    onDidChangeConfiguration: (h: AnyHandler) =>
      register(notifications)("workspace/didChangeConfiguration", h),
    // TextDocuments.listen requires the singular notification names
    onDidOpenTextDocument: (h: AnyHandler) =>
      register(notifications)("textDocument/didOpen", h),
    onDidChangeTextDocument: (h: AnyHandler) =>
      register(notifications)("textDocument/didChange", h),
    onDidCloseTextDocument: (h: AnyHandler) =>
      register(notifications)("textDocument/didClose", h),
    onDidSaveTextDocument: (h: AnyHandler) =>
      register(notifications)("textDocument/didSave", h),
    onWillSaveTextDocument: (h: AnyHandler) =>
      register(notifications)("textDocument/willSave", h),
    onWillSaveTextDocumentWaitUntil: (h: AnyHandler) =>
      register(notifications)("textDocument/willSaveWaitUntil", h),
    languages: {
      diagnostics: {
        on: (h: AnyHandler) => byName("textDocument/diagnostic", h),
      },
      inlayHint: {
        on: (h: AnyHandler) => byName("textDocument/inlayHint", h),
      },
      semanticTokens: {
        on: (h: AnyHandler) => byName("textDocument/semanticTokens/full", h),
      },
    },
    sendDiagnostics: (params: any) => {
      sentDiagnostics.push(params);
    },
    sendRequest: (type: any, params?: any) => {
      sentRequests.push({ type, params });
      return Promise.resolve(undefined);
    },
    console: {
      error: (msg: string) => {
        consoleErrors.push(String(msg));
      },
      warn: () => {},
      log: () => {},
      info: () => {},
    },
    listen: () => {
      listened = true;
    },
    // test surface
    requests,
    notifications,
    sentDiagnostics,
    sentRequests,
    consoleErrors,
    get listened() {
      return listened;
    },
  };
  return mock;
}

type Mock = ReturnType<typeof createMockConnection>;

function startServer(): Mock {
  const mock = createMockConnection();
  const handle = createNudoServer(mock as unknown as Connection);
  // transport must not start on construction
  expect(mock.listened).toBe(false);
  void handle;
  return mock;
}

function handler(mock: Mock, method: string): AnyHandler {
  const h = mock.requests.get(method);
  expect(h, `handler "${method}" not registered`).toBeTruthy();
  return h!;
}

const CHECK_OK = `
export function add(x, y) {
  return x + y;
}
`;

const CHECK_FAIL = `
/**
 * @nudo:contract x: number() > 0
 */
function needsPositive(x) {
  return x;
}
needsPositive(-1);
`;

let dir: string;
let okFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-lsp-proto-"));
  okFile = join(dir, "add.js");
  writeFileSync(okFile, CHECK_OK, "utf-8");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createNudoServer — initialize", () => {
  it("declares the full capability inventory and command list", async () => {
    const mock = startServer();
    const result = await handler(mock, "initialize")({
      processId: null,
      rootUri: null,
      workspaceFolders: [{ uri: "file:///tmp/nudo-proto-ws", name: "ws" }],
      capabilities: {},
    });
    for (const key of NUDO_INITIALIZE_CAPABILITIES) {
      expect(result.capabilities, `missing capability ${key}`).toHaveProperty(key);
    }
    expect(result.capabilities.hoverProvider).toBe(true);
    expect(result.capabilities.textDocumentSync).toBe(1); // Full
    expect(result.capabilities.executeCommandProvider.commands).toEqual([
      ...NUDO_EXECUTE_COMMANDS,
    ]);
    expect(result.capabilities.completionProvider.triggerCharacters).toEqual([".", "@"]);
    expect(result.capabilities.diagnosticProvider).toEqual({
      interFileDependencies: false,
      workspaceDiagnostics: false,
    });
  });

  it("registers slash- and dot-form request aliases for every agent tool", () => {
    const mock = startServer();
    for (const name of NUDO_AGENT_TOOL_NAMES) {
      expect(mock.requests.has(`nudo/${name}`), `missing nudo/${name}`).toBe(true);
      expect(mock.requests.has(`nudo.${name}`), `missing nudo.${name}`).toBe(true);
    }
    expect(mock.requests.has("nudo/selectCase")).toBe(true);
    expect(mock.requests.has("nudo/getActiveCases")).toBe(true);
    expect(mock.requests.has("textDocument/hover")).toBe(true);
    expect(mock.requests.has("textDocument/diagnostic")).toBe(true);
  });
});

describe("createNudoServer — request dispatch", () => {
  it("workspace/executeCommand nudo.check analyzes a source payload", async () => {
    const mock = startServer();
    const result = await handler(mock, "workspace/executeCommand")({
      command: "nudo.check",
      arguments: [{ file: join(dir, "inline.js"), source: CHECK_OK, format: "json" }],
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.version).toBe(1);
    expect(payload.ok).toBe(true);
    expect(payload.summary.functions).toBeGreaterThanOrEqual(1);
  });

  it("slash-form nudo/check and dot-form nudo.check share one handler", async () => {
    const mock = startServer();
    const params = { file: okFile, format: "json" };
    const viaSlash = await handler(mock, "nudo/check")(params);
    const viaDot = await handler(mock, "nudo.check")(params);
    expect(viaSlash.isError).toBeFalsy();
    expect(viaDot.isError).toBeFalsy();
    expect(viaDot.content[0].text).toBe(viaSlash.content[0].text);
    const payload = JSON.parse(viaSlash.content[0].text);
    expect(payload.ok).toBe(true);
  });

  it("nudo.getActiveCases returns the empty case map for a fresh uri", async () => {
    const mock = startServer();
    const result = await handler(mock, "nudo/getActiveCases")({
      file: join(dir, "fresh.js"),
    });
    expect(result).toEqual({});
  });
});

describe("createNudoServer — error paths", () => {
  it("unknown executeCommand dispatches to null without throwing", async () => {
    const mock = startServer();
    const result = await handler(mock, "workspace/executeCommand")({
      command: "nudo.notARealCommand",
      arguments: [{ file: okFile }],
    });
    expect(result).toBeNull();
  });

  it("nudo.check on a missing file returns isError (fail-closed)", async () => {
    const mock = startServer();
    const result = await handler(mock, "workspace/executeCommand")({
      command: "nudo.check",
      arguments: [{ file: join(dir, "no-such-file.js") }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Error:/);
  });

  it("pull diagnostics for an unknown document are empty (no crash)", async () => {
    const mock = startServer();
    const result = await handler(mock, "textDocument/diagnostic")({
      textDocument: { uri: "file:///definitely/not/open.js" },
    });
    expect(result).toEqual({ kind: "full", items: [] });
  });

  it("pull diagnostics catch 不得 items:[] — 标 Analysis error（R2B-003）", async () => {
    const mock = startServer();
    // 打开一个会让 analyzeFile 抛错的文档：带 @nudo 指令（过 isNudoFile gate）+ 语法错误
    const uri = "file:///t/syntax-err.js";
    const openHandler = mock.notifications.get("textDocument/didOpen");
    expect(openHandler).toBeTruthy();
    openHandler!({
      textDocument: {
        uri,
        languageId: "javascript",
        version: 1,
        text: `/**
 * @nudo:case 't' (1)
 */
function (`,
      },
    });
    const result = await handler(mock, "textDocument/diagnostic")({
      textDocument: { uri },
    });
    // 不得 items:[] 把瞬时失败当「文件干净」——必须留错误面
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.some((d: { message: string }) => /Analysis error|Check error/.test(d.message))).toBe(true);
  });

  it("pull diagnostics catch 保留上次已发布诊断（R2B-003）", async () => {
    const mock = startServer();
    const uri = "file:///t/preserve-last.js";
    const openHandler = mock.notifications.get("textDocument/didOpen")!;
    // 先开一个能成功分析的文档（带指令文法诊断 → items 非空）
    openHandler({
      textDocument: {
        uri,
        languageId: "javascript",
        version: 1,
        text: `/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }`,
      },
    });
    const okResult = await handler(mock, "textDocument/diagnostic")({
      textDocument: { uri },
    });
    expect(okResult.items.length).toBeGreaterThan(0);

    // 再换成带 @nudo 指令的语法错误源并 bump version → 分析抛错，应保留上次 items
    openHandler({
      textDocument: {
        uri,
        languageId: "javascript",
        version: 2,
        text: `/**
 * @nudo:case 't' (1)
 */
function (`,
      },
    });
    const errResult = await handler(mock, "textDocument/diagnostic")({
      textDocument: { uri },
    });
    expect(errResult.items.length).toBeGreaterThan(0);
    // 上次成功的诊断面仍在（不得被 catch 清空）
    expect(
      errResult.items.some((d: { code?: string }) => d.code === "nudo:directive-syntax"),
    ).toBe(true);
  });

  it("listen() is the only transport start — safe to call explicitly", () => {
    const mock = createMockConnection();
    const handle = createNudoServer(mock as unknown as Connection);
    expect(mock.listened).toBe(false);
    handle.listen();
    expect(mock.listened).toBe(true);
  });
});

describe("createNudoServer — client settings (initializationOptions / didChangeConfiguration)", () => {
  // 无导出、无指令的普通 JS：exports 档静默；all 档纳入。documentSymbol 的
  // isNudoFile gate 是行为观察面（非 nudo 文件 → []）。
  const PLAIN_SRC = "function plain(x) {\n  return x;\n}\n";

  let settingsDir: string;

  beforeAll(() => {
    settingsDir = mkdtempSync(join(tmpdir(), "nudo-lsp-settings-"));
  });

  afterAll(() => {
    rmSync(settingsDir, { recursive: true, force: true });
  });

  function notification(mock: Mock, method: string): AnyHandler {
    const h = mock.notifications.get(method);
    expect(h, `notification "${method}" not registered`).toBeTruthy();
    return h!;
  }

  function openPlainDoc(mock: Mock, rel: string): string {
    const filePath = join(settingsDir, rel, "plain.js");
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, PLAIN_SRC, "utf-8");
    const uri = `file://${filePath}`;
    notification(mock, "textDocument/didOpen")({
      textDocument: { uri, languageId: "javascript", version: 1, text: PLAIN_SRC },
    });
    return uri;
  }

  async function symbolsFor(mock: Mock, uri: string): Promise<{ name: string }[]> {
    return handler(mock, "textDocument/documentSymbol")({ textDocument: { uri } });
  }

  async function initServer(
    initializationOptions?: unknown,
  ): Promise<{ mock: Mock; reconfigure: (mode: unknown) => Promise<void> }> {
    const mock = startServer();
    await handler(mock, "initialize")({
      processId: null,
      rootUri: null,
      workspaceFolders: [],
      capabilities: {},
      ...(initializationOptions === undefined ? {} : { initializationOptions }),
    });
    return {
      mock,
      reconfigure: async (mode) => {
        notification(mock, "workspace/didChangeConfiguration")({
          settings: { nudo: { analysis: { mode } } },
        });
        // revalidate 是 fire-and-forget；让一轮跑完避免悬挂 Promise
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    };
  }

  it("plain non-export JS stays quiet without client settings (exports default)", async () => {
    const { mock } = await initServer();
    const uri = openPlainDoc(mock, "default");
    expect(await symbolsFor(mock, uri)).toEqual([]);
  });

  it("initializationOptions analysis.mode=all widens the gate", async () => {
    const { mock } = await initServer({ analysis: { mode: "all" } });
    const uri = openPlainDoc(mock, "all");
    const symbols = await symbolsFor(mock, uri);
    expect(symbols.map((s) => s.name)).toContain("plain");
  });

  it("invalid initializationOptions mode falls back to the product default", async () => {
    const { mock } = await initServer({ analysis: { mode: "loud" } });
    const uri = openPlainDoc(mock, "invalid");
    expect(await symbolsFor(mock, uri)).toEqual([]);
  });

  it("project package.json#nudo.analysis.mode wins over the client default (directives vs all)", async () => {
    const projDir = join(settingsDir, "proj-directives");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, "package.json"),
      JSON.stringify({ nudo: { analysis: { mode: "directives" } } }),
      "utf-8",
    );
    const { mock } = await initServer({ analysis: { mode: "all" } });
    const uri = openPlainDoc(mock, "proj-directives");
    expect(await symbolsFor(mock, uri)).toEqual([]);
  });

  it("project package.json#nudo.analysis.mode=all wins over client default directives", async () => {
    const projDir = join(settingsDir, "proj-all");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, "package.json"),
      JSON.stringify({ nudo: { analysis: { mode: "all" } } }),
      "utf-8",
    );
    const { mock } = await initServer({ analysis: { mode: "directives" } });
    const uri = openPlainDoc(mock, "proj-all");
    const symbols = await symbolsFor(mock, uri);
    expect(symbols.map((s) => s.name)).toContain("plain");
  });

  it("workspace/didChangeConfiguration re-gates an already-open document", async () => {
    const { mock, reconfigure } = await initServer();
    const uri = openPlainDoc(mock, "live");
    expect(await symbolsFor(mock, uri)).toEqual([]);

    await reconfigure("all");
    expect((await symbolsFor(mock, uri)).map((s) => s.name)).toContain("plain");

    await reconfigure(undefined);
    expect(await symbolsFor(mock, uri)).toEqual([]);
  });
});
