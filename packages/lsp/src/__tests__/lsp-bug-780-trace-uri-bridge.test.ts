/**
 * Bug 780 —— IDE 的 `entry@` / `call@` 观察透镜**必然抛 TypeError**：
 * `nudo.trace` 既没有「位置参数 → 对象」的桥，也不接受 `uri` 键 ⇒
 * `params.file` 是 `undefined` ⇒ `normalizeFilePath(undefined)` 抛。
 *
 * 根因（两半）：
 * - server 侧：`workspace/executeCommand` 的兜底分支把 `args[0]`（**uri
 *   字符串**）当参数对象传下去 ⇒ `params.file === undefined`
 *   （server.ts 归片 D；本片交付 agent 侧的桥 `tracePositionalArgs`）；
 * - agent 侧（本片）：`trace` 工具只读 `params.file` ⇒ 连 IDE 自产的
 *   `file://…` uri 形态也走不通。
 *
 * 修法（片 F，agent 侧）：
 * - `FunctionToolParams` 增 `uri` 键（`file` 与 `uri` 二选一）；
 * - `trace` / `suggestCase` 经 `resolveToolFile` 定位文件（缺省时抛共用
 *   入口闸的 TypeError，不让裸 TypeError 当工具文案）；
 * - 导出 `tracePositionalArgs`（位置参数桥，供片 D 接进命令桥）。
 *
 * 钉：`nudo/trace` 的 `{uri}` 形态成功出见证；`{file}` 形态不回归；
 * 位置参数桥的形状（合法 ⇒ `{uri, functionName}`；不合法 ⇒ undefined）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";
import { tracePositionalArgs, trace } from "../agent-tools.ts";

/** 带显式 case 的导出函数 ⇒ 观察透镜有见证可打印 */
const SRC = `/**
 * @nudo:case "one" (1) => 2
 */
export function run(x) {
  return x + 1;
}
`;

function openSession(): {
  mock: ReturnType<typeof createMockConnection>;
  file: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug780-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "bug780-trace", private: true, type: "module" }),
    "utf-8",
  );
  const file = join(dir, "app.js");
  writeFileSync(file, SRC, "utf-8");
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri: `file://${file}`, languageId: "javascript", version: 1, text: SRC },
  });
  return {
    mock,
    file,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function textOf(res: any): string {
  const c = res?.content;
  if (Array.isArray(c)) return c.map((x: any) => x.text).join("\n");
  return String(res ?? "");
}

describe("Bug 780 — nudo.trace 必须接受 uri 键并有位置参数桥", () => {
  it("nudo/trace 的 {uri} 形态：出见证（不再 TypeError）", async () => {
    const { mock, file, cleanup } = openSession();
    try {
      const res: any = await mock.requests.get("nudo/trace")!({
        uri: `file://${file}`,
        functionName: "run",
      });
      expect(res?.isError, `uri 形态仍失败：${textOf(res)}`).toBeFalsy();
      expect(textOf(res)).toContain("Input:");
    } finally {
      cleanup();
    }
  }, 30_000);

  it("nudo/trace 的 {file} 形态：不回归", async () => {
    const { mock, file, cleanup } = openSession();
    try {
      const res: any = await mock.requests.get("nudo/trace")!({
        file,
        functionName: "run",
      });
      expect(res?.isError, `file 形态失败：${textOf(res)}`).toBeFalsy();
      expect(textOf(res)).toContain("Input:");
    } finally {
      cleanup();
    }
  }, 30_000);

  it("agent 侧：trace 工具直调也接受 uri 键", async () => {
    const { file, cleanup } = openSession();
    try {
      const res = await trace({ uri: `file://${file}`, functionName: "run" });
      expect(res.isError, `trace(uri) 失败：${res.content[0]!.text}`).toBeFalsy();
      expect(res.content[0]!.text).toContain("Input:");
    } finally {
      cleanup();
    }
  }, 30_000);

  it("位置参数桥 tracePositionalArgs：[uri, fn] ⇒ { uri, functionName }", () => {
    expect(tracePositionalArgs(["file:///tmp/a.js", "run"])).toEqual({
      uri: "file:///tmp/a.js",
      functionName: "run",
    });
    // 形态不合法 ⇒ undefined（由调用方报协议层参数形态错误）
    expect(tracePositionalArgs(["file:///tmp/a.js"])).toBeUndefined();
    expect(tracePositionalArgs([123, "run"])).toBeUndefined();
  });
});
