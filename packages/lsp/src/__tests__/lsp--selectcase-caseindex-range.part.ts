/**
 * Bug 756 —— `nudo.selectCase` 不校验 caseIndex。
 *
 * 改前：caseIndex=-1 让分析崩溃（"Cannot read properties of undefined
 * (reading 'argsAbs')" 诊断）、caseIndex=99 静默改掉观察档（活动档表写出
 * {"f":99}）——两者都回 success:true。
 * 改后：越界一律回结构化错误，活动档表保持不变，且不再产生崩溃诊断。
 *
 * 钉：真 server（mock connection）+ 真 `workspace/executeCommand` 请求。
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
 * @nudo:case "str" ("a")
 */
export function f(x) {
  return x;
}
`;

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-lsp-bug756-"));
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

describe("Bug 756 — selectCase 的 caseIndex 必须落在该函数的 case 列表内", () => {
  it("越界 caseIndex 回结构化错误，活动档表不变", async () => {
    const mock = startServer();
    const exec = handler(mock, "workspace/executeCommand");
    const uri = `file://${file}`;

    // 前置：合法 case 选中
    const ok = await exec({
      command: "nudo.selectCase",
      arguments: [uri, "f", 0, "num"],
    });
    expect(ok).toEqual({ success: true });

    for (const bad of [99, -1, 2]) {
      const result = await exec({
        command: "nudo.selectCase",
        arguments: [uri, "f", bad, "?"],
      });
      expect(result.success, `caseIndex=${bad} 应当失败`).toBe(false);
      expect(result.isError).toBe(true);
      expect(result.error).toContain("out of range");
    }

    // 活动档表仍是合法的 0（越界写入不再污染）
    const active = await handler(mock, "nudo/getActiveCases")({ uri });
    expect(active).toEqual({ f: 0 });
  }, 30_000);

  it("越界 caseIndex 不产生分析崩溃诊断（argsAbs 越界）", async () => {
    const mock = startServer();
    const exec = handler(mock, "workspace/executeCommand");
    const uri = `file://${file}`;

    mock.notifications.get("textDocument/didOpen")!({
      textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
    });
    await new Promise((r) => setTimeout(r, 300));

    await exec({ command: "nudo.selectCase", arguments: [uri, "f", -1, "?"] });

    const crash = mock.sentDiagnostics
      .flatMap((d: { diagnostics: { message: string }[] }) => d.diagnostics)
      .filter((d: { message: string }) => d.message.includes("Analysis error"));
    expect(crash).toEqual([]);
  }, 30_000);

  it("非整数 caseIndex 回结构化错误", async () => {
    const mock = startServer();
    const result = await handler(mock, "workspace/executeCommand")({
      command: "nudo.selectCase",
      arguments: [`file://${file}`, "f", "0", "num"],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("integer");
  }, 30_000);
});
