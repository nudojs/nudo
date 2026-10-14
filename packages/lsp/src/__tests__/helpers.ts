/**
 * LSP 测试共享 harness（server-protocol.test.ts 原版超集；ide-cache-perf.test.ts
 * 的精简副本已并入——精简版没有的记录面（sentDiagnostics / sentRequests / listened）
 * 在超集上只是额外留痕，对 server 行为不可观测）。
 *
 * - createMockConnection / MockConnection / AnyHandler：JSON-RPC-ish 内存 mock
 *   Connection——记录 request/notification handler，不起真实 transport。
 *   刻意不 import server.ts（避免 createConnection 副作用）：mock 注入架构不变，
 *   由调用处自行 createNudoServer(mock as unknown as Connection)。
 * - makeValidateDeps：ValidateTextDeps fixture 工厂。sendDiagnostics 回调、
 *   openDocs 查表键归一、isNudoUri / getActiveCases / loadModule /
 *   workspaceRoots 参数化；各测试的发布收集逻辑（sent/revalidated 闭包）留在
 *   调用处逐字不动。
 * - withTempDir：mkdtemp + try/finally rmSync 的 tmpdir 脚手架。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LspDiagnostic, ValidateTextDeps } from "../validation.ts";

// ---------------------------------------------------------------------------
// mock Connection harness
// ---------------------------------------------------------------------------

export type AnyHandler = (params: any) => any;

export function createMockConnection() {
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
  const byNotification = register(notifications);

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
      byNotification("workspace/didChangeWatchedFiles", h),
    onDidChangeConfiguration: (h: AnyHandler) =>
      byNotification("workspace/didChangeConfiguration", h),
    // TextDocuments.listen requires the singular notification names
    onDidOpenTextDocument: (h: AnyHandler) => byNotification("textDocument/didOpen", h),
    onDidChangeTextDocument: (h: AnyHandler) => byNotification("textDocument/didChange", h),
    onDidCloseTextDocument: (h: AnyHandler) => byNotification("textDocument/didClose", h),
    onDidSaveTextDocument: (h: AnyHandler) => byNotification("textDocument/didSave", h),
    onWillSaveTextDocument: (h: AnyHandler) => byNotification("textDocument/willSave", h),
    onWillSaveTextDocumentWaitUntil: (h: AnyHandler) =>
      byNotification("textDocument/willSaveWaitUntil", h),
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

export type MockConnection = ReturnType<typeof createMockConnection>;

// ---------------------------------------------------------------------------
// ValidateTextDeps fixture 工厂
// ---------------------------------------------------------------------------

export interface OpenDocEntry {
  uri: string;
  version: number;
  getText(): string;
}

export interface MakeValidateDepsOpts {
  /** sendDiagnostics 回调（各测试的发布收集逻辑，闭包留在调用处） */
  onPublish?: (params: { uri: string; diagnostics: LspDiagnostic[]; version?: number }) => void;
  /** openDocs 表项 [key, doc]；提供时生成 getOpenDocumentByPath 查表 */
  docs?: Array<[string, OpenDocEntry]>;
  /** 查表键归一（默认恒等；Windows 形态用 (p) => p.replace(/\\/g, "/")） */
  lookupKey?: (p: string) => string;
  /** 显式 getOpenDocumentByPath（提供时优先于 docs 查表） */
  getOpenDocumentByPath?: ValidateTextDeps["getOpenDocumentByPath"];
  isNudoUri?: ValidateTextDeps["isNudoUri"];
  getActiveCases?: ValidateTextDeps["getActiveCases"];
  loadModule?: ValidateTextDeps["loadModule"];
  workspaceRoots?: ValidateTextDeps["workspaceRoots"];
}

export type ValidateDepsHandle = ValidateTextDeps & {
  /** docs 表（didChange 建模可继续 set/update） */
  openDocs: Map<string, OpenDocEntry>;
};

export function makeValidateDeps(opts: MakeValidateDepsOpts = {}): ValidateDepsHandle {
  const openDocs = new Map(opts.docs ?? []);
  const deps = {
    sendDiagnostics: opts.onPublish ?? (() => {}),
    openDocs,
  } as ValidateDepsHandle;
  if (opts.getOpenDocumentByPath) {
    deps.getOpenDocumentByPath = opts.getOpenDocumentByPath;
  } else if (opts.docs) {
    const lookup = opts.lookupKey ?? ((p: string) => p);
    deps.getOpenDocumentByPath = (p) => openDocs.get(lookup(p));
  }
  if (opts.isNudoUri) deps.isNudoUri = opts.isNudoUri;
  if (opts.getActiveCases) deps.getActiveCases = opts.getActiveCases;
  if (opts.loadModule) deps.loadModule = opts.loadModule;
  if (opts.workspaceRoots) deps.workspaceRoots = opts.workspaceRoots;
  return deps;
}

// ---------------------------------------------------------------------------
// tmpdir 脚手架
// ---------------------------------------------------------------------------

export function withTempDir<T>(prefix: string, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
