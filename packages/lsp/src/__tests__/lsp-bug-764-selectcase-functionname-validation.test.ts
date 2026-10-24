/**
 * Bug 764 —— `nudo.selectCase` 不校验 functionName。
 *
 * 改前：任意名字（空串 ""、文件里不存在的 "doesNotExist"）都被当成真写进
 * 活动档表 ⇒ getActiveCases 如实上报幽灵条目（{"":0} / {"doesNotExist":0}）。
 * 改后：函数名必须是该文件里的已知函数，且必须有 @nudo:case 可选。
 *
 * 用例超时给到 30s：withLspServer 的首次动态 import（server.ts 依赖图）在
 * 并行负载下要数秒，5s 默认值会偶发踩线。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = `/**
 * @nudo:case "num" (1)
 */
export function f(x) {
  return x;
}

export function g(y) {
  return y + 1;
}
`;

describe("Bug 764 — selectCase 必须校验 functionName", () => {
  it("空串 / 不存在的函数名回结构化错误，活动档表无幽灵条目", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const exec = req("workspace/executeCommand");
      const fileUri = uri("sel.js");

      const empty = await exec({ command: "nudo.selectCase", arguments: [fileUri, "", 0, "?"] });
      expect(empty.success).toBe(false);
      expect(empty.isError).toBe(true);
      expect(empty.error).toContain("functionName");

      const ghost = await exec({
        command: "nudo.selectCase",
        arguments: [fileUri, "doesNotExist", 0, "?"],
      });
      expect(ghost.success).toBe(false);
      expect(ghost.error).toContain("unknown function");

      // 幽灵条目不再出现
      const active = await req("nudo/getActiveCases")({ uri: fileUri });
      expect(active).toEqual({});
    });
  }, 30_000);

  it("文件里存在但没有 @nudo:case 的函数回结构化错误", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const result = await req("workspace/executeCommand")({
        command: "nudo.selectCase",
        arguments: [uri("sel.js"), "g", 0, "?"],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("no @nudo:case");
      expect(await req("nudo/getActiveCases")({ uri: uri("sel.js") })).toEqual({});
    });
  }, 30_000);

  it("合法函数名仍然选中并写入活动档表", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const result = await req("workspace/executeCommand")({
        command: "nudo.selectCase",
        arguments: [uri("sel.js"), "f", 0, "num"],
      });
      expect(result).toEqual({ success: true });
      expect(await req("nudo/getActiveCases")({ uri: uri("sel.js") })).toEqual({ f: 0 });
    });
  }, 30_000);
});
