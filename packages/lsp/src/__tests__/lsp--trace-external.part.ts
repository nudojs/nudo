/**
 * Bug 146 —— 跨模块 `call@` 观察镜的 `nudo.trace` 动作 **100% 不可执行**。
 *
 * 症状（真 server 协议面）：`lib.js` 导出 `add`，`main.js` 里
 * `import { add } from "./lib.js"` 后调用 `add(x, 2)` ⇒ 调用方文件的 CodeLens
 * 出现跨模块 `call@L3  (any, 2) => number | string`，但点它（命令
 * `nudo.trace [uri(main.js), "add"]`）回 `Function "add" not found` ——
 * 镜面标题说有这个事实，动作却说没有。
 *
 * 根因：`trace()` 只在 `result.functions`（**本文件**的本地函数）里找，
 * 被导入函数的调用点事实在 `result.externalFunctions` 里 ⇒ 必然落空。
 *
 * 修法：`result.functions` 未命中时回落到 `result.externalFunctions`
 * （本文件同名本地函数优先）。
 *
 * 钉：
 * 1. agent 工具直调（跨模块）⇒ 出跨模块见证，不是 `not found`；
 * 2. 真 server `workspace/executeCommand nudo.trace [uri, fn]`（观察镜的动作
 *    形态，位置参数）⇒ 同上；
 * 3. 同文件 `call@` 对照（一直在工作的那条路径）不回归。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFileAsync } from "@nudojs/service";
import { trace } from "../agent-tools.ts";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

const LIB_SRC = `export function add(a, b) {
  return a + b;
}
`;

const MAIN_SRC = `import { add } from "./lib.js";

export function run(x) {
  return add(x, 2);
}
`;

const SAME_FILE_SRC = `export function add(a, b) {
  return a + b;
}

export function run(x) {
  return add(x, 2);
}
`;

/** 跨模块见证的本体（与 CodeLens 标题同一 ArgAbs/结果 Abs） */
const CROSS_WITNESS = "Input: (any, 2) => Output: number | string";

function textOf(res: { content: ReadonlyArray<{ text: string }> }): string {
  return res.content.map((c) => c.text).join("\n");
}

function withProject(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug146-"));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text, "utf-8");
  }
  return fn(dir).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

describe("Bug 146 — 跨模块 call@ 镜的 nudo.trace 动作必须可执行", () => {
  it("trace({file, functionName}) 回落到 externalFunctions：出跨模块见证", async () => {
    await withProject({ "lib.js": LIB_SRC, "main.js": MAIN_SRC }, async (dir) => {
      // 前置：`add` **不在**本文件函数表里（否则这条用例测不到回落）
      const analysis = await analyzeFileAsync(
        join(dir, "main.js"),
        MAIN_SRC,
        undefined,
        undefined,
        undefined,
        "all",
      );
      expect(analysis.functions.map((f) => f.name)).not.toContain("add");
      expect((analysis.externalFunctions ?? []).map((f) => f.name)).toContain("add");

      const res = await trace({
        file: join(dir, "main.js"),
        functionName: "add",
      });
      const text = textOf(res);
      // 改前：isError + `Function "add" not found`
      expect(res.isError, `跨模块 trace 失败：${text}`).toBeFalsy();
      expect(text).not.toContain("not found");
      expect(text).toContain(CROSS_WITNESS);
    });
  }, 30_000);

  it("真 server executeCommand `nudo.trace [uri, fn]`（观察镜动作形态）不报 not found", async () => {
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug146-srv-"));
    try {
      writeFileSync(join(dir, "lib.js"), LIB_SRC, "utf-8");
      writeFileSync(join(dir, "main.js"), MAIN_SRC, "utf-8");
      const uri = `file://${join(dir, "main.js")}`;
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: {
          uri,
          languageId: "javascript",
          version: 1,
          text: MAIN_SRC,
        },
      });
      await new Promise((r) => setTimeout(r, 300));

      const res = (await mock.requests.get("workspace/executeCommand")!({
        command: "nudo.trace",
        arguments: [uri, "add"],
      })) as { isError?: boolean; content?: { text: string }[] };

      const text = (res.content ?? []).map((c) => c.text).join("\n");
      expect(res.isError, `executeCommand 失败：${text}`).toBeFalsy();
      expect(text).not.toContain("not found");
      expect(text).toContain(CROSS_WITNESS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("同文件 call@ 对照：trace 仍按本地函数解析（不回归）", async () => {
    await withProject({ "same.js": SAME_FILE_SRC }, async (dir) => {
      const res = await trace({
        file: join(dir, "same.js"),
        functionName: "add",
      });
      const text = textOf(res);
      expect(res.isError, `同文件 trace 失败：${text}`).toBeFalsy();
      expect(text).toContain(CROSS_WITNESS);
    });
  }, 30_000);
});
