/**
 * Bug 780 —— `nudo.trace` 的**位置参数**形态没有命令桥。
 *
 * 症状：IDE 的 `entry@` / `call@` 观察透镜用位置参数发命令
 * （`executeCommand "nudo.trace" [uri, functionName]`）⇒ 服务端兜底分支把
 * uri **字符串**当参数对象传下去 ⇒ `params.file` 是 `undefined` ⇒ 工具
 * 100% 失败（每次点击观察透镜只得到一个错误）。
 *
 * 根因（片 D · `server.ts`）：`nudo.contract*` 有位置参数桥
 * （`contractPositionalArgs` / `contractEmitPositionalArgs`），`nudo.trace`
 * 没有；兜底分支也没有「参数不是对象 ⇒ 报参数形态错误」的闸。
 *
 * 修法：
 * - `nudo.trace` 补上同款位置参数桥（复用 agent 侧
 *   `tracePositionalArgs`：`[uri, fn]` → `{ uri, functionName }`）；
 * - 兜底分支：参数不是对象 ⇒ 抛**协议层参数错误**（InvalidParams），
 *   不再把字符串当对象传下去。
 *
 * 钉：① `[uri, fn]` 位置形态跑出 trace；② 对象形态不受影响；
 * ③ 非对象参数（裸字符串）⇒ 协议层 InvalidParams（而不是工具内部错误）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorCodes } from "vscode-languageserver/node";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

const SRC = `/**
 * @nudo:case 1
 */
export function run() {
  return 1;
}
`;

describe("Bug 780 — nudo.trace 必须支持位置参数 [uri, functionName]", () => {
  it("位置参数 [uri, fn] 跑出 trace（不是错误）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug780-"));
    try {
      const file = join(dir, "app.js");
      writeFileSync(file, SRC, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      const exec = mock.requests.get("workspace/executeCommand")!;
      const result = await exec({
        command: "nudo.trace",
        arguments: [uri, "run"],
      }) as { isError?: boolean; content?: { text?: string }[] };
      expect(result.isError).toBeFalsy();
      expect(result.content?.[0]?.text ?? "").toContain("Output:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("对象形态 { uri, functionName } 仍然可用（桥不得吃掉既有形态）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug780-"));
    try {
      const file = join(dir, "app.js");
      writeFileSync(file, SRC, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      const exec = mock.requests.get("workspace/executeCommand")!;
      const result = await exec({
        command: "nudo.trace",
        arguments: [{ uri, functionName: "run" }],
      }) as { isError?: boolean; content?: { text?: string }[] };
      expect(result.isError).toBeFalsy();
      expect(result.content?.[0]?.text ?? "").toContain("Output:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("非对象参数（裸字符串）⇒ 协议层 InvalidParams（不再把字符串当对象传下去）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug780-"));
    try {
      const file = join(dir, "app.js");
      writeFileSync(file, SRC, "utf-8");
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      const exec = mock.requests.get("workspace/executeCommand")!;
      await expect(async () =>
        exec({ command: "nudo.trace", arguments: [`file://${file}`] }),
      ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
