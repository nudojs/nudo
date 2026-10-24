/**
 * Bug 758 —— 选择器变更从不广播 `workspace/diagnostic/refresh`。
 *
 * 改前：切 case 后 pull 诊断客户端永远拿不到切换后的新诊断（只有 codeLens
 * refresh）。改后：selectCase / selectContract 都广播 diagnostic refresh。
 *
 * 钉：真 server（mock connection）+ 真 `workspace/executeCommand` 请求，
 * 观测服务端发出的 refresh 请求名。
 *
 * 用例超时给到 30s：真 server 依赖图（server.ts → core/service/parser）在
 * 并行负载下首测要数秒，5s 默认值会偶发踩线。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Connection } from "vscode-languageserver/node";
import { createNudoServer } from "../server.ts";
import { createMockConnection, type AnyHandler } from "./helpers.ts";

const SRC = `/**
 * @nudo:case "num" (1)
 */
export function f(x) {
  return x;
}
`;

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-lsp-bug758-"));
  file = join(dir, "sel.js");
  writeFileSync(file, SRC, "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function startServer(): ReturnType<typeof createMockConnection> {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as Connection);
  return mock;
}

function handler(mock: ReturnType<typeof createMockConnection>, method: string): AnyHandler {
  const h = mock.requests.get(method);
  expect(h, `handler "${method}" not registered`).toBeTruthy();
  return h!;
}

function refreshMethods(mock: ReturnType<typeof createMockConnection>): string[] {
  return mock.sentRequests.map((r: { type?: { method?: string } }) => r.type?.method ?? "?");
}

describe("Bug 758 — 选择器变更必须广播 diagnostic refresh（pull 诊断面）", () => {
  it("nudo.selectCase 之后发出 workspace/diagnostic/refresh", async () => {
    const mock = startServer();
    mock.sentRequests.length = 0;

    await handler(mock, "workspace/executeCommand")({
      command: "nudo.selectCase",
      arguments: [`file://${file}`, "f", 0, "num"],
    });

    expect(refreshMethods(mock)).toContain("workspace/diagnostic/refresh");
  }, 30_000);

  it("nudo.selectContract 之后发出 workspace/diagnostic/refresh", async () => {
    const mock = startServer();
    mock.sentRequests.length = 0;

    await handler(mock, "workspace/executeCommand")({
      command: "nudo.selectContract",
      arguments: [`file://${file}`, "f"],
    });

    expect(refreshMethods(mock)).toContain("workspace/diagnostic/refresh");
  }, 30_000);
});
