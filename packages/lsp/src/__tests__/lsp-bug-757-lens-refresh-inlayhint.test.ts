/**
 * Bug 757 —— 选择器变更只广播 `workspace/codeLens/refresh`，从不广播
 * `workspace/inlayHint/refresh`。
 *
 * inlay 是「无 CodeLens UI 的客户端」唯一的选择器状态镜像（lsp.md §inlay）；
 * 只发 codeLens ⇒ 两个镜像互相矛盾（inlay 仍显示旧档）。
 * 改后：selectCase / selectContract 都成对发 codeLens + inlayHint。
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
  dir = mkdtempSync(join(tmpdir(), "nudo-lsp-bug757-"));
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

describe("Bug 757 — 选择器变更必须同时刷新 codeLens 与 inlayHint", () => {
  it("nudo.selectCase 之后 inlayHint refresh 与 codeLens refresh 成对出现", async () => {
    const mock = startServer();
    mock.sentRequests.length = 0;

    await handler(mock, "workspace/executeCommand")({
      command: "nudo.selectCase",
      arguments: [`file://${file}`, "f", 0, "num"],
    });

    const methods = refreshMethods(mock);
    expect(methods).toContain("workspace/codeLens/refresh");
    expect(methods).toContain("workspace/inlayHint/refresh");
  }, 30_000);

  it("nudo.selectContract 之后 inlayHint refresh 与 codeLens refresh 成对出现", async () => {
    const mock = startServer();
    mock.sentRequests.length = 0;

    await handler(mock, "workspace/executeCommand")({
      command: "nudo.selectContract",
      arguments: [`file://${file}`, "f"],
    });

    const methods = refreshMethods(mock);
    expect(methods).toContain("workspace/codeLens/refresh");
    expect(methods).toContain("workspace/inlayHint/refresh");
  }, 30_000);
});
