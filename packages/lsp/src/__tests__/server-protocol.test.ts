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
        refresh: () => Promise.resolve(undefined),
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

// Bug 8（wave 3）：`x + y`（any 形参算术）原生 may TypeError → 不再是 clean
// 样本；本组用例意图是「clean 文件 → ok / 空诊断发布」，改用恒总 identity。
const CHECK_OK = `
export function id(x) {
  return x;
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

describe("createNudoServer — 参数 inlay hints 开关（nudo.inlayHints.parameters，默认关）", () => {
  // 显式侧车契约（同名 *.nudo.js 自动绑定）→ 参数 `where …` inlay
  const PARAM_SRC = `export function need(x) {
  return x;
}
`;
  const PARAM_SIDECAR = `import { fn, number } from "@nudojs/core";
export const need = fn({ x: number() }, number());
`;

  let paramDir: string;

  beforeAll(() => {
    paramDir = mkdtempSync(join(tmpdir(), "nudo-lsp-paraminlay-"));
  });

  afterAll(() => {
    rmSync(paramDir, { recursive: true, force: true });
  });

  function notification(mock: Mock, method: string): AnyHandler {
    const h = mock.notifications.get(method);
    expect(h, `notification "${method}" not registered`).toBeTruthy();
    return h!;
  }

  /** 建独立子项目（避免 findProjectConfig memo 指纹撞车）并打开 need.js */
  async function startParamSession(
    initializationOptions?: unknown,
    projectNudo?: unknown,
  ): Promise<{ mock: Mock; uri: string }> {
    const sub = `proj-${Math.random().toString(36).slice(2, 8)}`;
    const projDir = join(paramDir, sub);
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "need.js"), PARAM_SRC, "utf-8");
    writeFileSync(join(projDir, "need.nudo.js"), PARAM_SIDECAR, "utf-8");
    if (projectNudo !== undefined) {
      writeFileSync(
        join(projDir, "package.json"),
        JSON.stringify({ nudo: projectNudo }),
        "utf-8",
      );
    }
    const mock = startServer();
    await handler(mock, "initialize")({
      processId: null,
      rootUri: null,
      workspaceFolders: [],
      capabilities: {},
      ...(initializationOptions === undefined ? {} : { initializationOptions }),
    });
    const uri = `file://${join(projDir, "need.js")}`;
    notification(mock, "textDocument/didOpen")({
      textDocument: { uri, languageId: "javascript", version: 1, text: PARAM_SRC },
    });
    return { mock, uri };
  }

  async function inlayLabels(mock: Mock, uri: string): Promise<string[]> {
    const hints = (await handler(mock, "textDocument/inlayHint")({
      textDocument: { uri },
      range: { start: { line: 0, character: 0 }, end: { line: 99, character: 0 } },
    })) as { label?: unknown }[];
    return hints.map((h) => String(h.label ?? ""));
  }

  it("默认关：无参数 where inlay（返回 inlay 仍在）", async () => {
    const { mock, uri } = await startParamSession();
    const labels = await inlayLabels(mock, uri);
    expect(labels.some((l) => l.includes("where"))).toBe(false);
    // 返回 inlay（`: x` 路径摘要）短小，不受开关影响
    expect(labels.some((l) => l.includes(": x"))).toBe(true);
  });

  it("initializationOptions inlayHints.parameters=true 开启", async () => {
    const { mock, uri } = await startParamSession({
      inlayHints: { parameters: true },
    });
    const labels = await inlayLabels(mock, uri);
    expect(labels.some((l) => l.includes('where typeof x = "number"'))).toBe(
      true,
    );
  });

  it("非法宿主值回落默认关", async () => {
    const { mock, uri } = await startParamSession({
      inlayHints: { parameters: "yes" },
    });
    const labels = await inlayLabels(mock, uri);
    expect(labels.some((l) => l.includes("where"))).toBe(false);
  });

  it("workspace/didChangeConfiguration 实时开关", async () => {
    const { mock, uri } = await startParamSession();
    expect((await inlayLabels(mock, uri)).some((l) => l.includes("where"))).toBe(
      false,
    );
    notification(mock, "workspace/didChangeConfiguration")({
      settings: { nudo: { inlayHints: { parameters: true } } },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await inlayLabels(mock, uri)).some((l) => l.includes("where"))).toBe(
      true,
    );
    notification(mock, "workspace/didChangeConfiguration")({
      settings: { nudo: { inlayHints: { parameters: false } } },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await inlayLabels(mock, uri)).some((l) => l.includes("where"))).toBe(
      false,
    );
  });

  it("项目 package.json#nudo.inlayHints.parameters 显式值赢过宿主默认", async () => {
    // 项目关 + 宿主开 → 关
    const off = await startParamSession(
      { inlayHints: { parameters: true } },
      { inlayHints: { parameters: false } },
    );
    expect((await inlayLabels(off.mock, off.uri)).some((l) => l.includes("where"))).toBe(
      false,
    );
    // 项目开 + 宿主关 → 开
    const on = await startParamSession(
      { inlayHints: { parameters: false } },
      { inlayHints: { parameters: true } },
    );
    expect((await inlayLabels(on.mock, on.uri)).some((l) => l.includes("where"))).toBe(
      true,
    );
  });
});

