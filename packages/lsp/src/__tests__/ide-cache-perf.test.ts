/**
 * P-IDE1：hover / completion / signatureHelp 高频入口的零缓存回归。
 *
 * 旧行为：每次 hover/completion 直调 lsp-surface——内部 parse×2-3 +
 * collectAbsBindingsFromGraph（transpile + new Function 整文件求值），
 * 同一未变文件连续 hover 每次都全量重算。
 *
 * 修复验收（调用计数断言）：
 * - 同一 (file, version) 连续 N 次入口 → analyzeFile 只跑 1 次；
 * - reuse 路径（result.bindings）→ lsp-surface 的
 *   collectAbsBindingsFromGraph 0 次；
 * - IDE 处理器 catch 静默吞错修复：分析 throw → connection.console.error
 *   留痕且返回语义不变（null / []）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Connection } from "vscode-languageserver/node";

const counters = vi.hoisted(() => ({
  analyzeFile: 0,
  analyzeFileAsync: 0,
  collectAbsBindingsFromGraph: 0,
}));

vi.mock("@nudojs/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nudojs/service")>();
  return {
    ...actual,
    analyzeFile: (...args: Parameters<typeof actual.analyzeFile>) => {
      counters.analyzeFile++;
      if (String(args[0]).includes("boom")) throw new Error("boom analysis");
      return actual.analyzeFile(...args);
    },
    analyzeFileAsync: (...args: Parameters<typeof actual.analyzeFileAsync>) => {
      counters.analyzeFileAsync++;
      if (String(args[0]).includes("boom")) throw new Error("boom analysis");
      return actual.analyzeFileAsync(...args);
    },
    collectAbsBindingsFromGraph: (
      ...args: Parameters<typeof actual.collectAbsBindingsFromGraph>
    ) => {
      counters.collectAbsBindingsFromGraph++;
      return actual.collectAbsBindingsFromGraph(...args);
    },
  };
});

import { createNudoServer } from "../server.ts";
import {
  clearValidationState,
  getCachedOrAnalyze,
  cachedAstFor,
  analysisCache,
} from "../validation.ts";
import { getHoverAtPosition, getCompletionsAtPosition } from "../lsp-surface.ts";

const SRC = `const greeting = "hi";
export function f(x) { return greeting + x; }
`;

describe("IDE high-frequency handlers reuse the analysis cache (P-IDE1)", () => {
  beforeEach(() => {
    clearValidationState();
    counters.analyzeFile = 0;
    counters.analyzeFileAsync = 0;
    counters.collectAbsBindingsFromGraph = 0;
  });

  it("N hovers on an unchanged file run full analysis exactly once (counter)", () => {
    const filePath = "/t/ide-perf/a.js";
    // 第一次：miss → analyzeFile 1 次 + 条目建立（含惰性 AST）
    const r1 = getCachedOrAnalyze(filePath, SRC, 1);
    expect(r1).toBeTruthy();
    const ast = cachedAstFor(filePath, SRC);
    expect(ast).toBeTruthy();
    expect(analysisCache.get(filePath)?.ast).toBe(ast);

    // 同一 (file, source, version) 再来 4 次全量分析入口
    for (let i = 0; i < 4; i++) getCachedOrAnalyze(filePath, SRC, 1);
    expect(counters.analyzeFile).toBe(1);

    // hover 复用 result.bindings + 条目 AST：不再整文件求值
    for (let i = 0; i < 5; i++) {
      const hover = getHoverAtPosition(filePath, SRC, 1, 8, undefined, undefined, {
        result: r1,
        ast,
      });
      expect(hover).toBeTruthy();
      expect(hover!.typeText).toContain("hi");
    }
    expect(counters.collectAbsBindingsFromGraph).toBe(0);
    expect(counters.analyzeFile).toBe(1);
  });

  it("completion with reuse reads result.bindings instead of full-file eval", () => {
    const filePath = "/t/ide-perf/b.js";
    const result = getCachedOrAnalyze(filePath, SRC, 1);
    expect(counters.analyzeFile).toBe(1);

    const items = getCompletionsAtPosition(filePath, SRC, 1, 0, { result });
    expect(items.some((i) => i.label === "greeting")).toBe(true);
    expect(counters.collectAbsBindingsFromGraph).toBe(0);
    expect(counters.analyzeFile).toBe(1);
  });

  it("dep sidecar content change (no watcher event) must not serve a stale entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-ide-depfp-"));
    try {
      const main = join(dir, "a.js");
      const dep = join(dir, "dep.nudo.js");
      const mainSrc = `/// @nudo:import { pos } from "./dep.nudo.js"\nexport function f(x) { return x; }\n`;
      writeFileSync(dep, "export function pos(x) { return x; }\n");
      const t0 = new Date(Date.now() - 60_000);
      utimesSync(dep, t0, t0);

      getCachedOrAnalyze(main, mainSrc, 1);
      expect(counters.analyzeFile).toBe(1);

      // 无 watcher 事件路径：依赖侧车内容在磁盘上被改写（mtime 翻转）
      writeFileSync(dep, "export function pos2(x) { return x + 1; }\n");
      const t1 = new Date(Date.now() - 30_000);
      utimesSync(dep, t1, t1);

      // source/version 均未变：旧 depsFingerprint（只 hash 自身侧车）会命中
      // 陈旧条目；新口径（loadModuleDepsFingerprint）必须 miss 重算
      getCachedOrAnalyze(main, mainSrc, 1);
      expect(counters.analyzeFile).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 协议面：mock connection 驱动真实 handler（server-protocol.test.ts 同款 harness）
// ---------------------------------------------------------------------------

type AnyHandler = (params: any) => any;

function createMockConnection() {
  const requests = new Map<string, AnyHandler>();
  const notifications = new Map<string, AnyHandler>();
  const consoleErrors: string[] = [];
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
    onDidOpenTextDocument: (h: AnyHandler) => byNotification("textDocument/didOpen", h),
    onDidChangeTextDocument: (h: AnyHandler) => byNotification("textDocument/didChange", h),
    onDidCloseTextDocument: (h: AnyHandler) => byNotification("textDocument/didClose", h),
    onDidSaveTextDocument: (h: AnyHandler) => byNotification("textDocument/didSave", h),
    onWillSaveTextDocument: (h: AnyHandler) => byNotification("textDocument/willSave", h),
    onWillSaveTextDocumentWaitUntil: (h: AnyHandler) =>
      byNotification("textDocument/willSaveWaitUntil", h),
    languages: {
      diagnostics: { on: (h: AnyHandler) => byName("textDocument/diagnostic", h) },
      inlayHint: { on: (h: AnyHandler) => byName("textDocument/inlayHint", h) },
      semanticTokens: { on: (h: AnyHandler) => byName("textDocument/semanticTokens/full", h) },
    },
    sendDiagnostics: () => {},
    sendRequest: () => Promise.resolve(undefined),
    console: {
      error: (msg: unknown) => consoleErrors.push(String(msg)),
      warn: () => {},
      log: () => {},
      info: () => {},
    },
    listen: () => {},
    requests,
    notifications,
    consoleErrors,
  };
  return mock;
}

describe("IDE handlers via protocol surface", () => {
  beforeEach(() => {
    clearValidationState();
    counters.analyzeFile = 0;
    counters.analyzeFileAsync = 0;
    counters.collectAbsBindingsFromGraph = 0;
  });

  it("repeated hover requests analyze once and log analysis failures (P-IDE1/P-IDE4)", async () => {
    const mock = createMockConnection();
    createNudoServer(mock as unknown as Connection);

    const uri = "file:///t/ide-handler/a.js";
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
    });
    // didOpen 的异步 validate 落定（建条目 / 发诊断）
    await new Promise((r) => setTimeout(r, 30));

    const hover = mock.requests.get("textDocument/hover")!;
    const first = hover({ textDocument: { uri }, position: { line: 0, character: 8 } });
    expect(first).toBeTruthy();
    for (let i = 0; i < 4; i++) {
      const again = hover({ textDocument: { uri }, position: { line: 0, character: 8 } });
      expect(again).toEqual(first);
    }
    // validate 路径走 analyzeFileAsync（不计 analyzeFile）；hover 入口最多再算 1 次
    expect(counters.analyzeFile).toBeLessThanOrEqual(1);
    // hover 复用 result.bindings：lsp-surface 不再整文件求值
    expect(counters.collectAbsBindingsFromGraph).toBe(0);

    // P-IDE4：分析 throw 不再静默——console.error 留痕，返回语义不变（null）
    const boomUri = "file:///t/ide-handler/boom.js";
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: {
        uri: boomUri,
        languageId: "javascript",
        version: 1,
        text: "export function g(x) { return x; }\n",
      },
    });
    await new Promise((r) => setTimeout(r, 30));
    const out = hover({ textDocument: { uri: boomUri }, position: { line: 0, character: 17 } });
    expect(out).toBeNull();
    expect(mock.consoleErrors.some((e) => e.includes("nudo hover failed"))).toBe(true);
  });

  it("repeated completion requests do not re-run full analysis", async () => {
    const mock = createMockConnection();
    createNudoServer(mock as unknown as Connection);

    const uri = "file:///t/ide-handler/b.js";
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
    });
    await new Promise((r) => setTimeout(r, 30));

    const completion = mock.requests.get("textDocument/completion")!;
    const items = completion({ textDocument: { uri }, position: { line: 0, character: 0 } });
    expect(items.some((i: { label: string }) => i.label === "greeting")).toBe(true);
    const baseline = counters.analyzeFile;
    for (let i = 0; i < 4; i++) {
      completion({ textDocument: { uri }, position: { line: 0, character: 0 } });
    }
    expect(counters.analyzeFile).toBe(baseline);
    expect(counters.collectAbsBindingsFromGraph).toBe(0);
  });

  it("signatureHelp resolves cross-line args via cached analysis (P-IDE1/P-IDE7)", async () => {
    const mock = createMockConnection();
    createNudoServer(mock as unknown as Connection);

    const uri = "file:///t/ide-handler/c.js";
    const multi = [
      "export function call(a, b) { return a; }",
      "export function use() {",
      "  return call(",
      "    1,",
      "    2,",
      "  );",
      "}",
    ].join("\n");
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: { uri, languageId: "javascript", version: 1, text: multi },
    });
    await new Promise((r) => setTimeout(r, 30));

    const sig = mock.requests.get("textDocument/signatureHelp")!;
    // 光标在跨行首参 `1`（line 3, col 4）：旧 visitor 误报 activeParameter=1
    const out = sig({ textDocument: { uri }, position: { line: 3, character: 4 } });
    expect(out).toBeTruthy();
    expect(out.signatures.length).toBeGreaterThan(0);
    expect(out.activeParameter).toBe(0);

    const baseline = counters.analyzeFile;
    for (let i = 0; i < 3; i++) {
      sig({ textDocument: { uri }, position: { line: 3, character: 4 } });
    }
    expect(counters.analyzeFile).toBe(baseline);
    expect(counters.collectAbsBindingsFromGraph).toBe(0);
  });
});