describe("createNudoServer — 观察选择器（contract 与各 case 互斥选项）", () => {
  // 同一文件同时具备契约选项（export → implicit 档 + persist/draft 动作）、
  // 指令 case 与未导出函数的字面量调用点合成 call@
  const LENS_SRC = `/**
 * @nudo:case "five" (2, 3)
 */
export function add(a, b) {
  return a + b;
}

function mul(a, b) {
  return a * b;
}
const r = mul(2, 3);
`;

  let lensDir: string;

  beforeAll(() => {
    lensDir = mkdtempSync(join(tmpdir(), "nudo-lsp-lensmode-"));
    writeFileSync(join(lensDir, "lens.js"), LENS_SRC, "utf-8");
  });

  afterAll(() => {
    rmSync(lensDir, { recursive: true, force: true });
  });

  function notification(mock: Mock, method: string): AnyHandler {
    const h = mock.notifications.get(method);
    expect(h, `notification "${method}" not registered`).toBeTruthy();
    return h!;
  }

  async function startSelectorSession(): Promise<{ mock: Mock; uri: string }> {
    const mock = startServer();
    await handler(mock, "initialize")({
      processId: null,
      rootUri: null,
      workspaceFolders: [],
      capabilities: {},
    });
    const uri = `file://${join(lensDir, "lens.js")}`;
    notification(mock, "textDocument/didOpen")({
      textDocument: { uri, languageId: "javascript", version: 1, text: LENS_SRC },
    });
    return { mock, uri };
  }

  async function lensTitles(mock: Mock, uri: string): Promise<string[]> {
    const lenses = await handler(mock, "textDocument/codeLens")({ textDocument: { uri } });
    return (lenses as { command?: { title?: string } }[]).map((l) => l.command?.title ?? "");
  }

  async function exec(mock: Mock, command: string, args: unknown[]) {
    return handler(mock, "workspace/executeCommand")({ command, arguments: args });
  }

  it("默认：契约选项 ●，全部 case ○；动作与观察层照常", async () => {
    const { mock, uri } = await startSelectorSession();
    const titles = await lensTitles(mock, uri);
    expect(titles).toContain("● contract / imp");
    expect(titles).toContain('○ case "five"');
    expect(titles.some((t) => t.startsWith("● case"))).toBe(false);
    expect(titles).toContain("⚡ persist interface");
    expect(titles).toContain("⚡ draft interface");
    expect(titles.some((t) => t.startsWith("call@"))).toBe(true);
  });

  it("selectCase 后契约转 ○、选中 case 转 ●；inlay 档投影同态", async () => {
    const { mock, uri } = await startSelectorSession();
    await exec(mock, "nudo.selectCase", [uri, "add", 0, "five"]);
    const titles = await lensTitles(mock, uri);
    expect(titles).toContain("○ contract / imp");
    expect(titles).toContain('● case "five"');

    const hints = await handler(mock, "textDocument/inlayHint")({
      textDocument: { uri },
      range: { start: { line: 0, character: 0 }, end: { line: 99, character: 0 } },
    });
    const labels = ((hints ?? []) as { label?: unknown }[]).map((h) => String(h.label ?? ""));
    expect(labels.some((l) => l.includes("○ contract / imp"))).toBe(true);
  });

  it("selectContract 切回契约（case 全 ○），幂等", async () => {
    const { mock, uri } = await startSelectorSession();
    await exec(mock, "nudo.selectCase", [uri, "add", 0, "five"]);
    expect((await lensTitles(mock, uri)).some((t) => t.startsWith("○ contract"))).toBe(true);

    await exec(mock, "nudo.selectContract", [uri, "add"]);
    const titles = await lensTitles(mock, uri);
    expect(titles).toContain("● contract / imp");
    expect(titles).toContain('○ case "five"');

    // 无激活 case 时再点契约：幂等保持 ●
    await exec(mock, "nudo.selectContract", [uri, "add"]);
    expect((await lensTitles(mock, uri)).some((t) => t.startsWith("● contract"))).toBe(true);
  });

  it("nudo/selectContract 请求别名与命令同效", async () => {
    const { mock, uri } = await startSelectorSession();
    await handler(mock, "nudo/selectCase")({ uri, functionName: "add", caseIndex: 0 });
    await handler(mock, "nudo/selectContract")({ uri, functionName: "add" });
    const titles = await lensTitles(mock, uri);
    expect(titles.some((t) => t.startsWith("● contract"))).toBe(true);
  });
});
